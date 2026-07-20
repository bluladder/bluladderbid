// ============================================================================
// Regression tests for the nurture backfill / lifecycle transition correction.
//
// These are pure source/config-inspection tests. They run offline: no live
// SMS, email, Jobber, CallRail, Meta, or Resend traffic is generated.
//
// They prove the exact contract the requirements enumerate:
//   * Reposting the ORIGINAL processed idempotency key returns the stored
//     empty decisions and cannot serve as the historical backfill mechanism.
//   * The NEW replay idempotency key is a distinct namespace.
//   * The backfill routes only through campaign-event — no direct enrollment
//     inserts, no direct queue inserts, no second scheduler.
//   * Deterministic per-(source, destination, version) replay + duplicate
//     protection.
//   * validateActivation blocks activation of a campaign with zero active
//     steps (the empty-nurture guard).
//   * Future automatic enrollment continues to flow through campaign-event.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateActivation } from "@/lib/campaigns/campaignModel";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const campaignEvent = read("supabase/functions/campaign-event/index.ts");
const replayFn = read("supabase/functions/campaign-transition-replay/index.ts");
const replayLib = read("supabase/functions/_shared/campaignTransitionReplay.ts");
const sweep = read("supabase/functions/_shared/campaignSweep.ts");
const lifecycleLib = read("supabase/functions/_shared/lifecycleBookingCheck.ts");

describe("original-key replay is NOT the historical backfill mechanism", () => {
  it("campaign-event returns the ORIGINAL stored decisions when the same key is reposted", () => {
    // The idempotent gate returns {idempotent:true, decisions: existing.metadata.decisions ?? []}.
    // For historical `quote_follow_up_completed` events processed while the
    // destination was inactive, the stored decisions are []. Reposting
    // therefore cannot enroll — this is the exact defect the correction fixes.
    expect(campaignEvent).toMatch(/existing\?\.processed_at/);
    expect(campaignEvent).toMatch(/idempotent:\s*true[\s\S]{0,200}decisions:\s*\(existing\.metadata[^)]*\)\?\.decisions\s*\?\?\s*\[\]/);
  });
});

