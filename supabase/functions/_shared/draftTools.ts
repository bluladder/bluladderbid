// ============================================================================
// draftTools — Phase 2 read-only + quote-building tool layer for AI-assisted
// draft SMS replies.
//
// Contract (hard rules):
//   * Only the tools in DRAFT_TOOL_ALLOWLIST are ever executed. The allowlist
//     is a code-reviewed constant — the model cannot expand it.
//   * Every tool is either read-only (verified live context) or scope-limited
//     to the bound conversation's canonical quote_session. NO tool can send
//     messages, book, reschedule, cancel, modify prices, or write to any
//     customer record beyond the conversation's own quote_session.
//   * When the resolved conversation is AMBIGUOUS / UNRESOLVED, customer-
//     scoped tools return an empty snapshot so a wrong identity can never
//     leak into a draft.
//   * calculate_quote reuses the canonical pricing engine (pricingEngine.ts +
//     loadPricing) — the exact same code path calculate-quote serves — so
//     there is only ONE authoritative quote source.
//   * Tool results are compact JSON, safe to feed back to the model.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { loadPricing } from "./loadPricing.ts";
import { calculateQuote, type QuoteInput } from "./pricingEngine.ts";
import {
  findOrCreateForConversation,
  mergeFields,
  computeRequired,
  type QuoteSession,
  type QuoteSessionFields,
} from "./quoteSession.ts";

type SB = any;

export const DRAFT_TOOL_ALLOWLIST = [
  "get_customer_context",
  "get_quote_session",
  "update_quote_session",
  "list_recent_quotes",
  "list_upcoming_bookings",
  "get_service_area",
  "get_pricing_summary",
  "search_business_knowledge",
  "calculate_quote",
] as const;

export type DraftToolName = (typeof DRAFT_TOOL_ALLOWLIST)[number];

export interface DraftToolContext {
  supabase: SB;
  conversationId: string;
}

export interface DraftToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface DraftToolResult {
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

// Tool descriptors surfaced to the model. Kept compact — each schema is
// intentionally narrow to prevent over-collection.
export function draftToolDescriptors() {
  const t = (name: DraftToolName, description: string, params: Record<string, unknown> = {}) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties: params, additionalProperties: false },
    },
  });
  return [
    t("get_customer_context", "Resolved customer facts (name, phone, email, address, services discussed). Empty when the thread is unresolved."),
    t("get_quote_session", "Current progressive quote session: fields captured, remaining required fields, and last quote result if any."),
    t(
      "update_quote_session",
      "Patch fields on the conversation's quote session (address, sqft, stories, window scope, etc). Never sends anything. Used to record what the customer just told you.",
      {
        squareFootage: { type: "number" },
        stories: { type: "number" },
        windowCleaningType: { type: "string", enum: ["exterior", "both"] },
        windowCleaningScope: { type: "string", enum: ["whole_home", "partial", "commercial_custom"] },
        windowCleaningSides: { type: "string", enum: ["outside_only", "inside_and_outside"] },
        windowCount: { type: "number" },
        address: { type: "string" },
        city: { type: "string" },
        services: { type: "array", items: { type: "string" } },
        drivewaySqft: { type: "number" },
        pressureWashSqft: { type: "number" },
      },
    ),
    t("list_recent_quotes", "Up to 3 most recent quotes for the resolved customer (id, total, status, updated_at, services)."),
    t("list_upcoming_bookings", "Up to 3 upcoming bookings for the resolved customer (reference, start, end, address, status)."),
    t("get_service_area", "Service area configuration (allowed cities / zips / drive-time cap)."),
    t("get_pricing_summary", "High-level pricing summary (per-sqft base rates, minimums) from live pricing_config."),
    t("search_business_knowledge", "Search verified published business knowledge.", {
      query: { type: "string" },
    }),
    t(
      "calculate_quote",
      "Run the CANONICAL pricing engine on the current quote session and store the result on the session. This is the only source of truth for prices. Nothing is sent.",
    ),
  ];
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
async function loadConversation(supabase: SB, conversationId: string) {
  const { data } = await supabase
    .from("chat_conversations")
    .select(
      "id, prospect_name, prospect_email, prospect_phone, service_address, services_discussed, quote_result, quote_session_id, customer_id, resolution_confidence",
    )
    .eq("id", conversationId)
    .maybeSingle();
  return data;
}

function isAmbiguous(convo: any): boolean {
  if (!convo) return true;
  const c = convo.resolution_confidence;
  return c === "ambiguous" || c === "unknown" || !convo.customer_id;
}

