import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildControllerTurnJournalIdentity,
  buildIdempotentTurnRows,
  readLatestReplayableControllerReply,
  readReplayableControllerReply,
  recordVoiceTurns,
} from "./turnJournal.ts";
import {
  mayReplayCompletedVoiceTurnClaim,
  resolveCompletedVoiceTurnReplay,
  waitForCompletedVoiceTurnReplay,
} from "./voiceTurnReplay.ts";

Deno.test("idempotent user and assistant journal writes start concurrently", async () => {
  let insertStarts = 0;
  const resolveInserts: Array<() => void> = [];
  const supabase = {
    from(table: string) {
      if (table === "chat_conversations") {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: () =>
            Promise.resolve({
              data: { id: "conversation", organization_id: "organization" },
              error: null,
            }),
        };
        return query;
      }
      return {
        insert: () => {
          insertStarts += 1;
          return new Promise<{ error: null }>((resolve) => {
            resolveInserts.push(() => resolve({ error: null }));
          });
        },
      };
    },
  };
  const pending = recordVoiceTurns(supabase, {
    conversationId: "conversation",
    organizationId: "organization",
    callId: "call",
    turnIdentity: "turn",
    source: "controller",
    turns: [
      { role: "user", content: "bounded user turn" },
      { role: "assistant", content: "bounded assistant reply" },
    ],
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertEquals(insertStarts, 2);
  resolveInserts.forEach((resolve) => resolve());
  assertEquals(await pending, {
    written: 2,
    duplicates: 0,
    failed: 0,
  });
});

function replayReadSupabase(args: {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  claims?: Array<Record<string, unknown>>;
}) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const matching = () => {
        const rows = table === "chat_conversations"
          ? args.conversations
          : table === "voice_turn_claims"
          ? args.claims ?? []
          : args.messages;
        return rows.filter((row) =>
          filters.every(([column, value]) => {
            const metadataKey = column.match(/^ai_metadata->>(.+)$/)?.[1];
            const actual = metadataKey
              ? (row.ai_metadata as Record<string, unknown> | undefined)?.[
                metadataKey
              ]
              : row[column];
            return metadataKey
              ? String(actual) === String(value)
              : actual === value;
          })
        );
      };
      let orderColumn: string | null = null;
      let orderAscending = true;
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        order(column: string, options: { ascending?: boolean } = {}) {
          orderColumn = column;
          orderAscending = options.ascending !== false;
          return query;
        },
        limit(count: number) {
          const rows = [...matching()];
          if (orderColumn) {
            rows.sort((left, right) => {
              const a = Number(left[orderColumn!]);
              const b = Number(right[orderColumn!]);
              return orderAscending ? a - b : b - a;
            });
          }
          return Promise.resolve({
            data: rows.slice(0, count),
            error: null,
          });
        },
        maybeSingle() {
          const rows = matching();
          return Promise.resolve({
            data: rows.length === 1 ? rows[0] : null,
            error: rows.length > 1 ? { code: "multiple_rows" } : null,
          });
        },
      };
      return query;
    },
  };
}

Deno.test("completed duplicate replays the canonical reply without rerunning work", async () => {
  let controllerAttempts = 0;
  let externalActionAttempts = 0;
  let reads = 0;
  let authorityChecks = 0;

  const runOriginal = () => {
    controllerAttempts += 1;
    externalActionAttempts += 1;
  };
  // The first request completed its one controller/provider pass before its
  // response stream was interrupted.
  runOriginal();

  const replay = await resolveCompletedVoiceTurnReplay({
    readReply: () => {
      reads += 1;
      return Promise.resolve({
        status: "found",
        spoken: "The quote is ready.",
      });
    },
    isAuthoritative: () => {
      authorityChecks += 1;
      return Promise.resolve(true);
    },
  });

  assertEquals(replay, { status: "replay", spoken: "The quote is ready." });
  assertEquals(reads, 1);
  assertEquals(authorityChecks, 1);
  assertEquals(controllerAttempts, 1);
  assertEquals(externalActionAttempts, 1);
});

Deno.test("interrupted-response stale claims enter only the exact completed-replay gate", () => {
  assertEquals(mayReplayCompletedVoiceTurnClaim("duplicate"), true);
  assertEquals(mayReplayCompletedVoiceTurnClaim("stale"), true);
  assertEquals(mayReplayCompletedVoiceTurnClaim("acquired"), false);
  assertEquals(mayReplayCompletedVoiceTurnClaim("wait"), false);
  assertEquals(mayReplayCompletedVoiceTurnClaim("uncertain"), false);
});

