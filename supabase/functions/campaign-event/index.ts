// ============================================================================
// campaign-event — canonical, server-only ingress for allowlisted campaign
// events. Turns an approved event into consent-checked, suppression-checked,
// idempotent enrollments + queued messages. Also applies stop conditions.
//
// Auth: admins OR internal service-role/cron ONLY. Events are never created by
// anonymous browsers, and the AI can only reach this via a controlled tool.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { renderTemplate, isPhoneOptedOut } from "../_shared/sms.ts";
import {
  isAllowedEvent, matchesAudience, consentSatisfies, STOP_EVENTS,
  checkSuppression, normalizeEmail, normalizePhoneE164,
  type ConsentType, type EnrollDecision, type AudienceContext,
} from "../_shared/campaignEngine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface EventBody {
  event_name?: string;
  idempotency_key?: string;
  email?: string | null;
  phone?: string | null;
  customer_id?: string | null;
  conversation_id?: string | null;
  source?: string;
  subject?: string | null;
  metadata?: Record<string, unknown>;
  simulate?: boolean; // admin preview — never writes enrollments/messages
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authz = await requireAdminOrService(req);
  if (!authz.ok) {
    // A present-but-insufficient token (authenticated non-admin) is 403;
    // a missing token is 401. Both deny the action.
    const hadToken = !!req.headers.get("Authorization");
    return json({ error: hadToken ? "Forbidden" : "Unauthorized" }, hadToken ? 403 : 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: EventBody;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const eventName = body.event_name;
  if (!isAllowedEvent(eventName)) {
    return json({ error: "unknown_event", message: `Event '${eventName}' is not allowlisted` }, 400);
  }

  const email = normalizeEmail(body.email);
  const phone = normalizePhoneE164(body.phone);

  // ---- manual_staff_takeover: administrator-only controlled action ----
  // A brief reason is REQUIRED; the takeover is deterministic per target +
  // takeover record so retries never create duplicate events. The staff
  // identity + timestamp are recorded on the conversation (source record).
  let takeoverReason: string | null = null;
  if (eventName === "manual_staff_takeover") {
    takeoverReason = typeof body.metadata?.reason === "string" ? String(body.metadata.reason).trim() : "";
    if (!takeoverReason) {
      return json({ error: "reason_required", message: "manual_staff_takeover requires a brief reason" }, 400);
    }
    // Stamp the actor + timestamp into the event metadata for the audit trail.
    body.metadata = {
      ...(body.metadata ?? {}),
      reason: takeoverReason,
      actor_id: authz.userId,
      takeover_at: new Date().toISOString(),
    };
  }

  // Deterministic idempotency key. Takeover defaults key to target + takeover
  // record so repeating the same action is idempotent even without a client key.
  const takeoverRecord = typeof body.metadata?.takeover_record_id === "string"
    ? String(body.metadata.takeover_record_id)
    : (body.conversation_id || body.customer_id || email || phone || "anon");
  const idempotencyKey = body.idempotency_key ||
    (eventName === "manual_staff_takeover"
      ? `manual_staff_takeover:${body.customer_id || body.conversation_id || email || phone || "anon"}:${takeoverRecord}`
      : `${eventName}:${body.customer_id || email || phone || "anon"}:${new Date().toISOString().slice(0, 13)}`);

  // ---- Idempotent event record (replayed webhooks return the original) ----
  let eventId: string | null = null;
  if (!body.simulate) {
    const { data: existing } = await supabase
      .from("campaign_events")
      .select("id, enrollments_created, processed_at, metadata")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing?.processed_at) {
      return json({
        idempotent: true,
        event_id: existing.id,
        decisions: (existing.metadata as Record<string, unknown>)?.decisions ?? [],
      });
    }
    if (existing) {
      eventId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("campaign_events")
        .insert({
          event_name: eventName, idempotency_key: idempotencyKey,
          customer_id: body.customer_id ?? null, conversation_id: body.conversation_id ?? null,
          email, phone, source: body.source ?? "system", subject: body.subject ?? null,
          metadata: body.metadata ?? {},
        })
        .select("id")
        .single();
      if (error) {
        // Unique violation => concurrent replay; fetch and return.
        const { data: race } = await supabase
          .from("campaign_events").select("id, metadata").eq("idempotency_key", idempotencyKey).maybeSingle();
        return json({ idempotent: true, event_id: race?.id ?? null, decisions: (race?.metadata as any)?.decisions ?? [] });
      }
      eventId = created.id;
    }
  }

  // Record the staff-takeover on the source conversation (who / when / why) so
  // the abandonment sweep and admin views can see the lead is being handled.
  if (!body.simulate && eventName === "manual_staff_takeover" && body.conversation_id) {
    await supabase.from("chat_conversations").update({
      staff_takeover_at: new Date().toISOString(),
      staff_takeover_by: authz.userId,
      staff_takeover_reason: takeoverReason,
      last_activity_at: new Date().toISOString(),
    }).eq("id", body.conversation_id);
  }

  // ---- Resolve customer + audience context ----
  let customerId = body.customer_id ?? null;
  let cust: Record<string, unknown> | null = null;
  if (!customerId && (email || phone)) {
    const { data } = await supabase.from("customers").select("*")
      .or([email ? `email.eq.${email}` : null, phone ? `phone.eq.${phone}` : null].filter(Boolean).join(","))
      .limit(1).maybeSingle();
    cust = data ?? null;
    customerId = (data?.id as string) ?? null;
  } else if (customerId) {
    const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
    cust = data ?? null;
  }

  let bookedBefore = false;
  if (customerId) {
    const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true })
      .eq("customer_id", customerId).neq("status", "cancelled");
    bookedBefore = (count ?? 0) > 0;
  }

  const optedOut = phone ? await isPhoneOptedOut(supabase, phone) : false;

  const smsGrants = await grantedTypes(supabase, "sms", email, phone);
  const emailGrants = await grantedTypes(supabase, "email", email, phone);
  const smsConsentStatus = smsGrants.length ? "granted" : (optedOut ? "revoked" : "unknown");
  const emailConsentStatus = emailGrants.length ? "granted" : "unknown";

  const meta = body.metadata ?? {};
  const ctx: AudienceContext = {
    customerType: bookedBefore ? "existing" : "new",
    bookedBefore,
    serviceTypes: Array.isArray((meta as any).service_types) ? (meta as any).service_types : [],
    quoteStatus: (meta as any).quote_status ?? null,
    manualReview: (meta as any).manual_review ?? null,
    bookingStatus: (meta as any).booking_status ?? null,
    leadSource: (meta as any).lead_source ?? null,
    serviceAreaStatus: (meta as any).service_area_status ?? null,
    city: (meta as any).city ?? null,
    tags: Array.isArray((meta as any).tags) ? (meta as any).tags : [],
    smsConsentStatus, emailConsentStatus, optedOut,
  };

  // ---- STOP events: terminate active enrollments, cancel unsent messages ----
  const stop = STOP_EVENTS[eventName];
  let stopped = 0;
  if (stop && !body.simulate && customerId) {
    // Narrow the stop to the specific quote journey when the incoming event
    // carries a durable quote_id (e.g. quote_declined for Quote A must not
    // stop pending abandonment follow-up for Quote B belonging to the same
    // customer). When no quote_id is provided, fall back to the legacy
    // customer-wide stop for that scope.
    const stopQuoteId = typeof (meta as any)?.quote_id === "string" && (meta as any).quote_id
      ? String((meta as any).quote_id)
      : null;
    stopped = await applyStop(supabase, customerId, email, phone, stop.reason, stop.scope, stopQuoteId);
  }

  // ---- Suppression (test identity / non-prod / global switch) ----
  const suppression = await checkSuppression(supabase, { email, phone });

  // ---- Enrolling: find active campaigns whose trigger matches this event ----
  const { data: campaignsRaw } = await supabase
    .from("sms_campaigns")
    // NOTE: sms_campaigns.trigger_event is legacy/deprecated — enrollment is
    // driven exclusively by event_name. The column is left in the schema for
    // now; a future cleanup migration can drop it once confirmed unused.
    .select("id, name, active, version, event_name, required_consent, audience_conditions, reentry_enabled, reentry_cooldown_hours, effective_start, effective_end, sms_campaign_steps(id, step_order, delay_hours, body_template, subject, channel, active)")
    .eq("active", true)
    .eq("event_name", eventName);

  // Effective-window gate: a campaign only enrolls while inside its scheduled
  // window. Null bounds mean unbounded (existing campaigns are unaffected).
  const nowMs = Date.now();
  const campaigns = ((campaignsRaw ?? []) as any[]).filter((c) => {
    if (c.effective_start && new Date(c.effective_start).getTime() > nowMs) return false;
    if (c.effective_end && new Date(c.effective_end).getTime() < nowMs) return false;
    return true;
  });

  const decisions: EnrollDecision[] = [];

  for (const c of campaigns as any[]) {
    const required: ConsentType = (c.required_consent as ConsentType) ?? "transactional";

    // Audience
    const aud = matchesAudience(c.audience_conditions, ctx);
    if (!aud.matched) {
      decisions.push({ campaignId: c.id, campaignName: c.name, outcome: "not_enrolled", reason: `Audience mismatch: ${aud.reasons.filter((r) => r.startsWith("✗")).join("; ")}` });
      continue;
    }

    // Consent (per required type; marketing/follow-up gated, transactional ok)
    const smsOk = consentSatisfies(required, smsGrants);
    const emailOk = consentSatisfies(required, emailGrants);
    const steps = ((c.sms_campaign_steps ?? []) as any[]).filter((s) => s.active);
    const usableSteps = steps.filter((s) => (s.channel === "email" ? emailOk : smsOk));
    if (required !== "transactional" && usableSteps.length === 0) {
      decisions.push({ campaignId: c.id, campaignName: c.name, outcome: "no_consent", reason: `No ${required} consent on required channel(s)` });
      continue;
    }

    // Duplicate / re-entry
    const identityKey = customerId ?? email ?? phone ?? "";
    const { data: activeEnr } = await supabase.from("campaign_enrollments")
      .select("id").eq("campaign_id", c.id).eq("status", "active")
      .or([customerId ? `customer_id.eq.${customerId}` : null, (!customerId && email) ? `email.eq.${email}` : null, (!customerId && phone) ? `phone.eq.${phone}` : null].filter(Boolean).join(","))
      .limit(1).maybeSingle();
    if (activeEnr) {
      decisions.push({ campaignId: c.id, campaignName: c.name, outcome: "skipped_duplicate", reason: "Already actively enrolled", enrollmentId: activeEnr.id });
      continue;
    }
    if (c.reentry_enabled === false) {
      // Block re-entry if a prior completed/stopped enrollment exists for same event.
      const { data: prior } = await supabase.from("campaign_enrollments")
        .select("id").eq("campaign_id", c.id).eq("event_name", eventName)
        .or([customerId ? `customer_id.eq.${customerId}` : null, (!customerId && email) ? `email.eq.${email}` : null, (!customerId && phone) ? `phone.eq.${phone}` : null].filter(Boolean).join(","))
        .limit(1).maybeSingle();
      if (prior) {
        decisions.push({ campaignId: c.id, campaignName: c.name, outcome: "skipped_duplicate", reason: "Re-entry disabled; prior enrollment exists" });
        continue;
      }
    }

    if (body.simulate) {
      decisions.push({ campaignId: c.id, campaignName: c.name, outcome: suppression.suppressed ? "suppressed" : "enrolled", reason: suppression.suppressed ? `Would enroll but suppressed (${suppression.reason})` : `Would enroll (${aud.reasons.join("; ")})`, scheduledMessages: usableSteps.length });
      continue;
    }

    // Create enrollment (snapshot version + steps for historical immutability).
    const snapshot = { version: c.version, required_consent: required, steps };
    const { data: enr, error: enrErr } = await supabase.from("campaign_enrollments").insert({
      customer_id: customerId, campaign_id: c.id, campaign_event_id: eventId,
      campaign_version: c.version, campaign_snapshot: snapshot, event_name: eventName,
      conversation_id: body.conversation_id ?? null, email, phone,
      status: "active", reason: aud.reasons.join("; "),
      suppressed: suppression.suppressed, suppressed_reason: suppression.suppressed ? suppression.reason : null,
    }).select("id").single();
    if (enrErr || !enr) {
      decisions.push({ campaignId: c.id, campaignName: c.name, outcome: "skipped_duplicate", reason: "Concurrent enrollment race" });
      continue;
    }

    // Schedule messages. Delivery-time suppression/consent recheck is
    // authoritative in process-sms-queue, so suppressed identities produce
    // "would have sent" rows without any external delivery.
    //
    // Merge fields resolved server-side. Missing values render safely (empty
    // string via renderTemplate) so no template can print "undefined" or "null".
    const APP_URL = Deno.env.get("APP_URL") || "https://bluladderbid.lovable.app";
    const metaLink = typeof (meta as Record<string, unknown>).quote_url === "string"
      ? String((meta as Record<string, unknown>).quote_url)
      : typeof (meta as Record<string, unknown>).link === "string"
        ? String((meta as Record<string, unknown>).link)
        : null;
    const metaQuoteId = typeof (meta as Record<string, unknown>).quote_id === "string"
      ? String((meta as Record<string, unknown>).quote_id)
      : null;
    const safeLink = metaLink || (metaQuoteId ? `${APP_URL}/quote/${metaQuoteId}` : APP_URL);
    const totalRaw = (meta as Record<string, unknown>).total;
    const totalNum = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);
    const totalStr = Number.isFinite(totalNum) && totalNum > 0
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(totalNum)
      : "";
    const firstName = (cust?.first_name as string) || "there";
    const lastName = (cust?.last_name as string) || "";
    const serviceLabel = Array.isArray(ctx.serviceTypes) && ctx.serviceTypes.length
      ? ctx.serviceTypes.join(", ")
      : "your service";
    const feedbackLine = buildDeclineFeedbackLine(
      typeof (meta as Record<string, unknown>).decline_reason === "string"
        ? String((meta as Record<string, unknown>).decline_reason)
        : null,
    );
    const vars: Record<string, string> = {
      first_name: firstName,
      last_name: lastName,
      name: `${firstName} ${lastName}`.trim() || firstName,
      service: serviceLabel,
      link: safeLink,
      total: totalStr,
      feedback_line: feedbackLine,
    };
    const now = Date.now();
    const rows = usableSteps.map((s) => ({
      to_number: s.channel === "sms" ? phone : null,
      to_email: s.channel === "email" ? email : null,
      channel: s.channel,
      body: renderTemplate(s.body_template, vars),
      subject: s.channel === "email" ? renderTemplate(s.subject ?? "", vars) : null,
      message_kind: "campaign",
      status: "pending",
      customer_id: customerId,
      campaign_id: c.id,
      campaign_step_id: s.id,
      enrollment_id: enr.id,
      send_at: new Date(now + Number(s.delay_hours) * 3600 * 1000).toISOString(),
    }));
    let scheduled = 0;
    if (rows.length) {
      const { count } = await supabase.from("sms_messages").insert(rows, { count: "exact" });
      scheduled = count ?? rows.length;
    }
    decisions.push({ campaignId: c.id, campaignName: c.name, outcome: suppression.suppressed ? "suppressed" : "enrolled", reason: aud.reasons.join("; "), enrollmentId: enr.id, scheduledMessages: scheduled });
  }

  if (!body.simulate && eventId) {
    await supabase.from("campaign_events").update({
      processed_at: new Date().toISOString(),
      enrollments_created: decisions.filter((d) => d.outcome === "enrolled" || d.outcome === "suppressed").length,
      metadata: { ...(body.metadata ?? {}), decisions, stopped },
    }).eq("id", eventId);
  }

  return json({ event_id: eventId, simulate: !!body.simulate, suppressed: suppression.suppressed, stopped, decisions });
});

