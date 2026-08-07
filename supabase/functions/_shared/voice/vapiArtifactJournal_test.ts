// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeVapiAssistantArtifactContent,
  persistVapiEndOfCallArtifacts,
} from "./vapiArtifactJournal.ts";

const ORG = "00000000-0000-4000-8000-000000000072";
const CALL = "019fc00a-5558-7dda-a6ba-52764207ca2a";
const CONVERSATION = "68c7961b-d2c7-5036-a8b1-7f85ac8177bf";

function fakeSupabase() {
  const conversations = [{
    id: CONVERSATION,
    organization_id: ORG,
    session_token: `vapi_call:${CALL}`,
    channel: "voice",
    created_at: "2026-08-01T00:00:00.000Z",
  }];
  const messages: any[] = [];
  const api: any = {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let inserted: any = null;
      const source = () =>
        table === "chat_conversations" ? conversations : messages;
      const query: any = {
        select() {
          return this;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return this;
        },
        contains(key: string, value: Record<string, unknown>) {
          filters.push((row) =>
            Object.entries(value).every(([nested, expected]) =>
              row[key]?.[nested] === expected
            )
          );
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        insert(row: any) {
          inserted = { ...row };
          return this;
        },
        maybeSingle() {
          if (inserted) {
            if (messages.some((row) => row.id === inserted.id)) {
              return Promise.resolve({
                data: null,
                error: { message: "duplicate" },
              });
            }
            messages.push(inserted);
            return Promise.resolve({ data: inserted, error: null });
          }
          const row =
            source().filter((candidate) =>
              filters.every((filter) => filter(candidate))
            )[0] ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve: (value: unknown) => void) {
          if (inserted) {
            if (messages.some((row) => row.id === inserted.id)) {
              resolve({ data: null, error: { message: "duplicate" } });
            } else {
              messages.push(inserted);
              resolve({ data: inserted, error: null });
            }
            return;
          }
          resolve({
            data: source().filter((candidate) =>
              filters.every((filter) => filter(candidate))
            ),
            error: null,
          });
        },
      };
      return query;
    },
    _messages: messages,
  };
  return api;
}

function payload() {
  return {
    message: {
      type: "end-of-call-report",
      call: { id: CALL },
      artifact: {
        messages: [
          {
            role: "user",
            message:
              "Window cleaning at 5612 Binbranch Lane. token=secret-value-123456",
            timestamp: "2026-08-01T12:00:01.000Z",
          },
          {
            role: "assistant",
            message: "How many stories is the home?",
            timestamp: "2026-08-01T12:00:02.000Z",
          },
        ],
      },
    },
  };
}

Deno.test("end-of-call messages are bounded, sanitized, tenant linked and idempotent", async () => {
  const supabase = fakeSupabase();
  const first = await persistVapiEndOfCallArtifacts(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(first.status, "persisted");
  assertEquals(first.written, 2);
  assertEquals(supabase._messages.length, 2);
  assert(!supabase._messages[0].content.includes("secret-value"));
  assertEquals(supabase._messages[0].conversation_id, CONVERSATION);
  assertEquals(
    supabase._messages[0].ai_metadata.provider_call_id,
    `vapi_call:${CALL}`,
  );
  assert(
    typeof supabase._messages[0].ai_metadata.retention_expires_at === "string",
  );

  const replay = await persistVapiEndOfCallArtifacts(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(replay.status, "duplicate");
  assertEquals(supabase._messages.length, 2);
});

Deno.test("transport acknowledgement is removed before artifact deduplication", async () => {
  assertEquals(
    normalizeVapiAssistantArtifactContent(
      "One moment. <flush /> The quote total is ready.",
    ),
    "The quote total is ready.",
  );
  assertEquals(
    normalizeVapiAssistantArtifactContent("One moment. <flush />"),
    "",
  );

  const supabase = fakeSupabase();
  const live = payload();
  live.message.artifact.messages[1].message = "The quote total is ready.";
  await persistVapiEndOfCallArtifacts(supabase, {
    body: live,
    organizationId: ORG,
  });
  const artifact = payload();
  artifact.message.artifact.messages[1].message =
    "One moment. <flush /> The quote total is ready.";
  const replay = await persistVapiEndOfCallArtifacts(supabase, {
    body: artifact,
    organizationId: ORG,
  });
  assertEquals(replay.status, "duplicate");
  assertEquals(supabase._messages.length, 2);
});

Deno.test("end-of-call artifact lookup fails closed across organizations", async () => {
  const result = await persistVapiEndOfCallArtifacts(fakeSupabase(), {
    body: payload(),
    organizationId: "00000000-0000-4000-8000-000000000099",
  });
  assertEquals(result.status, "error");
  assertEquals(result.reason, "conversation_authority_mismatch");
});

Deno.test("a later expanded report keeps stable source positions", async () => {
  const supabase = fakeSupabase();
  const partial = payload();
  const full = payload();
  full.message.artifact.messages.push({
    role: "user",
    message: "It is two stories.",
    timestamp: "2026-08-01T12:00:03.000Z",
  });

  const first = await persistVapiEndOfCallArtifacts(supabase, {
    body: partial,
    organizationId: ORG,
  });
  assertEquals(first.written, 2);

  const expanded = await persistVapiEndOfCallArtifacts(supabase, {
    body: full,
    organizationId: ORG,
  });
  assertEquals(expanded.written, 1);
  assertEquals(supabase._messages.length, 3);
  assertEquals(
    supabase._messages[2].ai_metadata.provider_message_sequence,
    2,
  );
});
