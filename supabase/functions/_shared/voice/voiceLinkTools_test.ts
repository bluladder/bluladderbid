import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVoiceCallLinkOutboundKey } from "./voiceCallLinkIdentity.ts";
import type { OutboxSendInput } from "../smsOutbox.ts";
import {
  buildVoiceCustomerLink,
  handleVoiceLinkToolCalls,
  summarizeVoiceLinkToolEnvelope,
  VOICE_BOOKING_MANAGEMENT_LINK_TOOL,
  VOICE_QUOTE_LINK_TOOL,
  type VoiceLinkToolDeps,
  type VoiceLinkToolResult,
} from "./voiceLinkTools.ts";

const ORG = "00000000-0000-4000-8000-000000000091";

function body(
  names: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    message: {
      type: "tool-calls",
      toolCallList: names.map((name, index) => ({
        id: `tool-${index + 1}`,
        name,
        // Hostile model arguments are ignored by the implementation.
        arguments: { phone: "+12145550000", organizationId: "other-org" },
      })),
      call: {
        id: "call-91",
        assistantId: "assistant-mapped-by-server",
        customer: { number: "+14697472877" },
      },
    },
    ...extra,
  };
}

function acceptedResult() {
  return {
    sent: true,
    smsMessageId: "sms-1",
    outboxState: "provider_accepted" as const,
    replay: false,
    inProgress: false,
    escalated: false,
    providerMessageId: "provider-1",
  };
}

function decodedResult(value: string): VoiceLinkToolResult {
  return JSON.parse(value) as VoiceLinkToolResult;
}

function allowedDeps(
  deliver: NonNullable<VoiceLinkToolDeps["deliver"]>,
) {
  return {
    appUrl: "https://bid.bluladder.com",
    suppressionCheck: () =>
      Promise.resolve({ suppressed: false, reason: null }),
    phoneOptOutCheck: () =>
      Promise.resolve({ optedOut: false, readable: true }),
    customerPauseCheck: () =>
      Promise.resolve({
        sms_paused: false,
        email_paused: false,
        readable: true,
      }),
    deliver,
  };
}

Deno.test("voice link tools: duplicate calls share one delivery attempt and exact fallback identity", async () => {
  const deliveries: OutboxSendInput[] = [];
  const result = await handleVoiceLinkToolCalls(
    null,
    {
      body: body([VOICE_QUOTE_LINK_TOOL, VOICE_QUOTE_LINK_TOOL]),
      organizationId: ORG,
    },
    allowedDeps((_client, input) => {
      deliveries.push(input);
      return Promise.resolve(acceptedResult());
    }),
  );

  assertEquals(deliveries.length, 1);
  assertEquals(
    deliveries[0].outboundKey,
    buildVoiceCallLinkOutboundKey("call-91", "+14697472877"),
  );
  assertEquals(result.results.length, 2);
  assertEquals(
    decodedResult(result.results[0].result).status,
    "provider_accepted",
  );
  assertEquals(
    decodedResult(result.results[1].result).status,
    "provider_accepted",
  );
  assertEquals(result.results[0].result.includes("\n"), false);
});

Deno.test("voice link tools: duplicate booking-management requests send one exact portal link", async () => {
  const deliveries: OutboxSendInput[] = [];
  const result = await handleVoiceLinkToolCalls(
    null,
    {
      body: body([
        VOICE_BOOKING_MANAGEMENT_LINK_TOOL,
        VOICE_BOOKING_MANAGEMENT_LINK_TOOL,
      ]),
      organizationId: ORG,
    },
    allowedDeps((_client, input) => {
      deliveries.push(input);
      return Promise.resolve(acceptedResult());
    }),
  );

  assertEquals(deliveries.length, 1);
  assertEquals(deliveries[0].messageKind, "voice_booking_management_link");
  assertEquals(
    new URL(deliveries[0].body.split(" ").at(-1)!).pathname,
    "/customer-portal",
  );
  assertEquals(
    deliveries[0].outboundKey,
    buildVoiceCallLinkOutboundKey("call-91", "+14697472877"),
  );
  assertEquals(
    result.results.map((entry) => decodedResult(entry.result).status),
    ["provider_accepted", "provider_accepted"],
  );
});

