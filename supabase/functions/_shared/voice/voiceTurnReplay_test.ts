import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildControllerTurnJournalIdentity,
  buildIdempotentTurnRows,
  readReplayableControllerReply,
} from "./turnJournal.ts";
import { resolveCompletedVoiceTurnReplay } from "./voiceTurnReplay.ts";

function replayReadSupabase(args: {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
}) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const matching = () => {
        const rows = table === "chat_conversations"
          ? args.conversations
          : args.messages;
        return rows.filter((row) =>
          filters.every(([column, value]) => row[column] === value)
        );
      };
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        limit(count: number) {
          return Promise.resolve({
            data: matching().slice(0, count),
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