Deno.test("stale retry replays durable speech without rerunning controller or SMS", async () => {
  const controllerAttempts = 1;
  const smsAttempts = 1;
  const claim = "stale" as const;
  const replay = mayReplayCompletedVoiceTurnClaim(claim)
    ? await resolveCompletedVoiceTurnReplay({
      readReply: () =>
        Promise.resolve({
          status: "found" as const,
          spoken: "I have your number. What full name should I use?",
        }),
      isAuthoritative: () => Promise.resolve(true),
    })
    : { status: "suppressed" as const };

  assertEquals(replay, {
    status: "replay",
    spoken: "I have your number. What full name should I use?",
  });
  assertEquals(controllerAttempts, 1);
  assertEquals(smsAttempts, 1);
});

Deno.test("completed duplicate fails closed when the journal is unavailable", async () => {
  let authorityChecks = 0;
  const replay = await resolveCompletedVoiceTurnReplay({
    readReply: () =>
      Promise.resolve({ status: "unavailable", reason: "reply_missing" }),
    isAuthoritative: () => {
      authorityChecks += 1;
      return Promise.resolve(true);
    },
  });

  assertEquals(replay, {
    status: "suppressed",
    reason: "reply_unavailable",
    detail: "reply_missing",
  });
  assertEquals(authorityChecks, 0);
});

Deno.test("completed duplicate fails closed when authority changed", async () => {
  const replay = await resolveCompletedVoiceTurnReplay({
    readReply: () =>
      Promise.resolve({ status: "found", spoken: "Do not replay this." }),
    isAuthoritative: () => Promise.resolve(false),
  });

  assertEquals(replay, {
    status: "suppressed",
    reason: "turn_not_authoritative",
  });
});

Deno.test("in-progress retry waits only for the exact durable completed reply", async () => {
  let reads = 0;
  let authorityChecks = 0;
  const delays: number[] = [];
  const replay = await waitForCompletedVoiceTurnReplay({
    readReply: () => {
      reads += 1;
      return Promise.resolve(
        reads < 3
          ? { status: "unavailable" as const, reason: "reply_missing" }
          : {
            status: "found" as const,
            spoken: "What full name should I use?",
          },
      );
    },
    isAuthoritative: () => {
      authorityChecks += 1;
      return Promise.resolve(true);
    },
    delay: (milliseconds) => {
      delays.push(milliseconds);
      return Promise.resolve();
    },
  }, { maxAttempts: 4, intervalMs: 75 });

  assertEquals(replay, {
    status: "replay",
    spoken: "What full name should I use?",
  });
  assertEquals(reads, 3);
  assertEquals(authorityChecks, 1);
  assertEquals(delays, [75, 75]);
});

Deno.test("in-progress retry fails immediately on lineage mismatch", async () => {
  let delays = 0;
  const replay = await waitForCompletedVoiceTurnReplay({
    readReply: () =>
      Promise.resolve({
        status: "unavailable",
        reason: "reply_lineage_mismatch",
      }),
    isAuthoritative: () => Promise.resolve(true),
    delay: () => {
      delays += 1;
      return Promise.resolve();
    },
  });
  assertEquals(replay, {
    status: "suppressed",
    reason: "reply_unavailable",
    detail: "reply_lineage_mismatch",
  });
  assertEquals(delays, 0);
});

Deno.test("in-progress retry exhausts its bounded wait and stays suppressed", async () => {
  let reads = 0;
  let delays = 0;
  const replay = await waitForCompletedVoiceTurnReplay({
    readReply: () => {
      reads += 1;
      return Promise.resolve({
        status: "unavailable",
        reason: "reply_missing",
      });
    },
    isAuthoritative: () => Promise.resolve(true),
    delay: () => {
      delays += 1;
      return Promise.resolve();
    },
  }, { maxAttempts: 3, intervalMs: 25 });
  assertEquals(replay, {
    status: "suppressed",
    reason: "reply_unavailable",
    detail: "reply_missing",
  });
  assertEquals(reads, 3);
  assertEquals(delays, 2);
});

Deno.test("measured wait window reaches a late exact reply without rerunning work", async () => {
  let reads = 0;
  let delays = 0;
  const replay = await waitForCompletedVoiceTurnReplay({
    readReply: () => {
      reads += 1;
      return Promise.resolve(
        reads < 28
          ? { status: "unavailable" as const, reason: "reply_missing" }
          : {
            status: "found" as const,
            spoken: "What is the complete service address?",
          },
      );
    },
    isAuthoritative: () => Promise.resolve(true),
    delay: () => {
      delays += 1;
      return Promise.resolve();
    },
  });
  assertEquals(replay, {
    status: "replay",
    spoken: "What is the complete service address?",
  });
  assertEquals(reads, 28);
  assertEquals(delays, 27);
});

