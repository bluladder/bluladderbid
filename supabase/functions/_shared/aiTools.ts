// ============================================================================
// aiTools.ts — the ONLY set of actions the AI orchestration layer may take.
// This is a strict server-side allowlist shared by every channel (website
// chat today, inbound voice later). The AI can never:
//   * do pricing arithmetic itself (it calls calculate_bluladder_quote)
//   * invent prices, discounts, or availability
//   * query arbitrary tables / run SQL or GraphQL
//   * call Jobber mutations directly (it calls create_bluladder_booking, which
//     itself recalculates pricing and holds a DB reservation)
// Every tool validates its own inputs and returns a compact JSON result.
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateServiceArea } from "./serviceArea.ts";
import { emitCampaignEvent as emitCampaignEventShared } from "./campaignEmitter.ts";
import { checkSuppression } from "./suppression.ts";
import { escalateToHuman } from "./escalation.ts";
import { recordKnowledgeGap } from "./knowledgeGaps.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const ALLOWED_SERVICES = [
  "window_cleaning",
  "house_wash",
  "gutter_cleaning",
  "roof_cleaning",
  "driveway_cleaning",
  "pressure_washing",
] as const;

// Services / conditions that must NEVER receive an AI-invented firm price.
export const MANUAL_REVIEW_SERVICES = [
  "screens",
  "tracks_and_sills",
  "solar_panel_cleaning",
  "mobile_screen_repair",
  "commercial",
  "restoration",
];

export interface ToolContext {
  supabase: SupabaseClient;
  conversationId: string;
  sessionToken: string;
  channel: "web" | "voice";
}

function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function callFunction(name: string, body: unknown): Promise<{ status: number; json: any }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Internal service-to-service call. Never exposed to the browser.
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await resp.json(); } catch { json = null; }
  return { status: resp.status, json };
}

// ---------------------------------------------------------------------------
// Structured input → canonical engine input. Mirrors calculate-quote's own
// mapping. NO defaults are silently substituted: a missing required field
// surfaces as missing_information from the engine.
// ---------------------------------------------------------------------------
function buildQuoteRequest(a: Record<string, unknown>) {
  const services: string[] = Array.isArray(a.services)
    ? (a.services as string[]).filter((s) => (ALLOWED_SERVICES as readonly string[]).includes(s))
    : [];
  const has = (s: string) => services.includes(s);
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? NaN : Number(v));

  return {
    homeDetails: {
      squareFootage: num(a.squareFootage),
      stories: num(a.stories),
      windowCleaningType: (a.windowCleaningType as string) || "exterior",
      condition: (a.condition as string) || "maintenance",
      showAdvanced: false,
    },
    additionalServices: {
      windowCleaning: has("window_cleaning"),
      houseWash: has("house_wash"),
      gutterCleaning: has("gutter_cleaning"),
      roofCleaning: has("roof_cleaning"),
      roofType: (a.roofType as string) || "asphalt",
      roofSeverity: (a.roofSeverity as string) || "light",
      drivewayCleaning: {
        enabled: has("driveway_cleaning"),
        sqft: num(a.drivewaySqft),
        surfaceType: (a.drivewaySurface as string) || "concrete",
      },
      pressureWashing: {
        enabled: has("pressure_washing"),
        surfaceType: (a.pressureWashSurface as string) || "concrete",
        frontPorch: { enabled: has("pressure_washing"), sqft: num(a.pressureWashSqft) },
        backPatio: { enabled: false, sqft: 0 },
        poolDeck: { enabled: false, sqft: 0 },
        walkways: { enabled: false, sqft: 0 },
      },
    },
    discount: a.discountCode ? { code: String(a.discountCode) } : null,
    __services: services,
    __address: a.address ? String(a.address) : undefined,
    __frequency: a.serviceFrequency ? String(a.serviceFrequency) : undefined,
    __customerType: a.customerType ? String(a.customerType) : undefined,
  };
}

