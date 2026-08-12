// deno-lint-ignore-file no-explicit-any require-await
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
  /** Omit provider artifact/transcript evidence entirely (manifest default). */
  noArtifact?: boolean;
} = {}) {
  return {
    message: {
      type: "end-of-call-report",
      endedReason: opts.endedReason ?? "customer-ended-call",
      call: { id: CALL_ID },
      customer: opts.number === null
        ? {}
        : { number: opts.number ?? "+14692150144" },
      artifact: opts.noArtifact ? {} : {
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
  /** Persisted internal caller turns for the resolved conversation. */
  journalUserRows?: Array<{ id: string; content: string }>;
  journalError?: boolean;
  quoteSessionId?: string | null;
  quoteSessionWriteError?: boolean;
  callbackRequested?: boolean;
  manualReviewReason?: string | null;
  humanTransferRows?: Array<{
    id: string;
    ai_metadata: Record<string, unknown>;
  }>;
  humanTransferError?: boolean;
} = {}) {
  const touched: string[] = [];
  const journalQueries: Array<Record<string, unknown>> = [];
  const humanTransferQueries: Array<Record<string, unknown>> = [];
  const conversationRow = opts.facts === null ? null : {
    id: "conv-1",
    facts: opts.facts ?? {},
    booking_status: opts.bookingStatus ?? "none",
    quote_session_id: opts.quoteSessionId ?? null,
    organization_id: "00000000-0000-4000-8000-000000000072",
    callback_requested: opts.callbackRequested ?? false,
    manual_review_reason: opts.manualReviewReason ?? null,
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
      if (table === "quote_sessions" && opts.quoteSessionId) {
        return Promise.resolve(
          opts.quoteSessionWriteError
            ? { data: null, error: { message: "write failed" } }
            : {
              data: {
                id: opts.quoteSessionId,
                organization_id: "00000000-0000-4000-8000-000000000072",
                fields: {},
                updated_at: "2026-08-01T00:00:00.000Z",
              },
              error: null,
            },
        );
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
    // chat_messages: assert the exact bounded query shape, then resolve.
    if (table === "chat_messages") {
      const q: Record<string, unknown> = {
        eq: {} as Record<string, unknown>,
        contains: {} as Record<string, unknown>,
      };
      (chain as any).select = (cols: string) => {
        q.select = cols;
        return chain;
      };
      (chain as any).eq = (col: string, val: unknown) => {
        (q.eq as Record<string, unknown>)[col] = val;
        return chain;
      };
      (chain as any).contains = (col: string, val: unknown) => {
        (q.contains as Record<string, unknown>)[col] = val;
        return chain;
      };
      (chain as any).limit = (n: number) => {
        q.limit = n;
        const metadata = (q.contains as Record<string, unknown>).ai_metadata;
        const humanTransfer = !!metadata && typeof metadata === "object" &&
          (metadata as Record<string, unknown>).source ===
            "voice_human_transfer";
        if (humanTransfer) {
          humanTransferQueries.push(q);
          return Promise.resolve(
            opts.humanTransferError
              ? { data: null, error: { message: "read failed" } }
              : { data: opts.humanTransferRows ?? [], error: null },
          );
        }
        journalQueries.push(q);
        return Promise.resolve(
          opts.journalError
            ? { data: null, error: { message: "read failed" } }
            : { data: opts.journalUserRows ?? [], error: null },
        );
      };
    }
    return chain;
  };
  return {
    touched,
    journalQueries,
    humanTransferQueries,
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

Deno.test("deliverable firm session sends the actual quote and suppresses generic fallback", async () => {
  const generic = recordingDeliver();
  let actualCalls = 0;
  const result = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({
      quoteSessionId: "00000000-0000-4000-8000-000000000073",
      facts: {
        services: ["window_cleaning"],
        contact: {
          name: "Synthetic Caller",
          email: "synthetic@example.com",
          phone: "+14692150144",
          phoneConfirmed: true,
        },
        address: "5612 Binbranch Lane, McKinney, TX 75071",
        serviceArea: { status: "eligible" },
        quote: { status: "firm", firm: true, total: 216.5 },
      },
    }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    organizationId: "00000000-0000-4000-8000-000000000072",
    callFunction: async () => ({ status: 500, json: {} }),
    deliverActualQuote: async () => {
      actualCalls += 1;
      return {
        ok: true,
        status: "provider_accepted",
        quoteId: "00000000-0000-4000-8000-000000000076",
        attemptId: "attempt-synthetic",
      };
    },
    deliver: generic.fn,
  });
  assertEquals(result.status, "actual_quote_sent");
  assertEquals(actualCalls, 1);
  assertEquals(generic.calls.length, 0);
});

Deno.test("uncertain actual quote outcome never falls through to generic SMS", async () => {
  const generic = recordingDeliver();
  const result = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({
      quoteSessionId: "00000000-0000-4000-8000-000000000073",
      facts: {
        contact: { phone: "+14692150144", phoneConfirmed: true },
      },
    }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    organizationId: "00000000-0000-4000-8000-000000000072",
    callFunction: async () => ({ status: 500, json: {} }),
    deliverActualQuote: async () => ({
      ok: false,
      status: "uncertain",
      reason: "sms_not_sent",
      detail: "provider_outcome_unknown",
    }),
    deliver: generic.fn,
  });
  assertEquals(result.status, "actual_quote_pending");
  assertEquals(generic.calls.length, 0);
});

Deno.test("phase6 terminal generated quote and generic fallback never execute in one event", async () => {
  const generic = recordingDeliver();
  let actualCalls = 0;
  const result = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({
      quoteSessionId: "00000000-0000-4000-8000-000000000073",
      facts: {
        contact: { phone: "+14692150144", phoneConfirmed: true },
        quote: { status: "firm", firm: true, total: 216.5 },
      },
    }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    organizationId: "00000000-0000-4000-8000-000000000072",
    callFunction: async () => ({ status: 500, json: {} }),
    deliverActualQuote: async () => {
      actualCalls += 1;
      return {
        ok: false,
        status: "failed_terminal",
        reason: "email_unavailable",
        detail: "canonical_email_unconfirmed",
      };
    },
    deliver: generic.fn,
  });
  assertEquals(actualCalls, 1);
  assertEquals(generic.calls.length, 0);
  assertEquals(result.status, "failed");
  assertEquals(result.detail, "canonical_email_unconfirmed");
});

Deno.test("provider acceptance without a durable delivery-mode marker stays pending", async () => {
  const generic = recordingDeliver();
  const result = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({
      quoteSessionId: "00000000-0000-4000-8000-000000000073",
      quoteSessionWriteError: true,
      facts: {
        contact: { phone: "+14695550172", phoneConfirmed: true },
      },
    }),
    body: endOfCallBody({ number: "+14695550172" }),
    eventType: "end-of-call-report",
    organizationId: "00000000-0000-4000-8000-000000000072",
    callFunction: async () => ({ status: 500, json: {} }),
    deliverActualQuote: async () => ({
      ok: true,
      status: "provider_accepted",
      quoteId: "00000000-0000-4000-8000-000000000076",
    }),
    deliver: generic.fn,
  });
  assertEquals(result.status, "actual_quote_pending");
  assertEquals(result.detail, "provider_accepted_mode_record_unconfirmed");
  assertEquals(generic.calls.length, 0);
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

Deno.test("durable callback state suppresses the unrelated hangup bid link", async () => {
  const deliver = recordingDeliver();
  const sb = stubSupabase({
    facts: {},
    callbackRequested: true,
    manualReviewReason: "voice_human_transfer_followup",
  });
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "human_followup_requested");
  assertEquals(deliver.calls.length, 0);
  assertEquals(sb.humanTransferQueries.length, 0);
});

Deno.test("provider-accepted transfer claim suppresses the hangup bid link without callback flags", async () => {
  const deliver = recordingDeliver();
  const sb = stubSupabase({
    facts: {},
    humanTransferRows: [{
      id: "transfer-note-1",
      ai_metadata: { source: "voice_human_transfer" },
    }],
  });
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "human_followup_requested");
  assertEquals(deliver.calls.length, 0);
  assertEquals(sb.humanTransferQueries.length, 1);
  assertEquals(
    sb.humanTransferQueries[0].select,
    "id, ai_metadata",
  );
  assertEquals(
    (sb.humanTransferQueries[0].contains as any).ai_metadata,
    { source: "voice_human_transfer" },
  );
});

