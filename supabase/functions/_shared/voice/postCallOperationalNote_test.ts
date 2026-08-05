// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  persistPostCallOperationalNote,
  POST_CALL_NOTE_MAX_CHARS,
  POST_CALL_SPECIAL_REQUEST_MAX_CHARS,
} from "./postCallOperationalNote.ts";

const ORG = "00000000-0000-4000-8000-000000000072";
const OTHER_ORG = "00000000-0000-4000-8000-000000000099";
const CALL = "call_phase8_synthetic";
const CONVERSATION = "68c7961b-d2c7-5036-a8b1-7f85ac8177bf";
const SESSION = "00000000-0000-4000-8000-000000000073";

function payload() {
  return {
    message: {
      type: "end-of-call-report",
      call: { id: CALL },
      artifact: { transcript: "this transcript must never be summarized" },
    },
  };
}

function fakeSupabase(overrides: {
  organizationId?: string;
  notes?: string[];
  deliveryStatus?: string;
  quoteStatus?: string;
} = {}) {
  const organizationId = overrides.organizationId ?? ORG;
  const conversations = [{
    id: CONVERSATION,
    organization_id: organizationId,
    session_token: `vapi_call:${CALL}`,
    channel: "voice",
    quote_session_id: SESSION,
    booking_status: "none",
    facts: {
      services: ["window_cleaning"],
      quote: { status: "firm", firm: true, total: 999999 },
      serviceArea: { status: "pending_confirmation" },
    },
    created_at: "2026-08-01T00:00:00.000Z",
  }];
  const quoteSessions = [{
    id: SESSION,
    organization_id: organizationId,
    quote_status: overrides.quoteStatus ?? "firm",
    fields: {
      services: ["window_cleaning", "gutter_cleaning"],
      serviceAreaStatus: "pending_confirmation",
      voiceJourney: {
        intent: "new_quote",
        requestedNextStep: "text_quote",
        volunteeredNotes: overrides.notes ?? ["Please text before arrival."],
        quoteContext: {
          finalQuoteDisposition: "firm",
          estimatedTotal: 216.5,
        },
        delivery: overrides.deliveryStatus
          ? { channel: "sms", status: overrides.deliveryStatus }
          : undefined,
      },
    },
  }];
  const messages: any[] = [];
  const mutations: string[] = [];
  const api: any = {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let inserted: any = null;
      const source = () =>
        table === "chat_conversations"
          ? conversations
          : table === "quote_sessions"
          ? quoteSessions
          : messages;
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
          inserted = structuredClone(row);
          if (table !== "chat_messages") mutations.push(table);
          return this;
        },
        update() {
          mutations.push(table);
          return this;
        },
        maybeSingle() {
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
    _conversations: conversations,
    _quoteSessions: quoteSessions,
    _messages: messages,
    _mutations: mutations,
  };
  return api;
}

Deno.test("phase8 duplicate final events create one local note and zero provider memos", async () => {
  const supabase = fakeSupabase();
  const first = await persistPostCallOperationalNote(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  const replay = await persistPostCallOperationalNote(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(first.status, "persisted");
  assertEquals(replay.status, "duplicate");
  assertEquals(first.noteId, replay.noteId);
  assertEquals(supabase._messages.length, 1);
  assertEquals(first.providerMemoStatus, "disabled");
  assertEquals(replay.providerMemoStatus, "disabled");
});

Deno.test("phase8 note sanitizes and bounds free text without transcript or raw identifiers", async () => {
  const long =
    `Please use the gate. token=secret-value-123456 email@example.com +1 (469) 215-0144 provider_id=provider_abcdef 5612 Binbranch Lane 68c7961b-d2c7-5036-a8b1-7f85ac8177bf ${
      "x".repeat(600)
    }`;
  const supabase = fakeSupabase({ notes: [long, long, long, long] });
  const result = await persistPostCallOperationalNote(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(result.status, "persisted");
  const row = supabase._messages[0];
  assert(row.content.length <= POST_CALL_NOTE_MAX_CHARS);
  assert(!row.content.includes("secret-value"));
  assert(!row.content.includes("email@example.com"));
  assert(!row.content.includes("469) 215"));
  assert(!row.content.includes("provider_abcdef"));
  assert(!row.content.includes("5612 Binbranch Lane"));
  assert(!row.content.includes("68c7961b-d2c7-5036-a8b1-7f85ac8177bf"));
  assert(!row.content.includes("this transcript must never be summarized"));
  assertEquals(row.ai_metadata.operational_summary.specialRequests.length, 3);
  assert(
    row.ai_metadata.operational_summary.specialRequests.every(
      (note: string) => note.length <= POST_CALL_SPECIAL_REQUEST_MAX_CHARS,
    ),
  );
  assertEquals(row.ai_metadata.provider_call_id, undefined);
});

Deno.test("phase8 cross-tenant conversation and quote-session lineage fail closed", async () => {
  const crossTenant = fakeSupabase({ organizationId: OTHER_ORG });
  const result = await persistPostCallOperationalNote(crossTenant, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(result.status, "error");
  assertEquals(result.reason, "conversation_authority_mismatch");
  assertEquals(crossTenant._messages.length, 0);
});

Deno.test("phase8 local note leaves canonical pricing, services, address and booking state immutable", async () => {
  const supabase = fakeSupabase();
  const beforeConversation = structuredClone(supabase._conversations);
  const beforeSessions = structuredClone(supabase._quoteSessions);
  const result = await persistPostCallOperationalNote(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(result.status, "persisted");
  assertEquals(supabase._conversations, beforeConversation);
  assertEquals(supabase._quoteSessions, beforeSessions);
  assertEquals(supabase._mutations, []);
  const summary = supabase._messages[0].ai_metadata.operational_summary;
  assertEquals(summary.authoritativeTotal, 216.5);
  assertEquals(summary.services, ["gutter_cleaning", "window_cleaning"]);
  assertEquals(supabase._messages[0].ai_metadata.pricing_authority, false);
  assertEquals(supabase._messages[0].ai_metadata.address_authority, false);
  assertEquals(supabase._messages[0].ai_metadata.booking_authority, false);
});

Deno.test("phase8 uncertain delivery remains uncertain and is never called a completed Jobber memo", async () => {
  const supabase = fakeSupabase({ deliveryStatus: "uncertain" });
  const result = await persistPostCallOperationalNote(supabase, {
    body: payload(),
    organizationId: ORG,
  });
  assertEquals(result.status, "persisted");
  const row = supabase._messages[0];
  assertEquals(
    row.ai_metadata.operational_summary.requestedAction,
    "quote_delivery_uncertain",
  );
  assertEquals(
    row.ai_metadata.operational_summary.unresolvedItem,
    "quote_delivery_uncertain",
  );
  assertEquals(row.ai_metadata.provider_memo_status, "disabled");
  assert(
    row.content.includes(
      "Provider memo: disabled; local operational note only.",
    ),
  );
  assert(
    !/jobber memo:\s*(?:complete|completed|sent|success)/i.test(row.content),
  );
});
