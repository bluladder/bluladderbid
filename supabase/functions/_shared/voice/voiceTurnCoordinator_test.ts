import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ParsedAdapterRequest } from "../voiceAdapter.ts";
import {
  buildSilentVoiceResponse,
  claimVoiceTurn,
  deriveVoiceTurnDescriptor,
  filterProviderRecordingMessages,
  isAuthoritativeVoiceTurn,
  prepareVoiceIngress,
  runClaimedExternalAction,
} from "./voiceTurnCoordinator.ts";

// SANITIZED BEHAVIORAL RECONSTRUCTION — not an original provider log. The
// requested production call IDs were not present in the repository, so these
// bounded messages reproduce only the observed notice/real-speech behavior.
const reconstructedMessages = [
  {
    role: "user" as const,
    content: "This call may be recorded for quality assurance.",
  },
  { role: "assistant" as const, content: "How can I help?" },
  { role: "user" as const, content: "I need window cleaning." },
];

function request(messages = reconstructedMessages): ParsedAdapterRequest {
  return {
    messages,
    stream: false,
    sessionId: "vapi_call:sanitized-call-001",
    sessionIdIsSynthetic: false,
    callerIdE164: null,
    rawBody: {},
  };
}

Deno.test(
  "recording notice alone is removed before any customer turn can be claimed",
  () => {
    const filtered = filterProviderRecordingMessages([
      { role: "user", content: "This call will be recorded." },
    ]);
    assertEquals(filtered.noticesRemoved, 1);
    assertFalse(filtered.hasCustomerSpeech);
    assertEquals(filtered.messages, []);
  },
);

Deno.test(
  "notice-only ingress returns before every downstream mutation boundary",
  async () => {
    const notice = request([
      { role: "user", content: "This call will be recorded." },
    ]);
    const calls = {
      supabaseClient: 0,
      session: 0,
      controller: 0,
      journal: 0,
      quoteSession: 0,
    };
    const ingress = await prepareVoiceIngress(notice);
    if (ingress.status === "accepted") {
      calls.supabaseClient += 1;
      calls.session += 1;
      calls.controller += 1;
      calls.journal += 1;
      calls.quoteSession += 1;
    }
    assertEquals(ingress, {
      status: "ignored",
      reason: "recording_notice_only",
    });
    assertEquals(calls, {
      supabaseClient: 0,
      session: 0,
      controller: 0,
      journal: 0,
      quoteSession: 0,
    });
  },
);

Deno.test(
  "recording notice plus customer speech advances with only real speech",
  () => {
    const filtered = filterProviderRecordingMessages(reconstructedMessages);
    assertEquals(filtered.noticesRemoved, 1);
    assert(filtered.hasCustomerSpeech);
    assertEquals(
      filtered.messages.filter((m) => m.role === "user").map((m) => m.content),
      ["I need window cleaning."],
    );
  },
);

Deno.test("turn identity is stable after narrow notice filtering", async () => {
  const withNotice = await deriveVoiceTurnDescriptor(request());
  const withoutNotice = await deriveVoiceTurnDescriptor(
    request(reconstructedMessages.slice(1)),
  );
  assertEquals(withNotice.turnId, withoutNotice.turnId);
  assertEquals(withNotice.contentHash, withoutNotice.contentHash);
  assertEquals(withNotice.position, 1);
});

Deno.test(
  "missing or synthetic authenticated call identity fails closed",
  async () => {
    await assertRejects(
      () =>
        deriveVoiceTurnDescriptor({
          ...request(),
          sessionId: "synthetic-local",
          sessionIdIsSynthetic: true,
        }),
      Error,
      "authenticated_call_identity_required",
    );
  },
);

Deno.test(
  "duplicate and causally later deliveries obey durable RPC decisions",
  async () => {
    const statuses = ["acquired", "duplicate", "wait", "acquired"];
    let rpcCalls = 0;
    const supabase = {
      rpc: () =>
        Promise.resolve({
          data: [{ status: statuses[rpcCalls++] }],
          error: null,
        }),
    };
    const turn = await deriveVoiceTurnDescriptor(request());
    const args = {
      ...turn,
      organizationId: "11111111-1111-4111-8111-111111111111",
    };
    assertEquals(await claimVoiceTurn(supabase, args), "acquired");
    assertEquals(await claimVoiceTurn(supabase, args), "duplicate");
    assertEquals(await claimVoiceTurn(supabase, args), "wait");
    assertEquals(await claimVoiceTurn(supabase, args), "acquired");
    assertEquals(rpcCalls, 4);
  },
);

Deno.test(
  "only the latest committed turn is authoritative before response",
  async () => {
    const results = [true, false];
    const supabase = {
      rpc: () => Promise.resolve({ data: results.shift(), error: null }),
    };
    const args = { organizationId: "o", callId: "c", turnId: "t" };
    assert(await isAuthoritativeVoiceTurn(supabase, args));
    assertFalse(await isAuthoritativeVoiceTurn(supabase, args));
  },
);

Deno.test(
  "exact duplicate executes controller and authoritative mutation once",
  async () => {
    const statuses = ["acquired", "duplicate"];
    let executions = 0;
    const supabase = {
      rpc: () =>
        Promise.resolve({ data: [{ status: statuses.shift() }], error: null }),
    };
    const turn = await deriveVoiceTurnDescriptor(request());
    const args = {
      ...turn,
      organizationId: "11111111-1111-4111-8111-111111111111",
    };
    for (let delivery = 0; delivery < 2; delivery += 1) {
      if ((await claimVoiceTurn(supabase, args)) === "acquired")
        executions += 1;
    }
    assertEquals(executions, 1);
  },
);

