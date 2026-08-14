// Phase 6B.3 unit tests — SMS outbox state machine + timezone rendering.
// Uses a stubbed supabase.rpc that emulates claim/finalize semantics.
// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendOutboxSms } from "./smsOutbox.ts";
import {
  KLAMATH_TWILIO_CREDENTIAL_REFERENCE,
  type TwilioSmsConfig,
} from "./twilioSms.ts";
import {
  BLULADDER_DEFAULT_TIMEZONE,
  formatBookingWhen,
  resolveBookingTimezone,
} from "./bookingTimezone.ts";

const callRail = {
  apiKey: "k",
  accountId: "a",
  companyId: "c",
  senderNumber: "+14697472877",
};
const organizationId = "11111111-1111-4111-8111-111111111111";
const connectorId = "22222222-2222-4222-8222-222222222222";
const twilio: TwilioSmsConfig = {
  accountSid: `AC${"1".repeat(32)}`,
  apiKeySid: `SK${"4".repeat(32)}`,
  apiKeySecret: "test-key-secret",
  messagingServiceSid: `MG${"2".repeat(32)}`,
};

function makeSupabase(opts: {
  existing?: any | null;
  claimBehavior?: "new" | "replay" | "in_progress" | "escalated";
  rpcLog?: any[];
  missingQuoteClaim?: boolean;
  lineageLog?: any[];
  connectorBehavior?: "active" | "missing" | "inactive" | "twilio";
}) {
  const rpcLog = opts.rpcLog ?? [];
  const lineageLog = opts.lineageLog ?? [];
  return {
    from(table: string) {
      if (table === "organization_messaging_connectors") {
        const chain: any = {
          eq() {
            return chain;
          },
          then(resolve: (value: unknown) => unknown) {
            const behavior = opts.connectorBehavior ?? "active";
            return Promise.resolve({
              data: behavior === "missing" ? [] : [{
                id: connectorId,
                organization_id: organizationId,
                channel: "sms",
                provider: behavior === "twilio" ? "twilio" : "callrail",
                status: behavior === "inactive" ? "inactive" : "active",
                priority: 10,
                credential_reference: behavior === "twilio"
                  ? KLAMATH_TWILIO_CREDENTIAL_REFERENCE
                  : "reviewed-credential-reference",
                sender_identity_reference: behavior === "twilio"
                  ? twilio.messagingServiceSid
                  : "reviewed-sender-reference",
              }],
              error: null,
            }).then(resolve);
          },
        };
        return {
          select() {
            return chain;
          },
        };
      }
      return {
        update(values: any) {
          const filters: Record<string, unknown> = {};
          const chain: any = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            is(column: string, value: unknown) {
              filters[column] = value;
              lineageLog.push({ table, values, filters });
              return Promise.resolve({ data: null, error: null });
            },
          };
          return chain;
        },
      };
    },
    async rpc(name: string, args: any) {
      rpcLog.push({ name, args });
      if (name === "claim_quote_sms_delivery" && opts.missingQuoteClaim) {
        return {
          data: null,
          error: {
            code: "PGRST202",
            message:
              "Could not find the function public.claim_quote_sms_delivery",
          },
        };
      }
      if (name === "claim_organization_sms_outbox_send") {
        switch (opts.claimBehavior ?? "new") {
          case "new":
            return {
              data: {
                ok: true,
                is_new: true,
                id: "sms-1",
                outbox_state: "sending",
                may_dispatch: true,
              },
              error: null,
            };
          case "replay":
            return {
              data: {
                ok: true,
                is_new: false,
                id: "sms-1",
                outbox_state: "provider_accepted",
                may_dispatch: false,
                replay: true,
                provider_message_id: "prov-x",
                status: "sent",
              },
              error: null,
            };
          case "in_progress":
            return {
              data: {
                ok: true,
                is_new: false,
                id: "sms-1",
                outbox_state: "sending",
                may_dispatch: false,
                in_progress: true,
              },
              error: null,
            };
          case "escalated":
            return {
              data: {
                ok: true,
                is_new: false,
                id: "sms-1",
                outbox_state: "delivery_unknown",
                may_dispatch: false,
                escalated: true,
              },
              error: null,
            };
        }
      }
      if (name === "finalize_sms_outbox_send") {
        return {
          data: { ok: true, current_state: args.p_new_state },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  } as any;
}

// Stub global fetch (CallRail) — behavior controlled by a module-level flag.
let fetchMode: "ok" | "reject" | "throw" | "malformed" = "ok";
// deno-lint-ignore no-explicit-any
(globalThis as any).fetch = async (_url: string, _init: any) => {
  if (fetchMode === "throw") throw new Error("network_down");
  if (fetchMode === "reject") {
    return new Response("nope", { status: 500 });
  }
  if (fetchMode === "malformed") {
    return new Response("not-json", { status: 200 });
  }
  if (_url.includes("api.twilio.com")) {
    return new Response(
      JSON.stringify({ sid: `SM${"3".repeat(32)}`, status: "queued" }),
      { status: 201 },
    );
  }
  return new Response(
    JSON.stringify({
      id: "conv-1",
      recent_messages: [{
        id: "prov-1",
        direction: "outgoing",
        status: "delivered",
      }],
    }),
    { status: 200 },
  );
};

Deno.test("outbox #14: crash before dispatch → next call re-claims and dispatches once", async () => {
  // First worker: escalated state means we do NOT dispatch. This simulates
  // "a prior sending row is stale" — the previous crash left a sending row
  // that has since been escalated by the reclaim path.
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const sb = makeSupabase({ claimBehavior: "escalated", rpcLog });
  const r = await sendOutboxSms(sb, {
    organizationId,
    outboundKey: "k1",
    toNumber: "+15551234567",
    body: "hi",
    messageKind: "test",
    callRail,
  });
  assertEquals(r.sent, false);
  assertEquals(r.escalated, true);
  assertEquals(r.outboxState, "delivery_unknown");
  // No finalize call — claim path already terminal.
  assert(!rpcLog.some((x) => x.name === "finalize_sms_outbox_send"));
});

Deno.test("outbox #15: crash after provider acceptance → replay does NOT redispatch", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const sb = makeSupabase({ claimBehavior: "replay", rpcLog });
  const r = await sendOutboxSms(sb, {
    organizationId,
    outboundKey: "k1",
    toNumber: "+15551234567",
    body: "hi",
    messageKind: "test",
    callRail,
  });
  assertEquals(r.sent, true); // prior accepted evidence is authoritative
  assertEquals(r.replay, true);
  assertEquals(r.providerMessageId, "prov-x");
  // No finalize — nothing to finalize because we didn't win the claim.
  assert(!rpcLog.some((x) => x.name === "finalize_sms_outbox_send"));
});

Deno.test("outbox #16: duplicate confirmation request in-flight → sees in_progress, no dispatch", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const sb = makeSupabase({ claimBehavior: "in_progress", rpcLog });
  const r = await sendOutboxSms(sb, {
    organizationId,
    outboundKey: "k1",
    toNumber: "+15551234567",
    body: "hi",
    messageKind: "test",
    callRail,
  });
  assertEquals(r.sent, false);
  assertEquals(r.inProgress, true);
  assert(!rpcLog.some((x) => x.name === "finalize_sms_outbox_send"));
});