async function ensureSession(supabase: SB, conversationId: string): Promise<QuoteSession | null> {
  const convo = await loadConversation(supabase, conversationId);
  if (!convo) return null;
  return await findOrCreateForConversation(supabase, {
    conversationId,
    channel: "sms",
    phone: convo.prospect_phone ?? null,
    email: convo.prospect_email ?? null,
  });
}

// Map QuoteSessionFields -> QuoteInput shape used by pricingEngine.
function fieldsToQuoteInput(fields: QuoteSessionFields): QuoteInput {
  const services = new Set(fields.services ?? []);
  const home = {
    squareFootage: Number(fields.squareFootage ?? 0),
    stories: Number(fields.stories ?? 1),
    windowCleaningType: fields.windowCleaningType,
    condition: fields.condition,
  };
  const svc: any = {};
  if (services.has("windowCleaning")) svc.windowCleaning = true;
  if (services.has("houseWash")) svc.houseWash = true;
  if (services.has("gutters") || services.has("gutterCleaning")) svc.gutterCleaning = true;
  if (services.has("roofCleaning")) {
    svc.roofCleaning = true;
    if (fields.roofType) svc.roofType = fields.roofType;
    if (fields.roofSeverity) svc.roofSeverity = fields.roofSeverity;
  }
  if (services.has("driveway") && fields.drivewaySqft) {
    svc.drivewayCleaning = { enabled: true, sqft: fields.drivewaySqft, surfaceType: fields.drivewaySurface ?? "concrete" };
  }
  if (services.has("pressureWashing") && fields.pressureWashSqft) {
    const sqft = fields.pressureWashSqft;
    svc.pressureWashing = {
      enabled: true,
      surfaceType: fields.pressureWashSurface ?? "concrete",
      frontPorch: { enabled: false, sqft: 0 },
      backPatio: { enabled: true, sqft },
      poolDeck: { enabled: false, sqft: 0 },
      walkways: { enabled: false, sqft: 0 },
    };
  }
  return { homeDetails: home, additionalServices: svc };
}

