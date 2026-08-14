import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { OutboxSendInput } from "../smsOutbox.ts";
import {
  executeVapiTransferControl,
  finishVoiceTransferAttempt,
  handleVoiceHumanTransferToolCalls,
  inspectPriorVoiceCustomerLink,
  normalizeVapiControlEndpoint,
  notifyVoiceOperatorFollowup,
  recordVoiceOperatorEmailAttempt,
  resolveAuthoritativeVoiceOperator,
  VOICE_HUMAN_TRANSFER_TOOL,
  type VoiceHumanTransferToolResult,
  type VoiceTransferClaim,
} from "./voiceHumanTransfer.ts";

const ORG = "00000000-0000-4000-8000-000000000091";
const OTHER_ORG = "00000000-0000-4000-8000-000000000092";
const CALLER = "+14697472877";
const OPERATOR = "+14692150144";
const CONTROL =
  "https://control.vapi.ai/live/provider-call-91/session?token=synthetic";

function body(names: string[]): Record<string, unknown> {
  return {
    message: {
      type: "tool-calls",
      toolCallList: names.map((name, index) => ({
        id: `tool-${index + 1}`,
        name,
        arguments: {
          destination: "+12145550000",
          organizationId: OTHER_ORG,
          transcript: "private model text",
        },
      })),
      call: {
        id: "provider-call-91",
        customer: { number: CALLER },
        phoneNumber: { number: "+14695550100" },
        monitor: { controlUrl: CONTROL },
      },
    },
  };
}

function winner(): VoiceTransferClaim {
  return {
    state: "winner",
    conversationId: "conversation-91",
    noteId: "note-91",
    callHash: "a".repeat(64),
    customerId: null,
  };
}

function decoded(value: string): VoiceHumanTransferToolResult {
  return JSON.parse(value) as VoiceHumanTransferToolResult;
}

function operator() {
  return {
    status: "resolved" as const,
    contact: {
      id: "recipient-1",
      name: "Local operator",
      phoneE164: OPERATOR,
      email: "operator@example.com",
    },
  };
}

Deno.test("human transfer: duplicate tool calls issue one server-resolved transfer and ignore model authority", async () => {
  let executions = 0;
  let destinationSeen = "";
  let controlSeen = "";
  let finished = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL, VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () => Promise.resolve(winner()),
    resolveOperator: (_client, organizationId) => {
      assertEquals(organizationId, ORG);
      return Promise.resolve(operator());
    },
    executeTransfer: (controlUrl, destination) => {
      executions++;
      controlSeen = controlUrl;
      destinationSeen = destination;
      return Promise.resolve({ status: "provider_accepted", httpStatus: 200 });
    },
    finishTransfer: () => {
      finished++;
      return Promise.resolve(true);
    },
  });

  assertEquals(executions, 1);
  assertEquals(finished, 1);
  assertEquals(controlSeen, CONTROL);
  assertEquals(destinationSeen, OPERATOR);
  assertEquals(result.results.length, 2);
  assertEquals(decoded(result.results[0].result).status, "transfer_requested");
  assertEquals(decoded(result.results[1].result).status, "transfer_requested");
  assert(!result.results[0].result.includes("+12145550000"));
  assertEquals(
    decoded(result.results[0].result).message,
    "Vapi accepted the transfer control request. Say you are connecting the caller now; do not claim that a human answered.",
  );
});

Deno.test("human transfer: a replay never issues a second provider request", async () => {
  let executions = 0;
  let notifications = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () =>
      Promise.resolve({
        ...winner(),
        state: "provider_accepted",
      }),
    resolveOperator: () => Promise.resolve(operator()),
    executeTransfer: () => {
      executions++;
      return Promise.resolve({ status: "provider_accepted", httpStatus: 200 });
    },
    notifyOperator: () => {
      notifications++;
      return Promise.resolve({
        sms: "provider_accepted",
        email: "skipped",
        providerAccepted: true,
      });
    },
  });
  assertEquals(executions, 0);
  assertEquals(notifications, 0);
  assertEquals(decoded(result.results[0].result).status, "transfer_requested");
});