Deno.test("voice link tools: quote and appointment purposes never compete", async () => {
  let deliveries = 0;
  const result = await handleVoiceLinkToolCalls(
    null,
    {
      body: body([
        VOICE_QUOTE_LINK_TOOL,
        VOICE_BOOKING_MANAGEMENT_LINK_TOOL,
      ]),
      organizationId: ORG,
    },
    allowedDeps(() => {
      deliveries++;
      return Promise.resolve(acceptedResult());
    }),
  );
  assertEquals(deliveries, 0);
  assertEquals(
    result.results.map((entry) => decodedResult(entry.result).status),
    ["invalid_request", "invalid_request"],
  );
});

Deno.test("voice link tools: spoken success is authorized only by durable provider acceptance", async () => {
  for (
    const [outbox, expected, maySaySent] of [
      [acceptedResult(), "provider_accepted", true],
      [
        {
          ...acceptedResult(),
          sent: false,
          inProgress: true,
          outboxState: "sending",
        },
        "queued",
        false,
      ],
      [
        { ...acceptedResult(), sent: false, outboxState: "delivery_unknown" },
        "uncertain",
        false,
      ],
      [
        {
          ...acceptedResult(),
          sent: false,
          outboxState: "send_failed",
          error: "rejected",
        },
        "failed",
        false,
      ],
    ] as const
  ) {
    const result = await handleVoiceLinkToolCalls(
      null,
      { body: body([VOICE_QUOTE_LINK_TOOL]), organizationId: ORG },
      allowedDeps(() => Promise.resolve(outbox)),
    );
    const evidence = decodedResult(result.results[0].result);
    assertEquals(evidence.status, expected);
    assertEquals(
      /may say the link was sent/i.test(evidence.message),
      maySaySent,
    );
  }
});

Deno.test("voice link tools: model-supplied phone and tenant authority are ignored", async () => {
  let deliveries = 0;
  const hostile = body([VOICE_QUOTE_LINK_TOOL]);
  const message = hostile.message as Record<string, unknown>;
  message.call = { id: "call-91", assistantId: "assistant-mapped-by-server" };
  const result = await handleVoiceLinkToolCalls(
    null,
    { body: hostile, organizationId: ORG },
    allowedDeps(() => {
      deliveries++;
      return Promise.resolve(acceptedResult());
    }),
  );
  assertEquals(deliveries, 0);
  assertEquals(
    decodedResult(result.results[0].result).status,
    "invalid_request",
  );
});

Deno.test("voice link tools: exact canonical links contain no customer data", () => {
  const quote = buildVoiceCustomerLink(
    VOICE_QUOTE_LINK_TOOL,
    "https://bid.bluladder.com/",
  );
  const manage = buildVoiceCustomerLink(
    VOICE_BOOKING_MANAGEMENT_LINK_TOOL,
    "https://bid.bluladder.com",
  );
  assertEquals(new URL(quote).pathname, "/");
  assertEquals(new URL(manage).pathname, "/customer-portal");
  assert(new URL(quote).searchParams.has("utm_source"));
  assert(!quote.includes("4697472877"));
  assert(!manage.includes(ORG));
});

Deno.test("voice link tools: suppression, opt-out, and pause prevent outbox dispatch", async () => {
  const cases = [
    {
      expected: "suppressed",
      override: {
        suppressionCheck: () =>
          Promise.resolve({ suppressed: true, reason: "admin_switch" }),
      },
    },
    {
      expected: "opted_out",
      override: {
        phoneOptOutCheck: () =>
          Promise.resolve({ optedOut: true, readable: true }),
      },
    },
    {
      expected: "paused",
      override: {
        customerPauseCheck: () =>
          Promise.resolve({
            sms_paused: true,
            email_paused: false,
            readable: true,
          }),
      },
    },
  ];
  for (const testCase of cases) {
    let deliveries = 0;
    const deps = {
      ...allowedDeps(() => {
        deliveries++;
        return Promise.resolve(acceptedResult());
      }),
      ...testCase.override,
    };
    const result = await handleVoiceLinkToolCalls(
      null,
      { body: body([VOICE_QUOTE_LINK_TOOL]), organizationId: ORG },
      deps,
    );
    assertEquals(deliveries, 0);
    assertEquals(
      decodedResult(result.results[0].result).status,
      testCase.expected,
    );
  }
});

