// Test-only fluent Supabase double for identity/tenant scoping. No network or
// provider calls are made.
// deno-lint-ignore-file no-explicit-any

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFieldTeamMemo,
  loadVerifiedVoiceRecords,
  persistVerifiedFieldTeamMemo,
} from "./voiceExistingRecords.ts";

const ORG_1 = "00000000-0000-4000-8000-000000000001";
const ORG_2 = "00000000-0000-4000-8000-000000000002";

interface FakeState {
  tables: Record<string, Array<Record<string, unknown>>>;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
}

function fakeSupabase(
  tables: FakeState["tables"],
): FakeState & { client: any } {
  const state: FakeState = { tables, updates: [] };
  const query = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (values: Record<string, unknown>) => {
        pendingUpdate = values;
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: state.tables[table]?.[0] ?? null,
          error: null,
        }),
      then: (resolve: (result: unknown) => unknown) => {
        if (pendingUpdate) {
          state.updates.push({ table, values: pendingUpdate });
        }
        return Promise.resolve({
          data: state.tables[table] ?? [],
          error: null,
        }).then(resolve);
      },
    };
    return chain;
  };
  return {
    ...state,
    client: { from: query },
  };
}

function identityRow(customerId = "customer-1") {
  return {
    id: "conversation-1",
    customer_id: customerId,
    confirmed_email_customer_id: null,
    resolution_method: "phone_exact",
    resolution_confidence: "high",
    awaiting_email_disambiguation: false,
  };
}

Deno.test("verified existing records stay customer- and organization-scoped", async () => {
  const sameOrganization = fakeSupabase({
    chat_conversations: [identityRow()],
    quotes: [{
      id: "quote-1",
      customer_id: "customer-1",
      organization_id: ORG_1,
      status: "accepted",
      total: 250,
      updated_at: "2026-08-01T00:00:00Z",
      expires_at: "2026-09-01T00:00:00Z",
      superseded_at: null,
      source_session_id: "session-1",
    }],
    bookings: [{
      id: "booking-1",
      customer_id: "customer-1",
      organization_id: ORG_1,
      reference_number: "B-1",
      status: "confirmed",
      scheduled_start: "2026-08-05T15:00:00Z",
      scheduled_end: "2026-08-05T17:00:00Z",
      duration_minutes: 120,
      quote_id: "quote-1",
      booking_version: 1,
    }],
  });
  const resolved = await loadVerifiedVoiceRecords(sameOrganization.client, {
    conversationId: "conversation-1",
    resolvedOrganizationId: ORG_1,
  });
  assertEquals(resolved.status, "resolved");
  if (resolved.status === "resolved") {
    assertEquals(resolved.customerId, "customer-1");
    assertEquals(resolved.quotes.map((quote) => quote.id), ["quote-1"]);
    assertEquals(resolved.bookings.map((booking) => booking.id), ["booking-1"]);
  }

  const crossOrganization = fakeSupabase({
    chat_conversations: [identityRow()],
    quotes: [{ id: "quote-other", organization_id: ORG_2 }],
    bookings: [],
  });
  const blocked = await loadVerifiedVoiceRecords(crossOrganization.client, {
    conversationId: "conversation-1",
    resolvedOrganizationId: ORG_1,
  });
  assertEquals(blocked.status, "organization_unresolved");
});

Deno.test("field-team memo write requires exact identity and organization", async () => {
  const scoped = fakeSupabase({
    chat_conversations: [identityRow()],
    bookings: [{
      id: "booking-1",
      customer_id: "customer-1",
      organization_id: ORG_1,
      notes: "Existing note",
      booking_version: 2,
    }],
  });
  const memo = buildFieldTeamMemo({
    bookingId: "booking-1",
    customerId: "customer-1",
    text: "Please use the side gate.",
  });
  if (!memo) throw new Error("memo fixture invalid");
  const recorded = await persistVerifiedFieldTeamMemo(scoped.client, {
    conversationId: "conversation-1",
    resolvedOrganizationId: ORG_1,
    memo,
  });
  assertEquals(recorded.status, "recorded");
  assertEquals(scoped.updates.length, 1);
  assertEquals(scoped.updates[0].table, "bookings");
  assertStringIncludes(
    String(scoped.updates[0].values.notes),
    "[Voice memo conversation-1:booking-1] Please use the side gate.",
  );

  const wrongIdentity = fakeSupabase({
    chat_conversations: [identityRow("customer-other")],
    bookings: scoped.tables.bookings,
  });
  const blocked = await persistVerifiedFieldTeamMemo(wrongIdentity.client, {
    conversationId: "conversation-1",
    resolvedOrganizationId: ORG_1,
    memo,
  });
  assertEquals(blocked.status, "identity_mismatch");
  assertEquals(wrongIdentity.updates.length, 0);
});