Deno.test("human transfer: competing transfer and customer-link actions execute neither", async () => {
  let claims = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL, "send_online_quote_link"]),
    organizationId: ORG,
  }, {
    claimTransfer: () => {
      claims++;
      return Promise.resolve(winner());
    },
  });
  assertEquals(claims, 0);
  assertEquals(
    result.results.map((entry) => decoded(entry.result).status),
    ["invalid_request", "invalid_request"],
  );
});

Deno.test("human transfer: provider-accepted same-call link blocks transfer before claim or alert", async () => {
  let claims = 0;
  let executions = 0;
  let notifications = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    inspectPriorCustomerLink: () => Promise.resolve("provider_accepted"),
    claimTransfer: () => {
      claims++;
      return Promise.resolve(winner());
    },
    executeTransfer: () => {
      executions++;
      return Promise.resolve({ status: "provider_accepted", httpStatus: 200 });
    },
    notifyOperator: () => {
      notifications++;
      return Promise.resolve({
        sms: "provider_accepted",
        email: "skipped",
        providerAccepted: true,
      });
    },
  });
  assertEquals(claims, 0);
  assertEquals(executions, 0);
  assertEquals(notifications, 0);
  const evidence = decoded(result.results[0].result);
  assertEquals(evidence.status, "invalid_request");
  assert(/link was already provider-accepted/i.test(evidence.message));
});

Deno.test("human transfer: unreadable same-call link evidence fails closed before transfer", async () => {
  let claims = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    inspectPriorCustomerLink: () => Promise.resolve("unreadable"),
    claimTransfer: () => {
      claims++;
      return Promise.resolve(winner());
    },
  });
  assertEquals(claims, 0);
  assertEquals(decoded(result.results[0].result).status, "failed");
});

Deno.test("human transfer: durable prior-link lookup accepts only exact trusted provider evidence", async () => {
  const rows = [{
    outbound_idempotency_key: "voice_call_bid_link:provider-call-91:4697472877",
    to_number: CALLER,
    message_kind: "voice_booking_management_link",
    outbox_state: "provider_accepted",
    status: "sent",
  }];
  const builder = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const state = await inspectPriorVoiceCustomerLink({
    from(table: string) {
      assertEquals(table, "sms_messages");
      return builder;
    },
  }, { callId: "provider-call-91", callerPhone: CALLER });
  assertEquals(state, "provider_accepted");

  rows[0].outbox_state = "send_failed";
  rows[0].status = "failed";
  assertEquals(
    await inspectPriorVoiceCustomerLink({ from: () => builder }, {
      callId: "provider-call-91",
      callerPhone: CALLER,
    }),
    "none",
  );
});

Deno.test("human transfer: definite failure alerts once and wording follows provider evidence", async () => {
  let notifications = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () => Promise.resolve(winner()),
    resolveOperator: () => Promise.resolve(operator()),
    executeTransfer: () =>
      Promise.resolve({ status: "failed", httpStatus: 502 }),
    notifyOperator: (_client, args) => {
      notifications++;
      assertEquals(args.organizationId, ORG);
      assertEquals(args.callerPhone, CALLER);
      return Promise.resolve({
        sms: "provider_accepted",
        email: "failed",
        providerAccepted: true,
      });
    },
    finishTransfer: (_client, args) => {
      assertEquals(args.transferStatus, "failed");
      assertEquals(args.alert?.providerAccepted, true);
      return Promise.resolve(true);
    },
  });
  assertEquals(notifications, 1);
  const evidence = decoded(result.results[0].result);
  assertEquals(evidence.status, "followup_provider_accepted");
  assert(/operator alert was provider-accepted/i.test(evidence.message));
  assert(/do not claim a human answered/i.test(evidence.message));
});

Deno.test("human transfer: uncertain provider outcome fails closed without retry", async () => {
  let executions = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () => Promise.resolve(winner()),
    resolveOperator: () => Promise.resolve(operator()),
    executeTransfer: () => {
      executions++;
      return Promise.resolve({ status: "uncertain", httpStatus: null });
    },
    notifyOperator: () =>
      Promise.resolve({
        sms: "failed",
        email: "failed",
        providerAccepted: false,
      }),
    finishTransfer: () => Promise.resolve(true),
  });
  assertEquals(executions, 1);
  const evidence = decoded(result.results[0].result);
  assertEquals(evidence.status, "uncertain");
  assert(/notification delivery is not confirmed/i.test(evidence.message));
  assert(!/human answered|connected you/i.test(evidence.message));
});