Deno.test("outbox #17: provider rejection finalizes to send_failed; caller does not roll back booking", async () => {
  const rpcLog: any[] = [];
  fetchMode = "reject";
  const sb = makeSupabase({ claimBehavior: "new", rpcLog });
  const r = await sendOutboxSms(sb, {
    organizationId,
    outboundKey: "k1",
    toNumber: "+15551234567",
    body: "hi",
    messageKind: "test",
    callRail,
  });
  assertEquals(r.sent, false);
  assertEquals(r.outboxState, "send_failed");
  const fin = rpcLog.find((x) => x.name === "finalize_sms_outbox_send");
  assertEquals(fin?.args?.p_new_state, "send_failed");
  // The caller (handleConfirmationReply) inspects `sent`; on false it does
  // NOT roll back the ledger — the booking stays confirmed in
  // sms_booking_confirmations and only the confirmation SMS is unresolved.
});

Deno.test("outbox: missing provider config is durably finalized", async () => {
  const rpcLog: any[] = [];
  const priorKey = Deno.env.get("CALLRAIL_API_KEY");
  Deno.env.delete("CALLRAIL_API_KEY");
  try {
    const r = await sendOutboxSms(
      makeSupabase({ claimBehavior: "new", rpcLog }),
      {
        organizationId,
        outboundKey: "k-config",
        toNumber: "+15551234567",
        body: "hi",
        messageKind: "test",
      },
    );
    assertEquals(r.sent, false);
    assertEquals(r.outboxState, "send_failed");
    assertEquals(r.error, "callrail_config_missing");
    assertEquals(
      rpcLog.find((x) => x.name === "finalize_sms_outbox_send")?.args
        ?.p_new_state,
      "send_failed",
    );
  } finally {
    if (priorKey) Deno.env.set("CALLRAIL_API_KEY", priorKey);
  }
});

Deno.test("outbox: scoped quote claim binds organization and connector atomically", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const r = await sendOutboxSms(
    makeSupabase({ rpcLog }),
    {
      organizationId,
      outboundKey: "quote_delivery:sms:q1:15551234567",
      toNumber: "+15551234567",
      body: "Your bid is ready",
      messageKind: "transactional",
      quoteId: "q1",
      callRail,
    },
  );

  assertEquals(r.sent, true);
  const claim = rpcLog.find((x) =>
    x.name === "claim_organization_sms_outbox_send"
  );
  assertEquals(claim?.args?.p_organization_id, organizationId);
  assertEquals(claim?.args?.p_messaging_connector_id, connectorId);
  assertEquals(claim?.args?.p_quote_id, "q1");
  assertEquals(claim?.args?.p_stale_claim_seconds, 120);
});