Deno.test("journal replay requires exact tenant and single-flight lineage", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const conversationId = "22222222-2222-4222-8222-222222222222";
  const sessionToken = "33333333-3333-4333-8333-333333333333";
  const turnId = "44444444-4444-4444-8444-444444444444";
  const messages = [
    { role: "system", content: "bounded system context" },
    { role: "user", content: "Please text the quote." },
  ];
  const turnIdentity = await buildControllerTurnJournalIdentity({
    callId: sessionToken,
    messages,
  });
  const rows = await buildIdempotentTurnRows({
    conversationId,
    callId: sessionToken,
    turnIdentity,
    source: "controller",
    turnId,
    turnPosition: 2,
    contentHash: "exact-content-hash",
    turns: [
      { role: "user", content: "Please text the quote." },
      { role: "assistant", content: "I have the written quote ready." },
    ],
  });
  const supabase = replayReadSupabase({
    conversations: [{
      id: conversationId,
      organization_id: organizationId,
      session_token: sessionToken,
      channel: "voice",
    }],
    messages: rows,
  });

  assertEquals(
    await readReplayableControllerReply(supabase, {
      organizationId,
      sessionToken,
      turnId,
      turnPosition: 2,
      contentHash: "exact-content-hash",
      messages,
    }),
    { status: "found", spoken: "I have the written quote ready." },
  );
  assertEquals(
    await readReplayableControllerReply(supabase, {
      organizationId,
      sessionToken,
      turnId,
      turnPosition: 2,
      contentHash: "changed-content-hash",
      messages,
    }),
    { status: "unavailable", reason: "reply_lineage_mismatch" },
  );
  assertEquals(
    await readReplayableControllerReply(supabase, {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionToken,
      turnId,
      turnPosition: 2,
      contentHash: "exact-content-hash",
      messages,
    }),
    { status: "unavailable", reason: "conversation_unavailable" },
  );
});

Deno.test("stale fallback reads only the latest completed same-tenant same-call reply", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const otherOrganizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const conversationId = "22222222-2222-4222-8222-222222222222";
  const callId = "33333333-3333-4333-8333-333333333333";
  const sessionToken = `vapi_call:${callId}`;
  const latestTurnId = "55555555-5555-4555-8555-555555555555";
  const priorTurnId = "44444444-4444-4444-8444-444444444444";
  const latestHash = "b".repeat(64);
  const priorHash = "a".repeat(64);
  const latestMetadata = {
    channel: "voice",
    source: "controller",
    provider_call_id: sessionToken,
    turn_id: latestTurnId,
    turn_position: 16,
    content_hash: latestHash,
  };
  const supabase = replayReadSupabase({
    conversations: [{
      id: conversationId,
      organization_id: organizationId,
      session_token: sessionToken,
      channel: "voice",
    }],
    claims: [
      {
        organization_id: organizationId,
        call_id: callId,
        turn_id: priorTurnId,
        position: 15,
        content_hash: priorHash,
        status: "completed",
      },
      {
        organization_id: organizationId,
        call_id: callId,
        turn_id: latestTurnId,
        position: 16,
        content_hash: latestHash,
        status: "completed",
      },
      {
        organization_id: otherOrganizationId,
        call_id: callId,
        turn_id: "66666666-6666-4666-8666-666666666666",
        position: 99,
        content_hash: "c".repeat(64),
        status: "completed",
      },
    ],
    messages: [
      {
        conversation_id: conversationId,
        role: "assistant",
        content: "This prior reply must not win.",
        ai_metadata: {
          ...latestMetadata,
          turn_id: priorTurnId,
          turn_position: 15,
          content_hash: priorHash,
        },
      },
      {
        conversation_id: conversationId,
        role: "assistant",
        content: "I kept your quote for manual review.",
        ai_metadata: latestMetadata,
      },
      {
        conversation_id: conversationId,
        role: "assistant",
        content: "Cross-tenant content must be invisible.",
        ai_metadata: {
          ...latestMetadata,
          provider_call_id: "different-call",
        },
      },
    ],
  });

  assertEquals(
    await readLatestReplayableControllerReply(supabase, {
      organizationId,
      callId,
      sessionToken,
    }),
    {
      status: "found",
      spoken: "I kept your quote for manual review.",
      authoritativeTurnId: latestTurnId,
    },
  );
  assertEquals(
    await readLatestReplayableControllerReply(supabase, {
      organizationId: otherOrganizationId,
      callId,
      sessionToken,
    }),
    { status: "unavailable", reason: "conversation_unavailable" },
  );
});

Deno.test("latest stale fallback rechecks authority for the returned turn and reruns no work", async () => {
  const latestTurnId = "55555555-5555-4555-8555-555555555555";
  const checked: Array<string | undefined> = [];
  const controllerAttempts = 1;
  const providerAttempts = 1;
  const replay = await resolveCompletedVoiceTurnReplay({
    readReply: () =>
      Promise.resolve({
        status: "found",
        spoken: "The durable terminal reply.",
        authoritativeTurnId: latestTurnId,
      }),
    isAuthoritative: (turnId) => {
      checked.push(turnId);
      return Promise.resolve(turnId === latestTurnId);
    },
  });
  assertEquals(replay, {
    status: "replay",
    spoken: "The durable terminal reply.",
  });
  assertEquals(checked, [latestTurnId]);
  assertEquals(controllerAttempts, 1);
  assertEquals(providerAttempts, 1);
});