Deno.test("human transfer: thrown provider transport remains uncertain and is never retried", async () => {
  let executions = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () => Promise.resolve(winner()),
    resolveOperator: () => Promise.resolve(operator()),
    executeTransfer: () => {
      executions++;
      throw new Error("transport failed after dispatch may have occurred");
    },
    notifyOperator: () =>
      Promise.resolve({
        sms: "failed",
        email: "failed",
        providerAccepted: false,
      }),
    finishTransfer: () => Promise.resolve(true),
  });
  assertEquals(executions, 1);
  assertEquals(decoded(result.results[0].result).status, "uncertain");
});

Deno.test("human transfer: caller/operator self-transfer is blocked before provider execution", async () => {
  let executions = 0;
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () => Promise.resolve(winner()),
    resolveOperator: () =>
      Promise.resolve({
        status: "resolved",
        contact: { ...operator().contact, phoneE164: CALLER },
      }),
    executeTransfer: () => {
      executions++;
      return Promise.resolve({ status: "provider_accepted", httpStatus: 200 });
    },
    notifyOperator: () =>
      Promise.resolve({
        sms: "skipped",
        email: "provider_accepted",
        providerAccepted: true,
      }),
    finishTransfer: () => Promise.resolve(true),
  });
  assertEquals(executions, 0);
  assertEquals(
    decoded(result.results[0].result).status,
    "followup_provider_accepted",
  );
});

Deno.test("human transfer: provider alert is not claimed when durable callback completion is missing", async () => {
  const result = await handleVoiceHumanTransferToolCalls(null, {
    body: body([VOICE_HUMAN_TRANSFER_TOOL]),
    organizationId: ORG,
  }, {
    claimTransfer: () => Promise.resolve(winner()),
    resolveOperator: () => Promise.resolve(operator()),
    executeTransfer: () =>
      Promise.resolve({ status: "failed", httpStatus: 502 }),
    notifyOperator: () =>
      Promise.resolve({
        sms: "provider_accepted",
        email: "skipped",
        providerAccepted: true,
      }),
    finishTransfer: () => Promise.resolve(false),
  });
  const evidence = decoded(result.results[0].result);
  assertEquals(evidence.status, "uncertain");
  assert(/durable callback evidence could not be verified/i.test(
    evidence.message,
  ));
  assert(/do not claim alert delivery/i.test(evidence.message));
});

Deno.test("human transfer: authoritative operator lookup is organization-scoped and rejects cross-tenant rows", async () => {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select() {
      return this;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    },
    not(column: string, operator: string, value: unknown) {
      filters.push([`${column}:${operator}`, value]);
      return this;
    },
    limit() {
      return Promise.resolve({
        data: [{
          id: "other-recipient",
          organization_id: OTHER_ORG,
          name: "Private other operator",
          phone: OPERATOR,
          email: "other@example.com",
        }],
        error: null,
      });
    },
  };
  const result = await resolveAuthoritativeVoiceOperator({
    from(table: string) {
      assertEquals(table, "escalation_recipients");
      return builder;
    },
  }, ORG);
  assertEquals(result, {
    status: "unavailable",
    reason: "organization_mismatch",
  });
  assert(
    filters.some(([column, value]) =>
      column === "organization_id" && value === ORG
    ),
  );
});