// deno-lint-ignore no-explicit-any
async function grantedTypes(
  supabase: any,
  channel: "sms" | "email",
  email: string | null,
  phone: string | null,
): Promise<ConsentType[]> {
  if (channel === "sms" && !phone) return [];
  if (channel === "email" && !email) return [];
  const q = supabase.from("communication_consent").select("consent_type").eq("channel", channel).eq("status", "granted");
  const { data } = channel === "sms" ? await q.eq("phone", phone!) : await q.eq("email", email!);
  return (data ?? []).map((r: any) => r.consent_type as ConsentType);
}

// Stop active enrollments and cancel their unsent (pending) messages.
// deno-lint-ignore no-explicit-any
async function applyStop(
  supabase: any,
  customerId: string,
  email: string | null,
  phone: string | null,
  reason: string,
  scope: "all" | "abandoned" | "reminders",
  quoteId: string | null = null,
): Promise<number> {
  // Determine which campaigns are in scope by event kind.
  const campaignFilter = campaignFilterForScope(scope);

  const query = supabase.from("campaign_enrollments")
    .select("id, campaign_id, event_name, campaign_event_id")
    .eq("customer_id", customerId).eq("status", "active");
  const { data: enrollments } = await query;
  const inScope = filterEnrollmentsByScope(enrollments ?? [], campaignFilter);
  const eventIds = Array.from(new Set(inScope.map((t: any) => t.campaign_event_id).filter(Boolean)));
  const { data: events } = quoteId && eventIds.length
    ? await supabase.from("campaign_events").select("id, metadata").in("id", eventIds)
    : { data: [] as any[] };
  const targets = filterEnrollmentsByQuoteJourney(inScope, events ?? [], quoteId);
  if (!targets.length) return 0;

  const ids = targets.map((t: any) => t.id);
  await supabase.from("campaign_enrollments").update({ status: "stopped", stopped_reason: reason, stopped_at: new Date().toISOString() }).in("id", ids);
  // Cancel unsent marketing/campaign messages for those enrollments.
  await supabase.from("sms_messages").update({ status: "cancelled", error: `Stopped: ${reason}`, next_retry_at: null })
    .in("enrollment_id", ids).eq("status", "pending");
  return ids.length;
}

