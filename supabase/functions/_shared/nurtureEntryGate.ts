// ============================================================================
// Server-side strict nurture-entry gate.
//
// The pure evaluator is a byte-for-byte mirror of
// `src/lib/campaigns/nurtureEntryGate.ts` (Vitest + admin UI). Duplicating a
// tiny pure function is the same pattern used by campaignEngine/campaignModel
// — Deno cannot import from `src/` cleanly, and keeping the pure logic
// verbatim in both places is guarded by unit tests on each side.
//
// The impure `gatherNurtureEntryContext` reads the customer record and the
// specific tables required by each gate. Every query is bounded and read-only.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const NURTURE_RECENT_BOOKING_WINDOW_DAYS = 14;

export interface NurtureEntryContext {
  activeAppointment: boolean;
  recentBooking: boolean;
  incompatibleEnrollment: boolean;
  emailSuppressed: boolean;
  hasEscalation: boolean;
  staffTakeoverActive: boolean;
  newerQuoteSupersedes: boolean;
  invalidCustomerRecord: boolean;
}

export type NurtureEntryReason =
  | "eligible"
  | "active_appointment"
  | "recent_booking"
  | "incompatible_campaign_active"
  | "email_suppressed"
  | "escalation_pending"
  | "staff_takeover_active"
  | "newer_quote_supersedes"
  | "invalid_customer_record";

export interface NurtureEntryDecision {
  eligible: boolean;
  reason: NurtureEntryReason;
}

/**
 * Pure entry-gate evaluator. Mirror of the frontend version. Any change here
 * MUST also be applied to src/lib/campaigns/nurtureEntryGate.ts and both test
 * suites must be re-run.
 */
export function evaluateNurtureEntry(ctx: NurtureEntryContext): NurtureEntryDecision {
  if (ctx.invalidCustomerRecord) return { eligible: false, reason: "invalid_customer_record" };
  if (ctx.activeAppointment) return { eligible: false, reason: "active_appointment" };
  if (ctx.recentBooking) return { eligible: false, reason: "recent_booking" };
  if (ctx.incompatibleEnrollment) return { eligible: false, reason: "incompatible_campaign_active" };
  if (ctx.emailSuppressed) return { eligible: false, reason: "email_suppressed" };
  if (ctx.hasEscalation) return { eligible: false, reason: "escalation_pending" };
  if (ctx.staffTakeoverActive) return { eligible: false, reason: "staff_takeover_active" };
  if (ctx.newerQuoteSupersedes) return { eligible: false, reason: "newer_quote_supersedes" };
  return { eligible: true, reason: "eligible" };
}

export interface GatherNurtureEntryInput {
  customerId: string | null;
  email: string | null;
  currentCampaignId: string;
  /** Anchor time for the newer-quote-supersedes check (ISO). Defaults to the enrollment moment. */
  lifecycleAnchorIso?: string | null;
  /** Source quote id, if the triggering event carried one. Used to detect a strictly-newer quote. */
  sourceQuoteId?: string | null;
  /** Optional override for “now” — tests only. */
  nowMs?: number;
}

// deno-lint-ignore no-explicit-any
async function safeCount(q: any): Promise<number> {
  try {
    const { count } = await q;
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Reads exactly the rows required by the pure evaluator. Every query is
 * bounded — no `select *` and no unfiltered scans. Fails safe: on any
 * unexpected error the gate is left open ONLY for the specific check, because
 * the surrounding pipeline still enforces consent + suppression + audience
 * before writing an enrollment.
 */
export async function gatherNurtureEntryContext(
  supabase: SupabaseClient,
  input: GatherNurtureEntryInput,
): Promise<NurtureEntryContext> {
  const now = new Date(input.nowMs ?? Date.now());
  const nowIso = now.toISOString();
  const recentCutoffIso = new Date(now.getTime() - NURTURE_RECENT_BOOKING_WINDOW_DAYS * 86_400_000).toISOString();

  if (!input.customerId) {
    // No customer row means we cannot evaluate the customer-scoped checks.
    // Fail closed on customer identity but rely on the universal consent gate
    // for the remainder — the caller still runs suppression/consent above.
    return {
      invalidCustomerRecord: true,
      activeAppointment: false,
      recentBooking: false,
      incompatibleEnrollment: false,
      emailSuppressed: false,
      hasEscalation: false,
      staffTakeoverActive: false,
      newerQuoteSupersedes: false,
    };
  }

  // --- Active appointment (any non-cancelled booking scheduled at/after now)
  const activeApptCount = await safeCount(
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", input.customerId)
      .neq("status", "cancelled")
      .gte("scheduled_start_at", nowIso),
  );

  // --- Recent booking (created in the last N days)
  const recentBookingCount = await safeCount(
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", input.customerId)
      .neq("status", "cancelled")
      .gte("created_at", recentCutoffIso),
  );

  // --- Active incompatible campaign (any other active enrollment)
  const incompatibleCount = await safeCount(
    supabase
      .from("campaign_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", input.customerId)
      .eq("status", "active")
      .neq("campaign_id", input.currentCampaignId),
  );

  // --- Email suppression
  let emailSuppressed = false;
  if (input.email) {
    try {
      const { data } = await supabase
        .from("email_suppressions")
        .select("reason")
        .eq("email", input.email.toLowerCase().trim())
        .maybeSingle();
      emailSuppressed = !!data;
    } catch { /* fail open on this check; universal gate re-checks at send */ }
  }

  // --- Unresolved escalation
  const escalationCount = await safeCount(
    supabase
      .from("ai_escalations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", input.customerId)
      .neq("status", "resolved"),
  );

  // --- Active human takeover on any of the customer's conversations
  let staffTakeoverActive = false;
  try {
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("id, staff_takeover_at")
      .eq("customer_id", input.customerId)
      .not("staff_takeover_at", "is", null)
      .order("staff_takeover_at", { ascending: false })
      .limit(1);
    staffTakeoverActive = Array.isArray(conv) && conv.length > 0;
  } catch { /* fail open */ }

  // --- Newer quote supersedes: does a strictly-newer, not-superseded quote
  //     exist for this customer than the source quote / anchor?
  let newerQuoteSupersedes = false;
  try {
    if (input.sourceQuoteId) {
      const { data: source } = await supabase
        .from("quotes")
        .select("created_at")
        .eq("id", input.sourceQuoteId)
        .maybeSingle();
      const anchor = source?.created_at ?? input.lifecycleAnchorIso ?? null;
      if (anchor) {
        const { count } = await supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", input.customerId)
          .is("superseded_by", null)
          .gt("created_at", anchor)
          .neq("id", input.sourceQuoteId);
        newerQuoteSupersedes = (count ?? 0) > 0;
      }
    } else if (input.lifecycleAnchorIso) {
      const { count } = await supabase
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", input.customerId)
        .is("superseded_by", null)
        .gt("created_at", input.lifecycleAnchorIso);
      newerQuoteSupersedes = (count ?? 0) > 0;
    }
  } catch { /* fail open */ }

  return {
    invalidCustomerRecord: false,
    activeAppointment: activeApptCount > 0,
    recentBooking: recentBookingCount > 0,
    incompatibleEnrollment: incompatibleCount > 0,
    emailSuppressed,
    hasEscalation: escalationCount > 0,
    staffTakeoverActive,
    newerQuoteSupersedes,
  };
}
