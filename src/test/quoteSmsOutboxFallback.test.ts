import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/_shared/smsOutbox.ts"),
  "utf8",
);

describe("organization-scoped quote SMS outbox claim", () => {
  it("requires server-resolved organization and connector authority", () => {
    expect(source).toMatch(/organizationId: string/);
    expect(source).toMatch(/from\("organization_messaging_connectors"\)/);
    expect(source).toMatch(/selectOrganizationMessagingConnector/);
    expect(source).toMatch(/guardMessagingDispatch/);
  });

  it("atomically binds organization, connector, quote, and idempotency lineage", () => {
    expect(source).toMatch(/"claim_organization_sms_outbox_send"/);
    expect(source).toMatch(/p_organization_id: input\.organizationId/);
    expect(source).toMatch(/p_messaging_connector_id: selection\.connector\.id/);
    expect(source).toMatch(/p_outbound_key: input\.outboundKey/);
    expect(source).toMatch(/p_quote_id: input\.quoteId \?\? null/);
  });

  it("does not retain the non-atomic legacy fallback", () => {
    expect(source).not.toMatch(/claim_quote_sms_delivery/);
    expect(source).not.toMatch(/quoteLineageFallback/);
    expect(source).not.toMatch(/isMissingFunctionError/);
  });
});