Deno.test("unreadable transfer-claim evidence fails closed before hangup delivery", async () => {
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: stubSupabase({ facts: {}, humanTransferError: true }),
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "failed");
  assertEquals(res.detail, "human_followup_unreadable");
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

Deno.test("suppressed transcript artifact + persisted internal caller turn is eligible", async () => {
  const sb = stubSupabase({
    facts: {},
    journalUserRows: [{ id: "m1", content: "how much for windows" }],
  });
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody({ noArtifact: true }),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "sent");
  assertEquals(deliver.calls.length, 1);
  // Exact bounded query shape is exercised, not bypassed.
  assertEquals(sb.journalQueries.length, 1);
  assertEquals(sb.journalQueries[0].select, "id, content");
  assertEquals(sb.journalQueries[0].limit, 1);
  assertEquals((sb.journalQueries[0].eq as any).conversation_id, "conv-1");
  assertEquals((sb.journalQueries[0].eq as any).role, "user");
});

Deno.test("suppressed artifact + empty internal journal skips", async () => {
  const sb = stubSupabase({ facts: {}, journalUserRows: [] });
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody({ noArtifact: true }),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "no_customer_interaction");
  assertEquals(deliver.calls.length, 0);
  // Whitespace-only journal rows are not proof either.
  const blank = stubSupabase({
    facts: {},
    journalUserRows: [{ id: "m1", content: "   " }],
  });
  const res2 = await runVoiceHangupBidLinkFollowup({
    supabase: blank,
    body: endOfCallBody({ noArtifact: true }),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res2.status, "no_customer_interaction");
  assertEquals(deliver.calls.length, 0);
});

