import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  normalizeConsentOrganizationId,
  organizationConsentAllows,
  recordOrganizationConsent,
} from "./organizationConsent.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("organization consent normalizes valid authority and rejects selectors", () => {
  assertEquals(
    normalizeConsentOrganizationId(` ${ORGANIZATION_ID.toUpperCase()} `),
    ORGANIZATION_ID,
  );
  assertEquals(normalizeConsentOrganizationId("dfw"), null);
  assertEquals(normalizeConsentOrganizationId(null), null);
});

Deno.test("record organization consent forwards exact persisted authority", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> = {};
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return Promise.resolve({
        data: "22222222-2222-4222-8222-222222222222",
        error: null,
      });
    },
  };

  await recordOrganizationConsent(supabase, ORGANIZATION_ID, {
    channel: "sms",
    consentType: "requested_follow_up",
    status: "granted",
    phone: "+15555550123",
    languageShown: "Reply requested.",
    source: "test",
    conversationId: "33333333-3333-4333-8333-333333333333",
  });

  assertEquals(rpcName, "record_organization_consent");
  assertEquals(rpcArgs.p_organization_id, ORGANIZATION_ID);
  assertEquals(rpcArgs.p_channel, "sms");
  assertEquals(rpcArgs.p_consent_type, "requested_follow_up");
});

Deno.test("record organization consent fails before RPC without authority", async () => {
  let called = false;
  const supabase = {
    rpc() {
      called = true;
      return Promise.resolve({ data: null, error: null });
    },
  };
  await assertRejects(
    () =>
      recordOrganizationConsent(supabase, null, {
        channel: "email",
        consentType: "marketing",
        status: "granted",
        email: "customer@example.com",
        source: "test",
      }),
    Error,
    "consent_organization_authority_required",
  );
  assertEquals(called, false);
});

Deno.test("record organization consent rejects a failed RPC", async () => {
  const supabase = {
    rpc() {
      return Promise.resolve({ data: null, error: { code: "P0001" } });
    },
  };
  await assertRejects(
    () =>
      recordOrganizationConsent(supabase, ORGANIZATION_ID, {
        channel: "email",
        consentType: "marketing",
        status: "granted",
        email: "customer@example.com",
        source: "test",
      }),
    Error,
    "organization_consent_write_failed",
  );
});

Deno.test("organization consent read fails closed on missing authority or RPC error", async () => {
  let calls = 0;
  const supabase = {
    rpc() {
      calls++;
      return Promise.resolve({ data: true, error: { code: "read_failed" } });
    },
  };
  assertEquals(
    await organizationConsentAllows(supabase, null, {
      channel: "sms",
      required: "marketing",
      phone: "+15555550123",
    }),
    false,
  );
  assertEquals(calls, 0);
  assertEquals(
    await organizationConsentAllows(supabase, ORGANIZATION_ID, {
      channel: "sms",
      required: "marketing",
      phone: "+15555550123",
    }),
    false,
  );
  assertEquals(calls, 1);
});

Deno.test("organization consent read returns true only for explicit true", async () => {
  let captured: Record<string, unknown> = {};
  const supabase = {
    rpc(_name: string, args: Record<string, unknown>) {
      captured = args;
      return Promise.resolve({ data: true, error: null });
    },
  };
  assertEquals(
    await organizationConsentAllows(supabase, ORGANIZATION_ID, {
      channel: "email",
      required: "requested_follow_up",
      email: "customer@example.com",
    }),
    true,
  );
  assertEquals(captured.p_organization_id, ORGANIZATION_ID);
});