Deno.test("human transfer: control URL validation preserves opaque Vapi capability URLs", async () => {
  assertEquals(
    normalizeVapiControlEndpoint(CONTROL),
    CONTROL,
  );
  assertEquals(
    normalizeVapiControlEndpoint(
      "https://api.eu.vapi.ai/provider-managed/control/path?signature=synthetic",
    ),
    "https://api.eu.vapi.ai/provider-managed/control/path?signature=synthetic",
  );
  assertEquals(normalizeVapiControlEndpoint("http://api.vapi.ai/call/x"), null);
  assertEquals(
    normalizeVapiControlEndpoint("https://evil.example/call/x"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://api.vapi.ai.evil.example/call/x"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://evilvapi.ai/call/x"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://user@api.vapi.ai/call/x"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://api.vapi.ai:8443/call/x"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://api.vapi.ai./call/x"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://api.vapi.ai/"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint("https://api.vapi.ai/call/x#fragment"),
    null,
  );
  assertEquals(
    normalizeVapiControlEndpoint(" https://api.vapi.ai/call/x"),
    null,
  );

  let requests = 0;
  const accepted = await executeVapiTransferControl(
    CONTROL,
    OPERATOR,
    (input, init) => {
      requests++;
      assertEquals(String(input), CONTROL);
      assertEquals(init?.method, "POST");
      assertEquals(init?.redirect, "error");
      assertEquals(
        JSON.parse(String(init?.body)).destination,
        { type: "number", number: OPERATOR },
      );
      return Promise.resolve(new Response(null, { status: 202 }));
    },
  );
  assertEquals(requests, 1);
  assertEquals(accepted, { status: "provider_accepted", httpStatus: 202 });
});

Deno.test("human transfer: rejected control URL never reaches fetch", async () => {
  let requests = 0;
  const rejected = await executeVapiTransferControl(
    "https://api.vapi.ai.evil.example/control",
    OPERATOR,
    () => {
      requests++;
      return Promise.resolve(new Response(null, { status: 202 }));
    },
  );
  assertEquals(requests, 0);
  assertEquals(rejected, { status: "failed", httpStatus: null });
});

Deno.test("human transfer: failed transfer queues one bounded operator SMS and email identity", async () => {
  const sms: OutboxSendInput[] = [];
  const emails: Array<Record<string, unknown>> = [];
  const emailAttempts: Array<Record<string, unknown>> = [];
  const settingsBuilder = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: {
          internal_alerts_enabled: true,
          email_alerts_enabled: true,
        },
        error: null,
      });
    },
  };
  const alert = await notifyVoiceOperatorFollowup({
    from(table: string) {
      if (table === "escalation_settings") return settingsBuilder;
      assertEquals(table, "email_send_attempts");
      const chain = {
        insert(row: Record<string, unknown>) {
          emailAttempts.push(row);
          return this;
        },
        select() {
          return this;
        },
        eq() {
          return this;
        },
        contains() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: emailAttempts[emailAttempts.length - 1],
            error: null,
          });
        },
      };
      return chain;
    },
  }, {
    organizationId: ORG,
    callerPhone: CALLER,
    transferStatus: "failed",
    contact: operator().contact,
    claim: winner(),
    appUrl: "https://bid.bluladder.com",
  }, {
    suppressionCheck: () =>
      Promise.resolve({ suppressed: false, reason: null }),
    deliverSms: (_client, input) => {
      sms.push(input);
      return Promise.resolve({
        sent: true,
        smsMessageId: "sms-1",
        outboxState: "provider_accepted",
        replay: false,
        inProgress: false,
        escalated: false,
        providerMessageId: "provider-1",
      });
    },
    sendOperatorEmail: (input) => {
      emails.push(input as unknown as Record<string, unknown>);
      return Promise.resolve({
        ok: true,
        providerMessageId: "email-1",
        from: "BluLadder <alerts@example.com>",
        replyTo: "info@example.com",
        to: operator().contact.email!,
        httpStatus: 200,
        reachedProvider: true,
        failure: null,
      });
    },
  });
  assertEquals(alert.providerAccepted, true);
  assertEquals(alert.email, "provider_accepted");
  assertEquals(sms.length, 1);
  assertEquals(emails.length, 1);
  assertEquals(emailAttempts.length, 1);
  assertEquals(sms[0].organizationId, ORG);
  assertEquals(sms[0].messageKind, "voice_operator_alert");
  assert(sms[0].outboundKey.includes(ORG));
  assert(sms[0].outboundKey.includes("a".repeat(64)));
  assert(sms[0].body.includes(CALLER));
  assert(sms[0].body.includes("conversation-91"));
  assert(!sms[0].body.includes("provider-call-91"));
  assert(!sms[0].body.includes("private model text"));
  assertEquals(
    emails[0].idempotencyKey,
    `voice-operator-alert-${ORG}-${"a".repeat(64)}`,
  );
  assertEquals(emailAttempts[0].template, "voice_operator_alert");
  assertEquals(emailAttempts[0].status, "accepted");
  assertEquals(emailAttempts[0].provider_message_id, "email-1");
  assertEquals(emailAttempts[0].source_session_id, "conversation-91");
  assertEquals(
    (emailAttempts[0].metadata as Record<string, unknown>).source,
    "voice_human_transfer",
  );
});

