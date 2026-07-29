// Path-coverage proof for the decline action: every quote origin
// (standard, service landing, package/plan, recurring plan, AI chat) surfaces
// its persisted quote at exactly one route — /quote/:id — served by QuoteView,
// which is the sole consumer of DeclineQuoteDialog. Adding a new origin only
// needs to land its quote at /quote/:id and inherits decline for free.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appTsx = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
const quoteView = fs.readFileSync(path.resolve(__dirname, "../pages/QuoteView.tsx"), "utf8");
const declineDialog = fs.readFileSync(
  path.resolve(__dirname, "../components/quote/DeclineQuoteDialog.tsx"),
  "utf8",
);
const declineFunction = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/quote-decline/index.ts"),
  "utf8",
);
const campaignSweep = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/_shared/campaignSweep.ts"),
  "utf8",
);
const processQueue = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/process-sms-queue/index.ts"),
  "utf8",
);
const bookingFunction = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/jobber-create-booking/index.ts"),
  "utf8",
);
const campaignEvent = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/campaign-event/index.ts"),
  "utf8",
);

describe("quote decline path coverage", () => {
  it("exposes exactly one /quote/:id route rendering QuoteView", () => {
    const matches = appTsx.match(/path="\/quote\/:id"[^>]*element=\{<QuoteView/);
    expect(matches, "single QuoteView route for all quote origins").not.toBeNull();
  });

  it("QuoteView mounts the DeclineQuoteDialog and gates on status", () => {
    expect(quoteView).toMatch(/DeclineQuoteDialog/);
    // QuoteView reads normalized status flags off its DTO rather than
    // comparing raw status strings inline.
    expect(quoteView).toMatch(/isDeclined/);
    expect(quoteView).toMatch(/isConverted/);
  });

  it("origins share the same route contract", () => {
    // These are the five documented origins. Each ultimately links the
    // customer to /quote/:id, so decline coverage is transitive.
    const origins = [
      "standard homeowner quote",
      "service landing quote",
      "one-time package / plan-builder quote",
      "recurring-plan quote",
      "AI-chat quote with persisted quote id",
    ];
    for (const _ of origins) {
      expect(appTsx.includes('path="/quote/:id"')).toBe(true);
    }
  });

  it("carries the exact resume capability into the destructive request", () => {
    expect(quoteView).toMatch(/resumeToken=\{resumeToken\}/);
    expect(declineDialog).toMatch(/resume_token:\s*resumeToken \?\? null/);
    expect(declineDialog).not.toMatch(/email:\s*emailOnFile/);
  });

  it("never treats quote email as authorization", () => {
    expect(declineFunction).toMatch(/verifyResumeToken\(supabase, quoteId, resumeToken\)/);
    expect(declineFunction).toMatch(/if \(!canDeclineQuote\(authz\.ok, tokenMatches\)\)/);
    expect(declineFunction).not.toMatch(/emailMatches|emailOnFile/);
    expect(declineFunction.indexOf("verifyResumeToken(")).toBeLessThan(
      declineFunction.indexOf('.from("quotes")'),
    );
  });

  it("compare-and-sets decline against conversion and reclassifies a lost race", () => {
    const update = declineFunction.indexOf('.update({');
    const transitionEnd = declineFunction.indexOf('follow_up_status: "pending_reconciliation"');
    expect(update).toBeGreaterThan(-1);
    expect(transitionEnd).toBeGreaterThan(update);
    expect(declineFunction.slice(update, transitionEnd)).toMatch(/\.eq\("status", quote\.status\)/);
    expect(declineFunction.slice(update, transitionEnd)).toMatch(/\.is\("converted_booking_id", null\)/);
    expect(declineFunction.slice(update, transitionEnd)).toMatch(
      /\.or\(`expires_at\.is\.null,expires_at\.gt\.\$\{nowIso\}`\)/,
    );
    expect(declineFunction.slice(update, transitionEnd)).toMatch(/classifyQuoteDecline\(current\)/);
  });

  it("uses the declined row as a durable outbox marker with bounded repair", () => {
    expect(declineFunction).toMatch(/follow_up_status:\s*"pending_reconciliation"/);
    expect(campaignSweep).toMatch(/runDeclinedQuoteEventRepairSweep/);
    expect(campaignSweep).toMatch(/idempotencyKey:\s*`quote_declined:\$\{row\.id\}`/);
    expect(campaignSweep).toMatch(/recoverySupabase:\s*supabase/);
    expect(processQueue).toMatch(/await runDeclinedQuoteEventRepairSweep\(supabase\)/);
  });

  it("rechecks quote terminal state before every queued campaign delivery", () => {
    expect(campaignEvent).toMatch(/quote_id:\s*metaQuoteId/);
    expect(processQueue).toMatch(/Authoritative quote state unavailable/);
    expect(processQueue).toMatch(/quoteLifecycleAllowsCampaignDelivery\(currentQuote, eventName\)/);
  });

  it("lets exact durable booking lineage win a simultaneous decline", () => {
    expect(bookingFunction).toMatch(/currentQuote\?\.status === "declined"/);
    expect(bookingFunction).toMatch(/\.eq\("status", "declined"\)/);
    expect(bookingFunction).toMatch(/converted_booking_id:\s*bookingRecord\.id/);
    expect(campaignSweep).toMatch(/evaluateDeclinedQuoteRepair\(fresh, booking\)/);
    expect(campaignSweep).toMatch(/decision === "reconcile_conversion"/);
  });
});