Deno.test("chat_messages read error fails closed", async () => {
  const sb = stubSupabase({ facts: {}, journalError: true });
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody({ noArtifact: true }),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "no_customer_interaction");
  assertEquals(res.detail, "journal_unreadable");
  assertEquals(deliver.calls.length, 0);
});

Deno.test("provider utterance evidence alone remains sufficient", async () => {
  const sb = stubSupabase({ facts: {}, journalError: true });
  const deliver = recordingDeliver();
  const res = await runVoiceHangupBidLinkFollowup({
    supabase: sb,
    body: endOfCallBody(),
    eventType: "end-of-call-report",
    deliver: deliver.fn,
  });
  assertEquals(res.status, "sent");
  assertEquals(deliver.calls.length, 1);
  // Journal is not consulted when the provider already proved interaction.
  assertEquals(sb.journalQueries.length, 0);
});

Deno.test("journal fallback never overrides completed booking / delivered / declined skips", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ bookingStatus: "confirmed" }, "already_booked"],
    [{ quoteByText: { lastReason: "sent" } }, "already_delivered"],
    [{ quoteByText: { lastReason: "cancelled" } }, "declined_texting"],
  ];
  for (const [facts, expected] of cases) {
    const deliver = recordingDeliver();
    const res = await runVoiceHangupBidLinkFollowup({
      supabase: stubSupabase({
        facts,
        journalUserRows: [{ id: "m1", content: "hello" }],
      }),
      body: endOfCallBody({ noArtifact: true }),
      eventType: "end-of-call-report",
      deliver: deliver.fn,
    });
    assertEquals(res.status, expected);
    assertEquals(deliver.calls.length, 0);
  }
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
      humanFollowupRequested: false,
      facts: {},
    }).eligible,
    true,
  );
  assertEquals(
    evaluateHangupFollowupEligibility({
      phoneE164: "+14692150144",
      hadCustomerUtterance: true,
      systemTest: true,
      humanFollowupRequested: false,
      facts: {},
    }).eligible,
    false,
  );
});