Deno.test("outbox: network failure finalizes to delivery_unknown (no re-send)", async () => {
  const rpcLog: any[] = [];
  fetchMode = "throw";
  const sb = makeSupabase({ claimBehavior: "new", rpcLog });
  const r = await sendOutboxSms(sb, {
    organizationId,
    outboundKey: "k1",
    toNumber: "+15551234567",
    body: "hi",
    messageKind: "test",
    callRail,
  });
  // A transport exception can happen after the provider accepted the request.
  // It must never be treated as proof of rejection or automatically retried.
  assertEquals(r.outboxState, "delivery_unknown");
  assertEquals(r.sent, false);
  const fin = rpcLog.find((x) => x.name === "finalize_sms_outbox_send");
  assertEquals(fin?.args.p_new_state, "delivery_unknown");
});

Deno.test("outbox: missing organization connector blocks before claim", async () => {
  const rpcLog: any[] = [];
  const r = await sendOutboxSms(
    makeSupabase({ connectorBehavior: "missing", rpcLog }),
    {
      organizationId,
      outboundKey: "missing-connector",
      toNumber: "+15551234567",
      body: "hi",
      messageKind: "test",
      callRail,
    },
  );
  assertEquals(r.sent, false);
  assertEquals(r.error, "connector_missing");
  assertEquals(rpcLog.length, 0);
});

Deno.test("outbox: Twilio connector without server config records failure without dispatch", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const r = await sendOutboxSms(
    makeSupabase({ connectorBehavior: "twilio", rpcLog }),
    {
      organizationId,
      outboundKey: "twilio-config-missing",
      toNumber: "+15551234567",
      body: "hi",
      messageKind: "test",
      callRail,
    },
  );
  assertEquals(r.sent, false);
  assertEquals(r.outboxState, "send_failed");
  assertEquals(r.error, "twilio_config_missing");
  assertEquals(
    rpcLog.find((x) => x.name === "finalize_sms_outbox_send")?.args
      ?.p_new_state,
    "send_failed",
  );
});

Deno.test("outbox: reviewed Twilio connector dispatches and finalizes accepted", async () => {
  const rpcLog: any[] = [];
  fetchMode = "ok";
  const r = await sendOutboxSms(
    makeSupabase({ connectorBehavior: "twilio", rpcLog }),
    {
      organizationId,
      outboundKey: "twilio-reviewed-adapter",
      toNumber: "+15551234567",
      body: "Your secure link is ready",
      messageKind: "transactional",
      twilio,
    },
  );
  assertEquals(r.sent, true);
  assertEquals(r.outboxState, "provider_accepted");
  assertEquals(r.providerMessageId, `SM${"3".repeat(32)}`);
  const finalized = rpcLog.find((x) => x.name === "finalize_sms_outbox_send");
  assertEquals(finalized?.args?.p_new_state, "provider_accepted");
  assertEquals(finalized?.args?.p_provider_status, "queued");
});

Deno.test("timezone #20: property timezone renders in local zone", () => {
  // 2026-07-23T20:00:00Z = 3:00 PM America/Chicago (CDT, UTC-5)
  const s = formatBookingWhen("2026-07-23T20:00:00Z", "America/Chicago");
  assert(s.includes("3:00 PM"), `expected 3:00 PM in CDT, got: ${s}`);
  assert(s.includes("July"));
});

Deno.test("timezone #21: DST transition renders correctly", () => {
  // Summer (CDT, UTC-5): 2026-07-15 17:00Z → 12:00 PM local
  const summer = formatBookingWhen("2026-07-15T17:00:00Z", "America/Chicago");
  assert(summer.includes("12:00 PM"), `expected 12:00 PM CDT, got: ${summer}`);
  // Winter (CST, UTC-6): 2026-12-15 18:00Z → 12:00 PM local
  const winter = formatBookingWhen("2026-12-15T18:00:00Z", "America/Chicago");
  assert(winter.includes("12:00 PM"), `expected 12:00 PM CST, got: ${winter}`);
  // Same wall-clock label across DST proves Intl.DateTimeFormat is
  // honoring the IANA rules — a naive UTC-5 renderer would show 11:00 AM
  // in December instead.
});

Deno.test("timezone resolution order: presentation > property > default", () => {
  assertEquals(
    resolveBookingTimezone({
      presentation: { held_option: { timezone: "America/New_York" } },
      property: { timezone: "America/Denver" },
    }),
    "America/New_York",
  );
  assertEquals(
    resolveBookingTimezone({
      presentation: {},
      property: { timezone: "America/Denver" },
    }),
    "America/Denver",
  );
  assertEquals(
    resolveBookingTimezone({ presentation: null, property: null }),
    BLULADDER_DEFAULT_TIMEZONE,
  );
});