// ---------------------------------------------------------------------------
// TOOL: calculate_bluladder_quote — the ONLY source of prices.
// ---------------------------------------------------------------------------
async function calculateQuoteTool(ctx: ToolContext, args: Record<string, unknown>) {
  const req = buildQuoteRequest(args);
  const services = req.__services;

  if (services.length === 0) {
    return {
      status: "missing_information",
      firm: false,
      missingQuestions: ["Which service(s) are you interested in?"],
      customerExplanation: "Let me know which services you'd like so I can price them.",
    };
  }

  // Flag manual-review conditions BEFORE pricing so we never present a firm price.
  const requestedText = JSON.stringify(args).toLowerCase();
  const manualHit = MANUAL_REVIEW_SERVICES.find((m) => requestedText.includes(m.replace(/_/g, " ")) || requestedText.includes(m));

  const { status, json } = await callFunction("calculate-quote", {
    homeDetails: req.homeDetails,
    additionalServices: req.additionalServices,
    discount: req.discount,
  });

  if (status === 503 || json?.status === "pricing_unavailable") {
    return {
      status: "pricing_unavailable",
      firm: false,
      customerExplanation: "Our pricing system is temporarily unavailable — I can take your details and have the team follow up right away.",
    };
  }
  if (status !== 200 || !json) {
    return { status: "error", firm: false, customerExplanation: "I couldn't calculate that just now. Let me get the team to follow up." };
  }

  // Persist latest quote snapshot (with pricing version) onto the conversation.
  await ctx.supabase
    .from("chat_conversations")
    .update({
      quote_result: json,
      pricing_version: json.ruleVersion ?? null,
      services_discussed: services,
      booking_status: json.status === "firm" ? "quoted" : "quoted",
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", ctx.conversationId);

  const firm = json.status === "firm" && !manualHit;

  // Emit a campaign event ONLY for a meaningful (firm or estimated) result, and
  // dedupe on conversation + pricing version + service set so identical repeat
  // calculations do not re-emit. Total is included only when the quote is firm.
  const quoteStatus = manualHit ? "manual_review_required" : json.status;
  if (quoteStatus === "firm" || quoteStatus === "estimated") {
    const servicesKey = [...services].sort().join(",");
    await emitCampaignEvent(ctx, "quote_calculated", {
      idempotencyKey: `quote_calculated:${ctx.conversationId}:${json.ruleVersion ?? "v0"}:${servicesKey}`,
      metadata: {
        service_types: services,
        quote_status: quoteStatus,
        pricing_version: json.ruleVersion ?? null,
        engine_version: json.engineVersion ?? null,
        manual_review: !!manualHit,
        total: firm ? json.total : null,
      },
    });
  }

  return {
    status: manualHit ? "manual_review_required" : json.status,
    firm,
    pricingVersion: json.ruleVersion ?? null,
    engineVersion: json.engineVersion,
    lineItems: json.lineItems ?? [],
    adjustments: json.discount ?? null,
    discount: json.discount ?? null,
    total: firm ? json.total : null,
    estimatedDurationMinutes: json.estimatedDurationMinutes ?? null,
    missingQuestions: json.missing ?? [],
    manualReviewReasons: manualHit
      ? [`${manualHit} requires a manual quote`, ...(json.manualReviewReasons ?? [])]
      : json.manualReviewReasons ?? [],
    customerExplanation: manualHit
      ? "That type of work needs a quick manual review by our team so we quote it correctly — I can collect your details."
      : json.explanation ?? "",
  };
}

// ---------------------------------------------------------------------------
// TOOL: get_bluladder_availability — repaired availability, IDs stripped.
// ---------------------------------------------------------------------------
async function availabilityTool(ctx: ToolContext, args: Record<string, unknown>) {
  // Require a prior firm/estimated quote so duration/price feed scheduling.
  const { data: convo } = await ctx.supabase
    .from("chat_conversations")
    .select("quote_result, service_area_status")
    .eq("id", ctx.conversationId)
    .maybeSingle();
  // Never offer bookable times for an address that isn't confirmed eligible.
  if (convo?.service_area_status !== "eligible") {
    return {
      status: "need_service_area",
      message: "Confirm the service address is in our area before offering times. Use validate_service_area first.",
    };
  }
  const quote = convo?.quote_result as any;
  if (!quote || !Array.isArray(quote.lineItems) || quote.lineItems.length === 0) {
    return { status: "need_quote_first", message: "Get a quote before checking availability." };
  }

  const services = (quote.jobberLineItems ?? quote.lineItems ?? []).map((li: any) => ({
    service: li.name ?? li.label ?? "service",
    price: Number(li.unitPrice ?? li.amount ?? 0),
  }));

  const { status, json } = await callFunction("jobber-availability", {
    services,
    startDate: (args.startDate as string) || undefined,
    daysToCheck: Math.min(Number(args.daysToCheck) || 14, 30),
    customerAddress: (args.address as string) || undefined,
    mode: "recommended",
    preference: (args.preference as string) || "none",
  });

  if (status !== 200 || !json) {
    return { status: "unavailable", message: "I couldn't load times just now — I can have the team reach out with options." };
  }
  // Withhold stale / sync-in-progress availability (the function returns a
  // customer-safe message in those cases).
  if (json.unavailable || json.stale || json.syncInProgress || json.error) {
    return { status: "unavailable", message: json.message || "Scheduling is briefly syncing — I can have the team follow up with times." };
  }

  const rawSlots: any[] = json.recommendations || json.slots || [];
  // Strip ALL internal Jobber IDs. Give each slot an opaque, per-conversation id.
  const offered = rawSlots.slice(0, 3).map((s, i) => ({
    slotId: `slot_${i + 1}`,
    startTime: s.startTime,
    endTime: s.endTime,
    displayTime: s.displayTime,
    durationMinutes: s.durationMinutes,
    // internal fields kept ONLY server-side for booking resolution
    __technicianId: s.technicianId,
    __isTeamJob: s.isTeamJob ?? false,
    __teamTechnicianIds: s.teamTechnicianIds ?? null,
  }));

  // Persist the resolver map as a tool message (auditable, server-only).
  await ctx.supabase.from("chat_messages").insert({
    conversation_id: ctx.conversationId,
    role: "tool",
    tool_name: "get_bluladder_availability",
    tool_result: { offered },
  });

  // Return only customer-safe fields to the model.
  return {
    status: "ok",
    slots: offered.map(({ slotId, startTime, endTime, displayTime, durationMinutes }) => ({
      slotId, startTime, endTime, displayTime, durationMinutes,
    })),
  };
}

// ---------------------------------------------------------------------------
// TOOL: create_bluladder_booking — explicit confirmation + prior slot required.
// ---------------------------------------------------------------------------
async function createBookingTool(ctx: ToolContext, args: Record<string, unknown>) {
  if (args.confirmed !== true) {
    return { status: "not_confirmed", message: "The customer must explicitly confirm before booking." };
  }
  const slotId = String(args.slotId || "");
  if (!slotId) return { status: "missing_slot", message: "Select an available time first." };

  // Resolve the opaque slotId back to internal IDs from the last availability offer.
  const { data: toolMsgs } = await ctx.supabase
    .from("chat_messages")
    .select("tool_result")
    .eq("conversation_id", ctx.conversationId)
    .eq("tool_name", "get_bluladder_availability")
    .order("created_at", { ascending: false })
    .limit(1);
  const offered = (toolMsgs?.[0]?.tool_result as any)?.offered as any[] | undefined;
  const slot = offered?.find((s) => s.slotId === slotId);
  if (!slot) return { status: "slot_expired", message: "That time is no longer held — let me pull fresh availability." };

  const { data: convo } = await ctx.supabase
    .from("chat_conversations")
    .select("quote_result, prospect_name, prospect_email, prospect_phone")
    .eq("id", ctx.conversationId)
    .maybeSingle();
  const quote = convo?.quote_result as any;
  if (!quote) return { status: "need_quote_first", message: "A firm quote is required before booking." };

  const email = convo?.prospect_email;
  if (!email) return { status: "missing_contact", message: "I need the customer's email to book." };

  // CONTROLLED TEST GUARD at the final booking boundary. If the customer is an
  // approved test identity (or global test-suppression is on), we simulate a
  // confirmed booking and NEVER call Jobber. This lets the full chat flow be
  // verified end-to-end without creating any live client/job/quote/visit.
  const suppression = await checkSuppression(ctx.supabase, { email, phone: convo?.prospect_phone });
  if (suppression.suppressed) {
    await ctx.supabase.from("chat_conversations").update({
      booking_status: "confirmed", last_activity_at: new Date().toISOString(),
    }).eq("id", ctx.conversationId);
    return {
      status: "confirmed",
      confirmedTime: slot.displayTime,
      simulated: true,
      message: "Booking confirmed (test identity — no live Jobber record created).",
    };
  }

  // Stable idempotency key — reused so retries never double-book.
  const idempotencyKey = `chat|${ctx.conversationId}|${slot.startTime}`;

  const { status, json } = await callFunction("jobber-create-booking", {
    customer: {
      name: convo?.prospect_name || "BluLadder Customer",
      email,
      phone: convo?.prospect_phone || "",
      address: String(args.address || ""),
    },
    technicianId: slot.__technicianId,
    isTeamJob: slot.__isTeamJob,
    teamTechnicianIds: slot.__teamTechnicianIds,
    scheduledStart: slot.startTime,
    scheduledEnd: slot.endTime,
    homeDetails: quote.__homeDetails ?? quote.homeDetails ?? {},
    additionalServices: quote.__additionalServices ?? quote.additionalServices ?? undefined,
    idempotencyKey,
  });

  if (status === 409) {
    return { status: "slot_taken", message: "That time was just taken — let me get fresh options." };
  }
  if (status === 503) {
    return { status: "temporarily_unavailable", message: "Booking is briefly unavailable — I can have the team confirm this time." };
  }
  const visitId = json?.jobberVisitId || json?.visitId;
  if (json?.status === "needs_attention" || json?.needsAttention) {
    await ctx.supabase.from("chat_conversations").update({
      booking_status: "needs_attention", needs_attention: true,
      last_error: "booking needs_attention", last_activity_at: new Date().toISOString(),
    }).eq("id", ctx.conversationId);
    return { status: "needs_attention", message: "Your appointment is being finalized and the team will confirm shortly." };
  }
  if (status !== 200 || !visitId) {
    await ctx.supabase.from("chat_conversations").update({
      booking_status: "failed", needs_attention: true, last_error: json?.error || "booking failed",
    }).eq("id", ctx.conversationId);
    return { status: "error", message: "I couldn't finalize the booking — the team will follow up to confirm." };
  }

  await ctx.supabase.from("chat_conversations").update({
    booking_status: "confirmed", last_activity_at: new Date().toISOString(),
  }).eq("id", ctx.conversationId);

  return {
    status: "confirmed",
    confirmedTime: slot.displayTime,
    message: "Booking confirmed.",
    event: "booking_completed",
  };
}

// ---------------------------------------------------------------------------
// TOOL: request_manual_quote — unconfigured / unusual work. No firm price.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// TOOL: validate_service_area — geocode-based eligibility. Never rejects/books.
// ---------------------------------------------------------------------------
async function validateServiceAreaTool(ctx: ToolContext, args: Record<string, unknown>) {
  const address = String(args.address || "").trim();
  if (!address) {
    return {
      status: "address_incomplete",
      customerMessage: "What's the full service address (street, city, ZIP)?",
    };
  }
  const result = await validateServiceArea(ctx.supabase, address);

  await ctx.supabase
    .from("chat_conversations")
    .update({
      service_address: result.formattedAddress || address,
      service_area_status: result.status,
      service_area_result: result,
      manual_review_reason:
        result.status === "manual_review_required" ? result.reason ?? "Outside primary service area" : undefined,
      needs_attention: result.status === "manual_review_required" ? true : undefined,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", ctx.conversationId);

  return {
    status: result.status,
    city: result.city,
    county: result.county,
    state: result.state,
    formattedAddress: result.formattedAddress,
    reason: result.reason,
    customerMessage: result.customerMessage,
  };
}

// ---------------------------------------------------------------------------
// TOOL: request_manual_quote — unconfigured / unusual work. No firm price.
// ---------------------------------------------------------------------------
async function manualQuoteTool(ctx: ToolContext, args: Record<string, unknown>) {
  await ctx.supabase.from("chat_conversations").update({
    prospect_name: (args.name as string) || undefined,
    prospect_email: (args.email as string) || undefined,
    prospect_phone: (args.phone as string) || undefined,
    manual_review_reason: (args.reason as string) || "Manual quote requested",
    services_discussed: Array.isArray(args.services) ? args.services : undefined,
    summary: (args.summary as string) || undefined,
    booking_status: "quoted",
    needs_attention: true,
    campaign_status: "manual_quote_requested",
    last_activity_at: new Date().toISOString(),
  }).eq("id", ctx.conversationId);

  await emitCampaignEvent(ctx, "manual_quote_requested", {
    email: (args.email as string) || undefined,
    phone: (args.phone as string) || undefined,
    subject: "AI chat manual quote",
    metadata: { service_types: Array.isArray(args.services) ? args.services : [] },
  });

  return { status: "saved", event: "manual_quote_requested", message: "Flagged for the team to prepare a manual quote." };
}

// ---------------------------------------------------------------------------
// TOOL: request_human_callback
// ---------------------------------------------------------------------------
async function humanCallbackTool(ctx: ToolContext, args: Record<string, unknown>) {
  const email = (args.email as string) || undefined;
  const phone = (args.phone as string) || undefined;
  const method = (args.contactMethod as string) || "phone";
  await ctx.supabase.from("chat_conversations").update({
    prospect_name: (args.name as string) || undefined,
    prospect_phone: phone,
    prospect_email: email,
    contact_method: (args.contactMethod as string) || undefined,
    best_time_to_contact: (args.bestTime as string) || undefined,
    manual_review_reason: (args.reason as string) || "Human callback requested",
    summary: (args.summary as string) || undefined,
    callback_requested: true,
    needs_attention: true,
    campaign_status: "callback_requested",
    last_activity_at: new Date().toISOString(),
  }).eq("id", ctx.conversationId);

  // A callback grants ONLY the consent needed to fulfil the callback request
  // (requested_follow_up), on the channel the customer chose — never marketing.
  const followUpLang = `You asked us to contact you about this request via ${method}.`;
  if ((method === "text" || method === "phone") && phone) {
    await recordConsent(ctx, { channel: "sms", consentType: "requested_follow_up", granted: true, phone, email, languageShown: followUpLang, source: "chat_callback" });
  }
  if (method === "email" && email) {
    await recordConsent(ctx, { channel: "email", consentType: "requested_follow_up", granted: true, phone, email, languageShown: followUpLang, source: "chat_callback" });
  }
  await emitCampaignEvent(ctx, "callback_requested", { email, phone, subject: "AI chat callback" });

  return { status: "saved", event: "callback_requested", message: "A team member will reach out." };
}

// ---------------------------------------------------------------------------
// Consent helpers. Consent is stored through the canonical consent service
// (record_consent), NOT only inside the chat transcript.
// ---------------------------------------------------------------------------
async function recordConsent(
  ctx: ToolContext,
  o: { channel: "sms" | "email"; consentType: "transactional" | "requested_follow_up" | "marketing"; granted: boolean; email?: string; phone?: string; languageShown: string; source: string },
) {
  try {
    await ctx.supabase.rpc("record_consent", {
      p_channel: o.channel,
      p_consent_type: o.consentType,
      p_status: o.granted ? "granted" : "revoked",
      p_email: o.email ?? null,
      p_phone: o.phone ?? null,
      p_language_shown: o.languageShown,
      p_source: o.source,
      p_conversation_id: ctx.conversationId,
      p_session_id: ctx.sessionToken,
      p_metadata: { channel_ui: ctx.channel },
    });
  } catch (e) {
    console.error("record_consent failed:", e);
  }
}

async function emitCampaignEvent(
  ctx: ToolContext,
  eventName: string,
  o: { email?: string; phone?: string; subject?: string; metadata?: Record<string, unknown>; idempotencyKey?: string },
) {
  // Routes through the shared emitter: bounded timeout, transient retries, and
  // — for critical events like consent_revoked — persistence for cron recovery.
  await emitCampaignEventShared({
    eventName,
    idempotencyKey: o.idempotencyKey ?? `${eventName}:${ctx.conversationId}`,
    email: o.email ?? null,
    phone: o.phone ?? null,
    conversationId: ctx.conversationId,
    source: "ai_chat",
    subject: o.subject ?? null,
    metadata: { lead_source: "ai_chat", ...(o.metadata ?? {}) },
    recoverySupabase: ctx.supabase,
  });
}

// ---------------------------------------------------------------------------
// TOOL: record_consent — the AI records an EXPLICIT consent decision. Marketing
// consent must be explicit and is never assumed from a phone number or chat.
// ---------------------------------------------------------------------------
async function recordConsentTool(ctx: ToolContext, args: Record<string, unknown>) {
  const channel = args.channel === "email" ? "email" : "sms";
  const consentType = ["transactional", "requested_follow_up", "marketing"].includes(String(args.consentType))
    ? (args.consentType as "transactional" | "requested_follow_up" | "marketing")
    : null;
  if (!consentType) return { status: "error", message: "Invalid consentType." };
  const granted = args.granted === true;
  const languageShown = typeof args.languageShown === "string" && args.languageShown.trim()
    ? args.languageShown.trim()
    : "Consent language not recorded.";
  const email = (args.email as string) || undefined;
  const phone = (args.phone as string) || undefined;
  if (channel === "sms" && !phone) return { status: "error", message: "Phone required for SMS consent." };
  if (channel === "email" && !email) return { status: "error", message: "Email required for email consent." };

  await recordConsent(ctx, { channel, consentType, granted, email, phone, languageShown, source: "chat_explicit" });

  if (consentType === "marketing") {
    await ctx.supabase.from("chat_conversations").update({
      marketing_consent: granted, last_activity_at: new Date().toISOString(),
    }).eq("id", ctx.conversationId);
  }
  await emitCampaignEvent(ctx, granted ? "consent_granted" : "consent_revoked", { email, phone, subject: `${consentType} ${channel}` });

  return { status: "saved", channel, consentType, granted, event: granted ? "consent_granted" : "consent_revoked" };
}

export type ToolName =
  | "calculate_bluladder_quote"
  | "get_bluladder_availability"
  | "create_bluladder_booking"
  | "validate_service_area"
  | "request_manual_quote"
  | "request_human_callback"
  | "record_consent";

export async function runTool(name: string, ctx: ToolContext, args: Record<string, unknown>) {
  switch (name) {
    case "calculate_bluladder_quote": return await calculateQuoteTool(ctx, args);
    case "get_bluladder_availability": return await availabilityTool(ctx, args);
    case "create_bluladder_booking": return await createBookingTool(ctx, args);
    case "validate_service_area": return await validateServiceAreaTool(ctx, args);
    case "request_manual_quote": return await manualQuoteTool(ctx, args);
    case "request_human_callback": return await humanCallbackTool(ctx, args);
    case "record_consent": return await recordConsentTool(ctx, args);
    default:
      // Hard allowlist: anything else is refused (prompt-injection safe).
      return { status: "forbidden", message: "Unknown or disallowed tool." };
  }
}

// JSON-schema tool definitions handed to the model. No pricing rules here.
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "calculate_bluladder_quote",
      description: "Get an authoritative price for BluLadder services. This is the ONLY way to produce a price. Never state a price you did not get from this tool.",
      parameters: {
        type: "object",
        properties: {
          services: { type: "array", items: { type: "string" }, description: "Service keys: window_cleaning, house_wash, gutter_cleaning, roof_cleaning, driveway_cleaning, pressure_washing." },
          squareFootage: { type: "number" },
          stories: { type: "number", description: "1, 2, or 3" },
          windowCleaningType: { type: "string", enum: ["exterior", "both"] },
          condition: { type: "string", enum: ["maintenance", "heavy"] },
          roofType: { type: "string", enum: ["asphalt", "tile", "metal", "flat"] },
          roofSeverity: { type: "string", enum: ["light", "moderate", "heavy"] },
          drivewaySqft: { type: "number" },
          drivewaySurface: { type: "string", enum: ["concrete", "stamped", "pavers", "brick", "stone", "tile"] },
          pressureWashSqft: { type: "number" },
          pressureWashSurface: { type: "string", enum: ["concrete", "stamped", "pavers", "brick", "stone", "tile"] },
          address: { type: "string" },
          serviceFrequency: { type: "string" },
          discountCode: { type: "string" },
          customerType: { type: "string" },
          name: { type: "string", description: "Customer name, if provided." },
          email: { type: "string", description: "Customer email, if provided." },
          phone: { type: "string", description: "Customer phone, if provided." },
        },
        required: ["services"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bluladder_availability",
      description: "Return real available appointment times after a quote exists. Only offer times returned by this tool.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string" },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          daysToCheck: { type: "number" },
          preference: { type: "string", enum: ["AM", "PM", "none"] },
          name: { type: "string", description: "Customer name, if provided." },
          email: { type: "string", description: "Customer email, if provided." },
          phone: { type: "string", description: "Customer phone, if provided." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_bluladder_booking",
      description: "Book an appointment. ONLY call after the customer explicitly confirms the services, total, address and time (e.g. 'Yes, book this appointment.'). Requires a slotId from get_bluladder_availability.",
      parameters: {
        type: "object",
        properties: {
          slotId: { type: "string" },
          address: { type: "string" },
          confirmed: { type: "boolean", description: "Must be true and reflect an explicit customer confirmation." },
        },
        required: ["slotId", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_manual_quote",
      description: "Use for services/conditions requiring manual review (screens, tracks & sills not in a package, solar-panel cleaning, mobile screen repair, commercial, unusual restoration/access). Saves details for the team. Never present a firm price for these.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" }, email: { type: "string" }, phone: { type: "string" },
          services: { type: "array", items: { type: "string" } },
          reason: { type: "string" }, summary: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_service_area",
      description: "Check whether a service address is in BluLadder's area. Call this before offering appointment times. Returns eligible, manual_review_required, address_incomplete, or validation_unavailable. Eligibility is geocoded server-side — never decide it yourself from the typed city. Do NOT proceed to booking unless status is 'eligible'.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Full street address including city, state and ZIP." },
        },
        required: ["address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_human_callback",
      description: "Use when the customer asks for a person, or when you cannot safely answer. Saves their contact and preferences for follow-up.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" }, phone: { type: "string" }, email: { type: "string" },
          contactMethod: { type: "string", enum: ["phone", "text", "email"] },
          bestTime: { type: "string" }, reason: { type: "string" }, summary: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_consent",
      description: "Record an EXPLICIT communication-consent decision the customer just made. Use a SEPARATE call for each channel/type. Never assume marketing consent from a phone number, a chat, or a quote request — only call with consentType 'marketing' when the customer explicitly opted in to occasional promotions. Use 'requested_follow_up' when they asked to be contacted about THIS request. Always pass the exact languageShown you presented. Never send SMS or email yourself.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["sms", "email"] },
          consentType: { type: "string", enum: ["transactional", "requested_follow_up", "marketing"] },
          granted: { type: "boolean" },
          email: { type: "string" },
          phone: { type: "string" },
          languageShown: { type: "string", description: "The exact consent wording shown to the customer." },
        },
        required: ["channel", "consentType", "granted", "languageShown"],
        additionalProperties: false,
      },
    },
  },
];
