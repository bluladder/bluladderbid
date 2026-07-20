// ============================================================================
// campaign-transition-replay — operations-admin-only backfill for persisted
// `quote_follow_up_completed` events whose ORIGINAL processing produced no
// enrollment because the destination long-term nurture campaign was inactive.
//
// Contract (mirrors the requirements 1:1):
//   * Query persisted completion events.
//   * Exclude events already successfully replayed for the same destination
//     campaign version (deterministic replay idempotency key).
//   * Recheck live eligibility (consent, opt-out, suppression, booking,
//     staff-takeover, superseded quote lifecycle).
//   * Submit through campaign-event with the NEW replay key — never insert
//     enrollments or queue rows here.
//   * Preserve original event id, source enrollment, source campaign+version,
//     quote id, customer id, attribution, service info, completion timestamp.
//   * Support dry_run that reports the outcome buckets and writes nothing.
//
// Auth: operations-admin OR service-role only. Rejected otherwise.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { isPhoneOptedOut } from "../_shared/sms.ts";
import { checkSuppression } from "../_shared/campaignEngine.ts";
import {
  backfillReplayIdempotencyKey,
  buildReplayMetadata,
  evaluateBackfill,
  type BackfillOutcome,
  type SourceCompletionEvent,
} from "../_shared/campaignTransitionReplay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface Body {
  dry_run?: boolean;
  destination_campaign_id?: string;
  limit?: number;
}