describe("new deterministic replay key uses a distinct namespace", () => {
  it("format is campaign_transition_replay:{eventId}:{destinationCampaignId}:v{version}", () => {
    expect(replayLib).toMatch(/`campaign_transition_replay:\$\{sourceEventId\}:\$\{destinationCampaignId\}:v\$\{v\}`/);
  });
  it("does not collide with the completion-event key namespace", () => {
    expect(replayLib).not.toMatch(/quote_follow_up_completed:\$\{/);
  });
});

describe("backfill submits ONLY through campaign-event", () => {
  it("POSTs to /functions/v1/campaign-event with the replay key", () => {
    expect(replayFn).toMatch(/functions\/v1\/campaign-event/);
    expect(replayFn).toMatch(/idempotency_key:\s*replayKey/);
    expect(replayFn).toMatch(/event_name:\s*["']quote_follow_up_completed["']/);
  });
  it("never inserts campaign_enrollments or sms_messages directly", () => {
    expect(replayFn).not.toMatch(/\.from\(["']campaign_enrollments["']\)[\s\S]{0,120}\.insert\(/);
    expect(replayFn).not.toMatch(/\.from\(["']sms_messages["']\)[\s\S]{0,120}\.insert\(/);
  });
  it("does not introduce a second scheduler", () => {
    expect(replayFn).not.toMatch(/Deno\.cron/);
    expect(replayFn).not.toMatch(/setInterval/);
  });
  it("skips submission entirely under dry_run", () => {
    // The live fetch to campaign-event must sit after `if (dryRun) { … continue; }`.
    const dryIdx = replayFn.indexOf("if (dryRun)");
    const fetchIdx = replayFn.indexOf("functions/v1/campaign-event");
    expect(dryIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(dryIdx);
  });
});

describe("eligibility checks + preserved audit fields", () => {
  it("rechecks marketing consent, opt-out, suppression, booking, takeover, and superseding quote lifecycle", () => {
    expect(replayFn).toMatch(/isPhoneOptedOut/);
    expect(replayFn).toMatch(/checkSuppression/);
    expect(replayFn).toMatch(/consent_type.*marketing|marketing.*consent_type/);
    // Booking check is delegated to the shared source-lifecycle-scoped
    // helper; the raw `.from("bookings")` call lives in that helper.
    expect(replayFn).toMatch(/hasLifecycleBlockingBooking/);
    expect(lifecycleLib).toMatch(/\.from\(["']bookings["']\)/);
    expect(replayFn).toMatch(/staff_takeover_at/);
    expect(replayFn).toMatch(/\.in\(["']event_name["'][\s\S]*?quote_calculated[\s\S]*?quote_abandoned/);
  });
  it("preserves original event id, source enrollment, campaign+version, quote id, customer id, attribution, service info, timestamp", () => {
    for (const field of [
      "quote_id", "customer_id", "source_enrollment_id",
      "source_campaign_id", "source_campaign_version",
      "original_event_id", "original_completed_at",
      "attribution", "utm_params_json", "service_types", "pricing_rule_version",
    ]) {
      expect(replayLib).toContain(field);
    }
  });
});

describe("empty-campaign activation guard (existing validateActivation)", () => {
  it("cannot activate a campaign with zero active steps", () => {
    const res = validateActivation(
      {
        id: "44444444-4444-4444-9444-444444444444",
        name: "BluLadder Long-Term Home Care Nurture (Post 12-Month)",
        description: "test",
        status: "active",
        active: true,
        event_name: "quote_follow_up_completed",
        version: 1,
        allowed_channels: ["sms", "email"],
        required_consent: "marketing",
        reentry_enabled: false,
        reentry_cooldown_hours: null,
        effective_start: null,
        effective_end: null,
        abandonment_delay_minutes: null,
        stop_conditions: {
          on_reply: "stop", on_booking: "stop",
          on_cancellation: "stop", on_takeover: "stop",
        },
        audience_conditions: { opted_out: false },
      } as unknown as Parameters<typeof validateActivation>[0],
      [],
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/at least one active step/i);
  });
});

describe("future automatic enrollment continues via the canonical path", () => {
  // (regression suite for booking-scope correction lives below)
  it("quote_follow_up_completed is allowlisted and emitted by the completion sweep, not the backfill", () => {
    expect(sweep).toMatch(/quote_follow_up_completed/);
    expect(sweep).toMatch(/emitCampaignEvent/);
    // Sanity: the sweep is unchanged by this correction.
    expect(sweep).toMatch(/runFollowUpCompletionSweep/);
  });
});

describe("booking exclusion is source-lifecycle-scoped, not customer-lifetime-wide", () => {
  it("replay resolves the source enrollment anchor and source quote_id before checking bookings", () => {
    expect(replayFn).toMatch(/source_enrollment_id/);
    expect(replayFn).toMatch(/campaign_enrollments[\s\S]{0,120}created_at/);
    expect(replayFn).toMatch(/quoteId:\s*sourceQuoteId/);
    expect(replayFn).toMatch(/anchorIso/);
  });
  it("sweep passes the enrollment created_at anchor + source quote id to the helper", () => {
    expect(sweep).toMatch(/hasLifecycleBlockingBooking/);
    expect(sweep).toMatch(/sourceQuoteId/);
    expect(sweep).toMatch(/lifecycleAnchorIso/);
  });
  it("neither call site uses the old lifetime-wide bookings count", () => {
    expect(replayFn).not.toMatch(/from\(["']bookings["']\)[\s\S]{0,200}count:\s*["']exact["']/);
    expect(sweep).not.toMatch(/from\(["']bookings["']\)[\s\S]{0,200}count:\s*["']exact["']/);
  });
  it("cancelled bookings are excluded at the DB layer", () => {
    expect(lifecycleLib).toMatch(/\.neq\(["']status["'],\s*["']cancelled["']\)/);
  });
  it("authoritative statuses are declared in the shared helper", () => {
    for (const s of ["confirmed", "scheduled", "in_progress", "completed", "pending_confirmation"]) {
      expect(lifecycleLib).toContain(s);
    }
  });
});