// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBidLinkMessage,
  buildBidLinkOutboundKey,
  canonicalOnlineBidUrl,
  evaluateHangupFollowupEligibility,
  extractCallEndContext,
  isFinalCallEndedEvent,
  runVoiceHangupBidLinkFollowup,
} from "./hangupBidLinkFollowup.ts";

const CALL_ID = "019fb423-7a5b-7990-98fe-6e7db8062f50";

function endOfCallBody(opts: {
  facts?: unknown;
  number?: string | null;
  transcript?: string;
  endedReason?: string;
} = {}) {
  return {
    message: {
      type: "end-of-call-report",
      endedReason: opts.endedReason ?? "customer-ended-call",
      call: { id: CALL_ID },
      customer: opts.number === null
        ? {}
        : { number: opts.number ?? "+14692150144" },
      artifact: {
        messages: [
          { role: "user", message: opts.transcript ?? "how much for windows" },
        ],
      },
    },
  };
}

/** Minimal supabase stub. Records every table/rpc touched. */
function stubSupabase(opts: {
  facts?: Record<string, unknown> | null;
  bookingStatus?: string;
  suppressAll?: boolean;
  testIdentity?: boolean;
  optedOut?: boolean;
  smsPaused?: boolean;
} = {}) {
  const touched: string[] = [];
  const conversationRow = opts.facts === null ? null : {
    id: "conv-1",
    facts: opts.facts ?? {},
    booking_status: opts.bookingStatus ?? "none",
  };
  const builder = (table: string) => {
    touched.push(table);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (
      const m of [
        "select",
        "eq",
        "or",
        "order",
        "limit",
        "is",
        "update",
        "gte",
        "in",
      ]
    ) {
      (chain as any)[m] = self;
    }
    (chain as any).maybeSingle = () => {
      if (table === "chat_conversations") {
        return Promise.resolve({ data: conversationRow, error: null });
      }
      if (table === "system_test_config") {
        return Promise.resolve({
          data: {
            id: "default",
            suppress_all: !!opts.suppressAll,
            suppress_reason: "off",
          },
          error: null,
        });
      }
      if (table === "sms_opt_outs") {
        return Promise.resolve({
          data: { opted_out: !!opts.optedOut },
          error: null,
        });
      }
      if (table === "customers") {
        return Promise.resolve({
          data: { sms_paused: !!opts.smsPaused, email_paused: false },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    (chain as any).then = undefined;
    // test_identities uses .limit() as the terminal await
    if (table === "test_identities") {
      (chain as any).limit = () =>
        Promise.resolve({
          data: opts.testIdentity ? [{ id: "t1" }] : [],
          error: null,
        });
    }
    return chain;
  };
  return {
    touched,
    from: (t: string) => builder(t),
    rpc: (name: string) => {
      touched.push(`rpc:${name}`);
      return Promise.resolve({ data: null, error: null });
    },
  } as any;
}

function recordingDeliver(result: Partial<{
  sent: boolean;
  replay: boolean;
  inProgress: boolean;
  error: string;
}> = {}) {
  const calls: any[] = [];
  const fn = (_sb: unknown, input: unknown) => {
    calls.push(input);
    return Promise.resolve({
      sent: result.sent ?? true,
      smsMessageId: "sms-1",
      outboxState: result.sent === false ? "send_failed" : "provider_accepted",
      replay: result.replay ?? false,
      inProgress: result.inProgress ?? false,
      escalated: false,
      providerMessageId: "prov-1",
      error: result.error,
    });
  };
  return { calls, fn: fn as any };
}

Deno.test("only the final call-ended event is authoritative", () => {
  assert(isFinalCallEndedEvent("end-of-call-report"));
  for (const e of ["status-update", "hang", "assistant.started", null]) {
    assertEquals(isFinalCallEndedEvent(e as string | null), false);
  }
});

Deno.test("active-call / non-final webhook does nothing", async () => {
  const sb = stubSupabase();
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: { message: { type: "status-update", call: { id: CALL_ID } } },
    eventType: "status-update",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "not_final_event");
  assertEquals(deliver.calls.length, 0);
  assertEquals(sb.touched.length, 0);
});

Deno.test("eligible final hangup sends the exact canonical online-bid link", async () => {
  const sb = stubSupabase({ facts: {} });
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "sent");
  assertEquals(deliver.calls.length, 1);
  assertEquals(deliver.calls[0].toNumber, "+14692150144");
  assertEquals(
    deliver.calls[0].body,
    buildBidLinkMessage(canonicalOnlineBidUrl()),
  );
  assert(deliver.calls[0].body.includes(canonicalOnlineBidUrl()));
  assertEquals(
    deliver.calls[0].outboundKey,
    `voice_call_bid_link:${CALL_ID}:4692150144`,
  );
  assertEquals(deliver.calls[0].messageKind, "voice_call_bid_link");
});

Deno.test("duplicate final webhook produces no second upstream send", async () => {
  const sb = stubSupabase({ facts: {} });
  const deliver = recordingDeliver({ replay: true });
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "duplicate");
  // Same stable key both times — the outbox, not this module, dedupes.
  assertEquals(
    buildBidLinkOutboundKey(CALL_ID, "+14692150144"),
    buildBidLinkOutboundKey(CALL_ID, "(469) 215-0144"),
  );
});

Deno.test("accepted quote-by-text delivery skips the follow-up", async () => {
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({ facts: { quoteByText: { lastReason: "sent" } } }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "already_delivered");
  assertEquals(deliver.calls.length, 0);
});

Deno.test("completed booking skips the follow-up", async () => {
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({ facts: { bookingStatus: "confirmed" } }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "already_booked");
  assertEquals(deliver.calls.length, 0);
});

Deno.test("explicit 'don't text me' cancellation skips the follow-up", async () => {
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({
      facts: { quoteByText: { lastReason: "cancelled" } },
    }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "declined_texting");
  assertEquals(deliver.calls.length, 0);
});

Deno.test("missing or invalid caller phone skips", async () => {
  const deliver = recordingDeliver();
  for (const number of [null, "anonymous"]) {
    const res = await runVoiceHangupBidLinkFollowup({
      supabase: stubSupabase({ facts: {} }),
      body: endOfCallBody({ number }),
      eventType: "end-of-call-report",
      deliver: deliver.fn,
    });
    assertEquals(res.status, "missing_phone");
  }
  assertEquals(deliver.calls.length, 0);
});

Deno.test("no customer utterance / health-check call skips", async () => {
  const deliver = recordingDeliver();
  const noUtterance = {
    message: {
      type: "end-of-call-report",
      call: { id: CALL_ID },
      customer: { number: "+14692150144" },
      endedReason: "customer-did-not-answer",
      artifact: { messages: [] },
    },
  };
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({ facts: {} }),
    body: noUtterance,
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "no_customer_interaction");
  // No conversation at all is also a skip.
  const orphan = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({ facts: null }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(orphan.status, "no_customer_interaction");
  assertEquals(deliver.calls.length, 0);
});

Deno.test("suppressed / opted-out / paused / provider-unknown are never 'sent'", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ suppressAll: true }, "suppressed"],
    [{ testIdentity: true }, "suppressed"],
    [{ optedOut: true }, "opted_out"],
    [{ smsPaused: true }, "paused"],
  ];
  for (const [opts, expected] of cases) {
    const deliver = recordingDeliver();
    const res = await runVoiceHangupBidLinkFollowup({
      supabase: stubSupabase({ facts: {}, ...opts }),
      body: endOfCallBody(),
      eventType: "end-of-call-report",
      deliver: deliver.fn,
    });
    assertEquals(res.status, expected);
    assertEquals(deliver.calls.length, 0);
  }
  const deliver = recordingDeliver({ sent: false, error: "delivery_unknown" });
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({ facts: {} }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "failed");
});

Deno.test("no direct provider call exists in the new path", async () => {
  const src = await Deno.readTextFile(
    new URL("./hangupBidLinkFollowup.ts", import.meta.url),
  );
  assertEquals(/sendCallRailSms|callrail\.com|fetch\(/i.test(src), false);
  assert(src.includes("sendOutboxSms"));
});

Deno.test("call-end context extraction reads provider shapes", () => {
  const ctx = extractCallEndContext(endOfCallBody());
  assertEquals(ctx.callId, CALL_ID);
  assertEquals(ctx.callerNumber, "+14692150144");
  assertEquals(ctx.hadCustomerUtterance, true);
  assertEquals(ctx.systemTest, false);
});

Deno.test("eligibility is pure and fail-closed", () => {
  assertEquals(
    evaluateHangupFollowupEligibility({
      phoneE164: "+14692150144",
      hadCustomerUtterance: true,
      systemTest: false,
      facts: {},
    }).eligible,
    true,
  );
  assertEquals(
    evaluateHangupFollowupEligibility({
      phoneE164: "+14692150144",
      hadCustomerUtterance: true,
      systemTest: true,
      facts: {},
    }).eligible,
    false,
  );
});