// Long-term nurture campaign id (seeded inactive; owner activates later).
const DEFAULT_DESTINATION_ID = "44444444-4444-4444-9444-444444444444";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authz = await requireAdminOrService(req);
  if (!authz.ok) {
    const hadToken = !!req.headers.get("Authorization");
    return json({ error: hadToken ? "Forbidden" : "Unauthorized" }, hadToken ? 403 : 401);
  }

  let body: Body = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch { body = {}; }
  const dryRun = !!body.dry_run;
  const destinationId = body.destination_campaign_id || DEFAULT_DESTINATION_ID;
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Destination campaign snapshot — replay key is versioned so a bumped
  // destination version produces a fresh (distinct) replay event.
  const { data: dest } = await supabase
    .from("sms_campaigns")
    .select("id, name, version, active, event_name")
    .eq("id", destinationId).maybeSingle();
  if (!dest) return json({ error: "destination_campaign_not_found" }, 404);

  // Historical completion events, oldest first.
  const { data: events } = await supabase
    .from("campaign_events")
    .select("id, customer_id, email, phone, processed_at, metadata")
    .eq("event_name", "quote_follow_up_completed")
    .not("processed_at", "is", null)
    .order("processed_at", { ascending: true })
    .limit(limit);

  const buckets: Record<BackfillOutcome, number> = {
    eligible: 0, already_replayed: 0, already_enrolled: 0, booked: 0,
    no_consent: 0, opted_out: 0, suppressed: 0, human_takeover: 0,
    superseded: 0, invalid_event: 0,
  };
  const details: { event_id: string; outcome: BackfillOutcome; replay_key?: string; replay_event_id?: string }[] = [];
  let submitted = 0;

  for (const raw of (events ?? []) as SourceCompletionEvent[]) {
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;
    const replayKey = backfillReplayIdempotencyKey(raw.id, dest.id, dest.version);

    // Prior successful replay?
    const { data: prior } = await supabase
      .from("campaign_events")
      .select("id, processed_at").eq("idempotency_key", replayKey).maybeSingle();
    const alreadyReplayed = !!prior?.processed_at;

    // Already actively enrolled in the destination campaign?
    let alreadyEnrolled = false;
    if (raw.customer_id) {
      const { data: enr } = await supabase.from("campaign_enrollments")
        .select("id").eq("campaign_id", dest.id).eq("status", "active")
        .eq("customer_id", raw.customer_id).limit(1).maybeSingle();
      alreadyEnrolled = !!enr;
    }

    // Booking check — any non-cancelled booking excludes the customer.
    let hasBooking = false;
    if (raw.customer_id) {
      const { count } = await supabase.from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", raw.customer_id).neq("status", "cancelled");
      hasBooking = (count ?? 0) > 0;
    }

    // Marketing consent (SMS OR email) — destination requires marketing consent.
    let marketingConsent = false;
    {
      const or: string[] = [];
      if (raw.email) or.push(`email.eq.${raw.email}`);
      if (raw.phone) or.push(`phone.eq.${raw.phone}`);
      if (or.length) {
        const { data: consents } = await supabase.from("communication_consent")
          .select("consent_type, status").eq("status", "granted")
          .or(or.join(","));
        marketingConsent = (consents ?? []).some((c: { consent_type: string }) => c.consent_type === "marketing");
      }
    }

    const optedOut = raw.phone ? await isPhoneOptedOut(supabase, raw.phone) : false;
    const supp = await checkSuppression(supabase, { email: raw.email, phone: raw.phone });

    // Staff takeover — any active takeover on this customer's conversations.
    let humanTakeover = false;
    if (raw.customer_id) {
      const { data: convo } = await supabase.from("chat_conversations")
        .select("id, staff_takeover_at").eq("customer_id", raw.customer_id)
        .not("staff_takeover_at", "is", null).limit(1).maybeSingle();
      humanTakeover = !!convo?.staff_takeover_at;
    }

    // Superseded by newer quote lifecycle — any quote_calculated / quote_abandoned
    // event processed AFTER this completion, for the same customer.
    let superseded = false;
    if (raw.customer_id && raw.processed_at) {
      const { data: newer } = await supabase.from("campaign_events")
        .select("id").eq("customer_id", raw.customer_id)
        .in("event_name", ["quote_calculated", "quote_abandoned"])
        .gt("processed_at", raw.processed_at).limit(1).maybeSingle();
      superseded = !!newer;
    }

    const decision = evaluateBackfill({
      hasEventId: !!raw.id,
      hasCustomerIdentity: !!(raw.customer_id || raw.email || raw.phone),
      alreadyReplayed,
      alreadyEnrolledInDestination: alreadyEnrolled,
      hasBooking,
      marketingConsentGranted: marketingConsent,
      optedOut,
      suppressed: supp.suppressed,
      humanTakeover,
      supersededByNewerQuoteLifecycle: superseded,
    });
    buckets[decision.outcome]++;

    if (dryRun) {
      details.push({ event_id: raw.id, outcome: decision.outcome, replay_key: replayKey });
      continue;
    }
    if (decision.outcome !== "eligible") {
      details.push({ event_id: raw.id, outcome: decision.outcome });
      continue;
    }

    // Live path: submit ONLY through canonical campaign-event with the new
    // replay key. campaign-event handles the actual audience/consent/suppression
    // rechecks + enrollment insert + queue insert. This function never
    // inserts campaign_enrollments or sms_messages directly.
    const replayMeta = buildReplayMetadata(raw, dest.id, dest.version);
    const bearer = req.headers.get("Authorization") ?? `Bearer ${SERVICE_ROLE_KEY}`;
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/campaign-event`, {
      method: "POST",
      headers: {
        "Authorization": bearer,
        "Content-Type": "application/json",
        "apikey": SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        event_name: "quote_follow_up_completed",
        idempotency_key: replayKey,
        customer_id: raw.customer_id,
        email: raw.email,
        phone: raw.phone,
        source: "campaign_transition_replay",
        metadata: replayMeta,
      }),
    });
    const outJson = await resp.json().catch(() => ({}));
    submitted++;
    details.push({
      event_id: raw.id,
      outcome: "eligible",
      replay_key: replayKey,
      replay_event_id: (outJson as { event_id?: string })?.event_id,
    });

    // Replay relationship is preserved on the destination event's metadata
    // via buildReplayMetadata (see the `replay` block). The audit trail lives
    // in campaign_events; no second audit surface is introduced here.
  }

  return json({
    destination: { id: dest.id, name: dest.name, version: dest.version, active: dest.active },
    dry_run: dryRun,
    scanned: (events ?? []).length,
    submitted,
    outcomes: buckets,
    details,
  });
});