Deno.test(
  "uncertain external action is terminal and never automatically repeated",
  async () => {
    let providerCalls = 0;
    let claims = 0;
    const supabase = {
      rpc(name: string) {
        if (name === "claim_voice_external_action") {
          claims += 1;
          return Promise.resolve({
            data: [{ status: claims === 1 ? "acquired" : "terminal" }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    const args = {
      organizationId: "o",
      callId: "c",
      turnId: "t",
      actionKey: "booking",
      run: async () => {
        providerCalls += 1;
        throw new Error("timeout after send");
      },
      uncertain: () => ({ status: "uncertain", retryable: false }),
    };
    assertEquals(await runClaimedExternalAction(supabase, args), {
      status: "uncertain",
      retryable: false,
    });
    assertEquals(await runClaimedExternalAction(supabase, args), {
      status: "uncertain",
      retryable: false,
    });
    assertEquals(providerCalls, 1);
  },
);

Deno.test(
  "external action claim commits before provider execution",
  async () => {
    const order: string[] = [];
    const supabase = {
      rpc(name: string) {
        order.push(name);
        return Promise.resolve({
          data:
            name === "claim_voice_external_action"
              ? [{ status: "acquired" }]
              : null,
          error: null,
        });
      },
    };
    const result = await runClaimedExternalAction(supabase, {
      organizationId: "o",
      callId: "c",
      turnId: "t",
      actionKey: "booking",
      run: async () => {
        order.push("provider");
        return { status: "confirmed" };
      },
      uncertain: () => ({ status: "uncertain" }),
    });
    assertEquals(result, { status: "confirmed" });
    assertEquals(order, [
      "claim_voice_external_action",
      "provider",
      "finish_voice_external_action",
    ]);
  },
);

Deno.test(
  "finish-write failure suppresses apparent provider success",
  async () => {
    let providerCalls = 0;
    let claimCalls = 0;
    const supabase = {
      rpc(name: string) {
        if (name === "claim_voice_external_action") {
          claimCalls += 1;
          return Promise.resolve({
            data: [{ status: claimCalls === 1 ? "acquired" : "terminal" }],
            error: null,
          });
        }
        return Promise.resolve({
          data: null,
          error: { message: "write failed" },
        });
      },
    };
    const result = await runClaimedExternalAction(supabase, {
      organizationId: "o",
      callId: "c",
      turnId: "t",
      actionKey: "sms",
      run: async () => {
        providerCalls += 1;
        return { status: "accepted" };
      },
      uncertain: () => ({ status: "uncertain", retryable: false }),
    });
    assertEquals(providerCalls, 1);
    assertEquals(result, { status: "uncertain", retryable: false });
    const retry = await runClaimedExternalAction(supabase, {
      organizationId: "o",
      callId: "c",
      turnId: "t",
      actionKey: "sms",
      run: async () => {
        providerCalls += 1;
        return { status: "accepted" };
      },
      uncertain: () => ({ status: "uncertain", retryable: false }),
    });
    assertEquals(providerCalls, 1);
    assertEquals(retry, { status: "uncertain", retryable: false });
  },
);

Deno.test("stale SSE contract contains no delta.content frame", () => {
  const response = buildSilentVoiceResponse("test", true, "build");
  return response.text().then((staleSse) => {
    assertEquals(staleSse, "data: [DONE]\n\n");
    assertFalse(staleSse.includes("delta"));
    assertFalse(staleSse.includes("content"));
  });
});

Deno.test("stale JSON has no assistant choice or content", async () => {
  const response = buildSilentVoiceResponse("test", false, "build");
  const body = await response.json();
  assertEquals(body.choices, []);
  assertFalse(JSON.stringify(body).includes('"content"'));
});

Deno.test(
  "review-only SQL pins locking, leases, least privilege, and invoker rights",
  async () => {
    const sql = await Deno.readTextFile(
      new URL(
        "../../../release-candidates/voice_turn_single_flight.sql",
        import.meta.url,
      ),
    );
    for (const fragment of [
      "pg_advisory_xact_lock",
      "lease_expires_at",
      "status='uncertain'",
      "SECURITY INVOKER",
      "FORCE ROW LEVEL SECURITY",
      "REVOKE ALL",
      "GRANT EXECUTE",
      "service_role",
      "p_position",
      "position>t.position",
    ])
      assert(sql.includes(fragment), `missing ${fragment}`);
    const expiredBeforeRetry = sql.indexOf(
      "prior.lease_expires_at <= statement_timestamp()",
    );
    const sameTokenRetry = sql.indexOf(
      "prior.claim_token=p_claim_token AND prior.lease_expires_at > statement_timestamp()",
    );
    assert(expiredBeforeRetry > 0 && sameTokenRetry > expiredBeforeRetry);
    assertFalse(sql.includes("SECURITY DEFINER"));
  },
);

Deno.test(
  "ingress filtering and claim precede session mutation and controller execution",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../../voice-llm-adapter/index.ts", import.meta.url),
    );
    const filterAt = source.indexOf("await prepareVoiceIngress(request)");
    const silentAt = source.indexOf('if (ingress.status === "ignored")');
    const claimAt = source.indexOf("await claimVoiceTurn");
    const conversationAt = source.indexOf(
      "identity = await ensureVoiceConversation",
    );
    const controllerAt = source.indexOf("await executeControllerRoute");
    assert(filterAt > 0 && silentAt > filterAt);
    assert(claimAt > silentAt && conversationAt > claimAt);
    assert(controllerAt > conversationAt);
  },
);