Deno.test("human transfer: 2xx email without provider correlation remains uncertain", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const state = await recordVoiceOperatorEmailAttempt({
    from(table: string) {
      assertEquals(table, "email_send_attempts");
      return {
        insert(row: Record<string, unknown>) {
          rows.push(row);
          return this;
        },
        select() {
          return this;
        },
        eq() {
          return this;
        },
        contains() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[rows.length - 1], error: null });
        },
      };
    },
  }, {
    organizationId: ORG,
    transferStatus: "failed",
    contact: operator().contact,
    claim: winner(),
  }, {
    ok: true,
    providerMessageId: null,
    from: "BluLadder <alerts@example.com>",
    replyTo: "info@example.com",
    to: operator().contact.email!,
    httpStatus: 202,
    reachedProvider: true,
    failure: null,
  });
  assertEquals(state, "uncertain");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "failed");
  assertEquals(
    rows[0].failure_category,
    "provider_accepted_without_message_id",
  );
});

Deno.test("human transfer: completion verifies the note and callback row before reporting durable success", async () => {
  const noteUpdates: Array<Record<string, unknown>> = [];
  const conversationUpdates: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      let update: Record<string, unknown> = {};
      const chain = {
        update(value: Record<string, unknown>) {
          update = value;
          if (table === "chat_messages") noteUpdates.push(value);
          if (table === "chat_conversations") conversationUpdates.push(value);
          return this;
        },
        eq() {
          return this;
        },
        contains() {
          return this;
        },
        select() {
          return this;
        },
        maybeSingle() {
          if (table === "chat_messages") {
            return Promise.resolve({
              data: {
                id: winner().noteId,
                conversation_id: winner().conversationId,
                ai_metadata: update.ai_metadata,
              },
              error: null,
            });
          }
          return Promise.resolve({
            data: { id: winner().conversationId, ...update },
            error: null,
          });
        },
      };
      return chain;
    },
  };
  const persisted = await finishVoiceTransferAttempt(client, {
    claim: winner(),
    organizationId: ORG,
    callerPhone: CALLER,
    transferStatus: "failed",
    alert: {
      sms: "provider_accepted",
      email: "provider_accepted",
      providerAccepted: true,
    },
    appUrl: "https://bid.bluladder.com",
  });
  assertEquals(persisted, true);
  assertEquals(noteUpdates.length, 1);
  assertEquals(conversationUpdates, [{
    callback_requested: true,
    needs_attention: true,
    manual_review_reason: "voice_human_transfer_followup",
  }]);
  const metadata = noteUpdates[0].ai_metadata as Record<string, unknown>;
  assertEquals(metadata.callback_notification_status, "provider_accepted");
  assertEquals(metadata.callback_notification_channels, {
    sms: "provider_accepted",
    email: "provider_accepted",
  });
});

Deno.test("human transfer: zero-row operational-note update is not durable success", async () => {
  let conversationUpdates = 0;
  const persisted = await finishVoiceTransferAttempt({
    from(table: string) {
      const chain = {
        update() {
          if (table === "chat_conversations") conversationUpdates++;
          return this;
        },
        eq() {
          return this;
        },
        contains() {
          return this;
        },
        select() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  }, {
    claim: winner(),
    organizationId: ORG,
    callerPhone: CALLER,
    transferStatus: "failed",
    alert: null,
    appUrl: "https://bid.bluladder.com",
  });
  assertEquals(persisted, false);
  assertEquals(conversationUpdates, 0);
});