// ---- Pure helpers exported for unit tests ---------------------------------
export function campaignFilterForScope(
  scope: "all" | "abandoned" | "reminders",
): string[] | null {
  // "abandoned" now includes quote_declined-triggered win-back journeys so a
  // confirmed booking (or recurring plan quote acceptance) for the SAME quote
  // stops both the abandonment nurture AND the decline win-back nurture.
  // Journey scoping via quote_id keeps this narrow — an unrelated quote for
  // the same customer is not stopped.
  if (scope === "abandoned") return ["quote_abandoned", "quote_declined"];
  if (scope === "reminders") return ["appointment_rescheduled", "appointment_scheduled", "booking_completed"];
  return null;
}

// deno-lint-ignore no-explicit-any
export function filterEnrollmentsByScope(enrollments: any[], campaignFilter: string[] | null): any[] {
  if (!campaignFilter) return enrollments;
  return enrollments.filter((e) => campaignFilter.includes(e.event_name));
}

// Journey scoping: when a quoteId is supplied, only stop enrollments whose
// originating campaign event carried the same quote_id in its metadata.
// If nothing binds an enrollment to that quote, stop nothing rather than
// risk killing an independent journey.
// deno-lint-ignore no-explicit-any
export function filterEnrollmentsByQuoteJourney(
  enrollments: any[],
  events: any[],
  quoteId: string | null,
): any[] {
  if (!quoteId) return enrollments;
  const matching = new Set(
    (events ?? [])
      .filter((e) => e && e.metadata && String(e.metadata.quote_id ?? "") === quoteId)
      .map((e) => e.id),
  );
  return enrollments.filter((e) => e.campaign_event_id && matching.has(e.campaign_event_id));
}

export function buildDeclineFeedbackLine(declineReason: string | null | undefined): string {
  const r = typeof declineReason === "string" ? declineReason.trim() : "";
  return r
    ? "Thanks for that feedback — it really helps us improve."
    : "If you have a moment, reply with a quick note about what didn't fit — it helps us improve.";
}
