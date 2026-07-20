import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const sendSms = readFileSync(join(root, "supabase/functions/send-sms/index.ts"), "utf8");
const campaignEvent = readFileSync(join(root, "supabase/functions/campaign-event/index.ts"), "utf8");
const engine = readFileSync(join(root, "supabase/functions/_shared/campaignEngine.ts"), "utf8");

// -----------------------------------------------------------------------------
// Regression suite: the legacy direct-enrollment block in send-sms has been
// removed and campaign enrollment is now the sole responsibility of the
// canonical campaign-event function (reached via emitCampaignEvent).
//
// These tests inspect source text — they do NOT invoke edge functions, do NOT
// hit CallRail, Resend, Jobber, Supabase auth, or Meta, and do NOT send any
// live message. Running the suite is guaranteed side-effect-free.
// -----------------------------------------------------------------------------

describe("send-sms legacy direct enrollment is removed", () => {
  it("does not query sms_campaigns by trigger_event", () => {
    expect(sendSms).not.toMatch(/\.eq\(\s*["']trigger_event["']/);
  });

  it("does not select sms_campaign_steps for enrollment", () => {
    expect(sendSms).not.toMatch(/sms_campaign_steps\s*\(/);
  });

  it("does not insert campaign_enrollments directly", () => {
    expect(sendSms).not.toMatch(/from\(["']campaign_enrollments["']\)/);
  });

  it("does not insert campaign-step queue rows (no campaign_step_id / campaign_id payload)", () => {
    expect(sendSms).not.toMatch(/campaign_step_id\s*:/);
  });

  it("still supports transactional and manual sends (unchanged surface)", () => {
    expect(sendSms).toMatch(/message_kind:\s*"transactional"/);
    expect(sendSms).toMatch(/message_kind:\s*"manual"/);
  });

  it("email queue behaviour is unchanged (send-sms never wrote follow-up email rows)", () => {
    // send-sms owns SMS delivery only; email follow-ups are the campaign
    // engine's responsibility. After the F1 fix, no `to_email` insert exists.
    expect(sendSms).not.toMatch(/to_email\s*:/);
  });

  it("still uses CallRail provider adapter and shared helpers unchanged", () => {
    expect(sendSms).toMatch(/sendCallRailSms/);
    expect(sendSms).toMatch(/getCallRailConfig/);
  });
});

describe("campaign-event is the only enrollment path", () => {
  it("owns campaign_enrollments writes", () => {
    expect(campaignEvent).toMatch(/from\(["']campaign_enrollments["']\)/);
  });

  it("enforces audience matching", () => {
    expect(campaignEvent).toMatch(/matchesAudience\(/);
  });

  it("enforces required consent tiers", () => {
    expect(campaignEvent).toMatch(/consentSatisfies\(/);
  });

  it("enforces suppression checks", () => {
    expect(campaignEvent).toMatch(/checkSuppression\(/);
  });

  it("enforces idempotency by key", () => {
    expect(campaignEvent).toMatch(/idempotency_key/);
  });

  it("blocks a second active enrollment for the same identity+campaign", () => {
    // The guard queries active enrollments and returns skipped_duplicate.
    expect(campaignEvent).toMatch(/skipped_duplicate/);
    expect(campaignEvent).toMatch(/status["']?\s*,\s*["']active["']/);
  });

  it("no longer selects the deprecated trigger_event column", () => {
    // Enrollment is driven exclusively by event_name; trigger_event is legacy.
    expect(campaignEvent).not.toMatch(/trigger_event/);
  });

  it("routes booking_completed stops through the abandoned scope", () => {
    // F3: successful booking cancels pending abandoned-quote campaigns.
    expect(engine).toMatch(/booking_completed:\s*\{\s*reason:[^}]*scope:\s*["']abandoned["']/);
  });

  it("routes customer_replied and manual_staff_takeover through the all scope", () => {
    expect(engine).toMatch(/customer_replied:\s*\{[^}]*scope:\s*["']all["']/);
    expect(engine).toMatch(/manual_staff_takeover:\s*\{[^}]*scope:\s*["']all["']/);
  });

  it("reminders stop scope only targets appointment/booking lifecycle campaigns", () => {
    // F3 assertion: reminders scope must not stop unrelated (e.g. abandoned) campaigns.
    const remindersMatch = campaignEvent.match(/scope === "reminders"\)\s*campaignFilter\s*=\s*\[[^\]]+\]/);
    expect(remindersMatch).not.toBeNull();
    const list = remindersMatch![0];
    expect(list).toMatch(/appointment_scheduled/);
    expect(list).toMatch(/appointment_rescheduled/);
    expect(list).toMatch(/booking_completed/);
    // Explicitly does NOT include unrelated marketing/abandoned events.
    expect(list).not.toMatch(/quote_abandoned/);
    expect(list).not.toMatch(/quote_saved_or_emailed/);
  });
});

describe("provider adapters remain untouched by the F1 correction", () => {
  it("send-sms still targets CallRail; no Resend / voicemail providers were added", () => {
    expect(sendSms).not.toMatch(/resend/i);
    expect(sendSms).not.toMatch(/voicemail/i);
    expect(sendSms).not.toMatch(/ringless/i);
  });
});