// -----------------------------------------------------------------------
// Executor
// -----------------------------------------------------------------------
export async function executeDraftTool(
  ctx: DraftToolContext,
  call: DraftToolCall,
): Promise<DraftToolResult> {
  if (!DRAFT_TOOL_ALLOWLIST.includes(call.name as DraftToolName)) {
    return { name: call.name, ok: false, error: "tool_not_allowed" };
  }
  const args = call.arguments ?? {};
  try {
    switch (call.name as DraftToolName) {
      case "get_customer_context": {
        const convo = await loadConversation(ctx.supabase, ctx.conversationId);
        if (!convo) return { name: call.name, ok: false, error: "conversation_not_found" };
        if (isAmbiguous(convo)) {
          return { name: call.name, ok: true, data: { resolved: false } };
        }
        return {
          name: call.name, ok: true,
          data: {
            resolved: true,
            name: convo.prospect_name,
            phone: convo.prospect_phone,
            email: convo.prospect_email,
            address: convo.service_address,
            servicesDiscussed: convo.services_discussed ?? [],
          },
        };
      }
      case "get_quote_session": {
        const session = await ensureSession(ctx.supabase, ctx.conversationId);
        if (!session) return { name: call.name, ok: false, error: "no_session" };
        return {
          name: call.name, ok: true,
          data: {
            fields: session.fields,
            requiredRemaining: computeRequired(session.fields),
            quoteStatus: session.quoteStatus,
          },
        };
      }
      case "update_quote_session": {
        const session = await ensureSession(ctx.supabase, ctx.conversationId);
        if (!session) return { name: call.name, ok: false, error: "no_session" };
        const patch: Partial<QuoteSessionFields> = {};
        const allow: (keyof QuoteSessionFields)[] = [
          "squareFootage", "stories", "windowCleaningType", "windowCleaningScope",
          "windowCleaningSides", "windowCount", "address", "city", "services",
          "drivewaySqft", "pressureWashSqft",
        ];
        for (const k of allow) {
          if (args[k as string] !== undefined) (patch as any)[k] = args[k as string];
        }
        const merged = mergeFields(session, patch);
        await ctx.supabase.from("quote_sessions").update({
          fields: merged.fields,
          field_status: merged.fieldStatus,
          required_remaining: computeRequired(merged.fields),
        }).eq("id", session.id);
        return {
          name: call.name, ok: true,
          data: { fields: merged.fields, requiredRemaining: computeRequired(merged.fields) },
        };
      }
      case "list_recent_quotes": {
        const convo = await loadConversation(ctx.supabase, ctx.conversationId);
        if (!convo || isAmbiguous(convo)) return { name: call.name, ok: true, data: [] };
        const { data } = await ctx.supabase.from("quotes")
          .select("id, total, status, services_json, updated_at")
          .eq("customer_id", convo.customer_id)
          .order("updated_at", { ascending: false })
          .limit(3);
        return { name: call.name, ok: true, data: data ?? [] };
      }
      case "list_upcoming_bookings": {
        const convo = await loadConversation(ctx.supabase, ctx.conversationId);
        if (!convo || isAmbiguous(convo)) return { name: call.name, ok: true, data: [] };
        const { data } = await ctx.supabase.from("bookings")
          .select("id, booking_reference, scheduled_start, scheduled_end, service_address, status")
          .eq("customer_id", convo.customer_id)
          .gte("scheduled_start", new Date().toISOString())
          .order("scheduled_start", { ascending: true })
          .limit(3);
        return { name: call.name, ok: true, data: data ?? [] };
      }
      case "get_service_area": {
        const { data } = await ctx.supabase.from("service_area_config").select("*").limit(1).maybeSingle();
        return { name: call.name, ok: true, data: data ?? null };
      }
      case "get_pricing_summary": {
        const loaded = await loadPricing(ctx.supabase);
        if (!loaded.ok || !loaded.pricing) {
          return { name: call.name, ok: false, error: "pricing_unavailable" };
        }
        const p: any = loaded.pricing;
        return {
          name: call.name, ok: true,
          data: {
            ruleVersion: loaded.ruleVersion,
            window_cleaning: p.window_cleaning,
            house_wash: p.house_wash,
            gutter_cleaning: p.gutter_cleaning,
            roof_cleaning: p.roof_cleaning,
            driveway_cleaning: p.driveway_cleaning,
            pressure_washing: p.pressure_washing,
          },
        };
      }
      case "search_business_knowledge": {
        const q = String(args.query ?? "").trim().toLowerCase().slice(0, 120);
        const { data } = await ctx.supabase.from("business_knowledge")
          .select("category, title, content")
          .eq("is_active", true).eq("review_status", "published")
          .order("sort_order").limit(200);
        const rows = (data ?? []) as any[];
        const scored = q
          ? rows.filter((r) => (r.title + " " + r.content + " " + r.category).toLowerCase().includes(q))
          : rows;
        return { name: call.name, ok: true, data: scored.slice(0, 8) };
      }
      case "calculate_quote": {
        const session = await ensureSession(ctx.supabase, ctx.conversationId);
        if (!session) return { name: call.name, ok: false, error: "no_session" };
        const required = computeRequired(session.fields);
        if (required.length > 0) {
          return {
            name: call.name, ok: true,
            data: { status: "missing_information", missing: required },
          };
        }
        const loaded = await loadPricing(ctx.supabase);
        if (!loaded.ok || !loaded.pricing) {
          return { name: call.name, ok: false, error: "pricing_unavailable" };
        }
        const input = fieldsToQuoteInput(session.fields);
        const result = calculateQuote(input, loaded.pricing, loaded.ruleVersion);
        // Persist result on the session so the admin UI panel and future turns
        // both see the same authoritative quote.
        await ctx.supabase.from("quote_sessions").update({
          last_quote_result: result,
          quote_status: result.status === "firm" ? "firm"
            : result.status === "estimated" ? "estimated"
            : result.status === "manual_review_required" ? "manual_review"
            : "error",
        }).eq("id", session.id);
        return {
          name: call.name, ok: true,
          data: {
            status: result.status,
            total: result.total,
            subtotal: result.subtotal,
            lineItems: result.lineItems.map((li) => ({ label: li.label, amount: li.amount })),
            explanation: result.explanation,
          },
        };
      }
    }
  } catch (e) {
    return { name: call.name, ok: false, error: `exception:${String(e).slice(0, 120)}` };
  }
  return { name: call.name, ok: false, error: "unhandled_tool" };
}

/** Small helper used by tests + admin UI to render the current quote-context
 *  snapshot without duplicating executor logic. */
export async function loadQuoteContextSnapshot(supabase: SB, conversationId: string) {
  const session = await ensureSession(supabase, conversationId);
  if (!session) return null;
  const { data: row } = await supabase
    .from("quote_sessions")
    .select("id, fields, required_remaining, quote_status, last_quote_result, updated_at")
    .eq("id", session.id)
    .maybeSingle();
  return row ?? null;
}