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

  it("uses authoritative values in email and campaign metadata", () => {
    const emailStart = source.indexOf("const res = await sendEmail({");
    const emailEnd = source.indexOf("const nowAttempt", emailStart);
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
    const accepted = source.indexOf("if (res.ok && res.providerMessageId)");
    const emailedUpdate = source.indexOf('status: "emailed"', accepted);
    expect(accepted).toBeGreaterThanOrEqual(0);
    expect(emailedUpdate).toBeGreaterThan(accepted);
    expect(source.slice(accepted, emailedUpdate)).toMatch(
      /providerMessageId/,
    );
  });

  it("never sends a bare quote UUID when capability minting fails", () => {
    expect(source).toMatch(/if \(!minted\)/);
    expect(source).toMatch(/code: "RESUME_CAPABILITY_UNAVAILABLE"/);
    expect(source).not.toMatch(
      /minted\?\.resumeUrl \?\? `\$\{getAppUrl\(\)\}\/quote/,
    );
  });
});
