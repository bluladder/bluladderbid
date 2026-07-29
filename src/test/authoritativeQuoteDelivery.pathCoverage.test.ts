import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/functions/save-quote/index.ts",
  ),
  "utf8",
);
const delivery = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/functions/_shared/quoteDelivery.ts",
  ),
  "utf8",
);
const sms = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/send-sms/index.ts"),
  "utf8",
);
const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../supabase/migrations/20260729231424_launch_delivery_recovery.sql",
  ),
  "utf8",
);

describe("authoritative saved-quote delivery", () => {
  it("persists authoritative service and payment presentation", () => {
    expect(source).toMatch(
      /services: authoritativeServices/,
    );
    expect(source).toMatch(
      /lineItems: auth\.lineItems/,
    );
    expect(source).toMatch(
      /annualTotal: auth\.annualTotal \?\? auth\.total/,
    );
    expect(source).not.toMatch(/services: body\.services/);
    expect(source).not.toMatch(/lineItems: body\.lineItems/);
  });

  it("resolves and scopes organization lineage server-side", () => {
    expect(source).toMatch(/resolvePublicBookingOrganization/);
    expect(source).toMatch(/organizationResolution\.status !== "resolved"/);
    expect(source).toMatch(/organization_id:\s*organizationResolution\.organizationId/);
    expect(source).not.toMatch(/body\.organizationId|body\.organization_id/);
  });

  it("uses authoritative values in email and campaign metadata", () => {
    const emailStart = source.indexOf("const delivery = await deliverQuoteEmail");
    const emailEnd = source.indexOf("emailAttemptId =", emailStart);
    const emailBoundary = source.slice(emailStart, emailEnd);
    expect(emailBoundary).toMatch(/total: auth\.total/);
    expect(emailBoundary).toMatch(/services: authoritativeServices/);
    expect(emailBoundary).not.toMatch(/body\.total|body\.services/);

    const eventStart = source.indexOf("await emitCampaignEvent({");
    const eventEnd = source.indexOf("} catch (e)", eventStart);
    const eventBoundary = source.slice(eventStart, eventEnd);
    expect(eventBoundary).toMatch(/authoritative\.ruleVersion/);
    expect(eventBoundary).toMatch(/authoritative\.engineVersion/);
    expect(eventBoundary).toMatch(/total: auth\.total/);
    expect(eventBoundary).toMatch(/authoritativeServices\.map/);
    expect(eventBoundary).not.toMatch(
      /body\.total|body\.services|body\.ruleVersion|body\.engineVersion/,
    );
  });

  it("advances to emailed only after provider acceptance", () => {
    const accepted = source.indexOf("if (delivery.accepted)");
    const emailedUpdate = source.indexOf('status: "emailed"', accepted);
    expect(accepted).toBeGreaterThanOrEqual(0);
    expect(emailedUpdate).toBeGreaterThan(accepted);
    expect(delivery).toMatch(
      /result\.ok && result\.providerMessageId/,
    );
  });

  it("claims durable email ownership before provider dispatch", () => {
    const claim = delivery.indexOf('"claim_quote_email_delivery"');
    const provider = delivery.indexOf(
      "provider = await (input.providerSend ?? sendEmail)",
    );
    const finalize = delivery.indexOf('"finalize_quote_email_delivery"');
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(provider).toBeGreaterThan(claim);
    expect(finalize).toBeGreaterThan(provider);
    expect(delivery).toMatch(/network_error[\s\S]*uncertain/);
    expect(delivery).toMatch(/delivery_finalization_uncertain/);
    expect(delivery).toMatch(/idempotencyKey: claim\.semantic_key/);
  });

  it("converges quote SMS through a semantic server-side outbox key", () => {
    expect(sms).toMatch(/quote_delivery:sms:\$\{quoteId\}/);
    expect(sms).toMatch(/sendOutboxSms\(supabase/);
    expect(sms).toMatch(/quote_not_deliverable/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_quote_sms_delivery/);
    expect(migration).toMatch(/quote_lineage_conflict/);
    expect(migration).toMatch(/semantic_key_mismatch/);
  });

  it("uses a reclaimable webhook claim instead of early duplicate acknowledgement", () => {
    expect(migration).toMatch(/claim_resend_webhook_event/);
    expect(migration).toMatch(/finalize_resend_webhook_event/);
    expect(migration).toMatch(/processing_state = 'processed'/);
  });

  it("keeps outbox-owned SMS rows out of the generic retry queue", () => {
    const claimDue = migration.slice(
      migration.lastIndexOf("CREATE OR REPLACE FUNCTION public.claim_due_sms"),
    );
    expect(claimDue.match(/outbox_state IS NULL/g)).toHaveLength(2);
    expect(claimDue).not.toMatch(/outbox_state\s*=\s*'delivery_unknown'/);
  });

  it("never sends a bare quote UUID when capability minting fails", () => {
    expect(source).toMatch(/if \(!minted\)/);
    expect(source).toMatch(/code: "RESUME_CAPABILITY_UNAVAILABLE"/);
    expect(source).not.toMatch(
      /minted\?\.resumeUrl \?\? `\$\{getAppUrl\(\)\}\/quote/,
    );
  });
});