Deno.test("voice link tools: documented wrapped Vapi tool calls execute and return a string result", async () => {
  let deliveries = 0;
  const wrapped = body([]);
  const message = wrapped.message as Record<string, unknown>;
  delete message.toolCallList;
  message.toolWithToolCallList = [{
    name: VOICE_QUOTE_LINK_TOOL,
    toolCall: {
      id: "wrapped-tool-1",
      parameters: { phone: "+12145550000" },
    },
  }];

  const result = await handleVoiceLinkToolCalls(
    null,
    { body: wrapped, organizationId: ORG },
    allowedDeps(() => {
      deliveries++;
      return Promise.resolve(acceptedResult());
    }),
  );

  assertEquals(deliveries, 1);
  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].toolCallId, "wrapped-tool-1");
  assertEquals(typeof result.results[0].result, "string");
  assertEquals(
    decodedResult(result.results[0].result).status,
    "provider_accepted",
  );
});

Deno.test("voice link tools: OpenAI-style direct function nesting executes without trusting arguments", async () => {
  let deliveredTo: string | null = null;
  const nested = body([]);
  const message = nested.message as Record<string, unknown>;
  message.toolCallList = [{
    id: "openai-direct-1",
    type: "function",
    function: {
      name: VOICE_QUOTE_LINK_TOOL,
      arguments: JSON.stringify({
        phone: "+12145550000",
        organizationId: "hostile-model-org",
      }),
    },
  }];

  const result = await handleVoiceLinkToolCalls(
    null,
    { body: nested, organizationId: ORG },
    allowedDeps((_client, input) => {
      deliveredTo = input.toNumber;
      return Promise.resolve(acceptedResult());
    }),
  );

  assertEquals(result.results[0].toolCallId, "openai-direct-1");
  assertEquals(
    decodedResult(result.results[0].result).status,
    "provider_accepted",
  );
  assertEquals(deliveredTo, "+14697472877");
});

Deno.test("voice link tools: OpenAI-style wrapped function nesting executes", async () => {
  let deliveries = 0;
  const nested = body([]);
  const message = nested.message as Record<string, unknown>;
  delete message.toolCallList;
  message.toolWithToolCallList = [{
    type: "function",
    toolCall: {
      id: "openai-wrapped-1",
      type: "function",
      function: {
        name: VOICE_QUOTE_LINK_TOOL,
        arguments: "{}",
      },
    },
  }];

  const result = await handleVoiceLinkToolCalls(
    null,
    { body: nested, organizationId: ORG },
    allowedDeps(() => {
      deliveries++;
      return Promise.resolve(acceptedResult());
    }),
  );

  assertEquals(deliveries, 1);
  assertEquals(result.results[0].toolCallId, "openai-wrapped-1");
  assertEquals(
    decodedResult(result.results[0].result).status,
    "provider_accepted",
  );
});

Deno.test("voice link tools: rejected-envelope diagnostics contain counts only", () => {
  const summary = summarizeVoiceLinkToolEnvelope({
    message: {
      type: "tool-calls",
      toolCallList: [{
        id: "private-tool-id",
        function: {
          arguments: JSON.stringify({ phone: "+14697472877" }),
        },
      }],
      call: {
        id: "private-call-id",
        customer: { number: "+14697472877" },
      },
    },
  });
  assertEquals(summary, {
    messageTypeIsToolCalls: true,
    directCount: 1,
    directWithId: 1,
    directWithFlatName: 0,
    directWithFunctionName: 0,
    wrappedCount: 0,
    wrappedWithId: 0,
    wrappedWithTopName: 0,
    wrappedWithToolCallName: 0,
    wrappedWithFunctionName: 0,
  });
  const serialized = JSON.stringify(summary);
  assertEquals(serialized.includes("private-tool-id"), false);
  assertEquals(serialized.includes("private-call-id"), false);
  assertEquals(serialized.includes("+14697472877"), false);
});
