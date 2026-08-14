import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);

Deno.test("portal verification SMS uses server-scoped connector outbox", () => {
  assertStringIncludes(source, "resolvePortalOrganizationAuthority");
  assertStringIncludes(source, "sendOutboxSms");
  assertStringIncludes(source, "organizationId,");
  assertStringIncludes(
    source,
    "outboundKey: `customer_verification:${challenge.id}`",
  );
  assertStringIncludes(source, 'messageKind: "verification"');
  assertEquals(/sendCallRailSms|getCallRailConfig/.test(source), false);
});

Deno.test("portal verification keeps one organization-owned email ledger write", () => {
  const ledgerInserts = source.match(/\.from\("sms_messages"\)\.insert/g) ?? [];
  assertEquals(ledgerInserts.length, 1);
  assert(
    /\.from\("sms_messages"\)\.insert\(\{\s*organization_id: organizationId,\s*channel: "email"/
      .test(
        source,
      ),
  );
});

Deno.test("portal verification challenge records selected provider evidence", () => {
  assertStringIncludes(source, "provider: result.provider ?? null");
  assertStringIncludes(source, "provider_message_id: result.providerMessageId");
  assertStringIncludes(source, "provider_response_kind: result.outboxState");
  assertStringIncludes(source, 'result.outboxState === "delivery_unknown"');
});
