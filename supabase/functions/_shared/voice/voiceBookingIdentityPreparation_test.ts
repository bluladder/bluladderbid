// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { QuoteSession } from "../quoteSession.ts";
import {
  prepareVoiceBookingIdentity,
  voiceIdentityPreparationFacts,
} from "./voiceBookingIdentityPreparation.ts";

type Row = Record<string, any>;
const ORG = "00000000-0000-4000-8000-000000000072";

function readySession(): QuoteSession {
  return {
    id: "00000000-0000-4000-8000-000000000073",
    organizationId: ORG,
    channel: "voice",
    conversationIds: ["00000000-0000-4000-8000-000000000074"],
    fields: {
      name: "Synthetic Caller",
      email: "synthetic.issue72@example.com",
      phone: "+14695550172",
      callerIdConfirmationStatus: "contact_confirmed",
      address: "5612 Binbranch Lane, McKinney, TX 75071",
      addressComponents: {
        house_number: "5612",
        street: "Binbranch Lane",
        city: "McKinney",
        state: "TX",
        postal_code: "75071",
      },
      serviceAreaStatus: "eligible",
      serviceAreaResult: {
        status: "eligible",
        formattedAddress: "5612 Binbranch Lane, McKinney, TX 75071",
      },
    },
    fieldStatus: {
      name: "verified",
      email: "verified",
      phone: "captured",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    requiredRemaining: [],
    quoteStatus: "firm",
    bookingReady: true,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function fakeSupabase(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    customers: [],
    properties: [],
    customer_properties: [],
    quote_sessions: [{
      id: readySession().id,
      organization_id: ORG,
      customer_id: null,
      property_id: null,
    }],
    chat_conversations: [{
      id: readySession().conversationIds[0],
      organization_id: ORG,
      quote_session_id: readySession().id,
      customer_id: null,
      property_id: null,
    }],
    quotes: [],
    ...seed,
  };
  const api: any = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let operation: "read" | "insert" | "update" = "read";
      let inserted: Row | null = null;
      let updatePatch: Row | null = null;
      const run = () => {
        let rows = (tables[table] ?? []).filter((row) =>
          filters.every((filter) => filter(row))
        );
        if (operation === "insert" && inserted) {
          const globalEmailConflict = table === "customers" &&
            (tables.customers ?? []).some((row) =>
              String(row.email).toLowerCase() ===
                String(inserted!.email).toLowerCase()
            );
          const globalAddressConflict = table === "properties" &&
            (tables.properties ?? []).some((row) =>
              row.normalized_address === inserted!.normalized_address
            );
          const idConflict = (tables[table] ?? []).some((row) =>
            row.id === inserted!.id
          );
          if (globalEmailConflict || globalAddressConflict || idConflict) {
            return { data: null, error: { message: "unique_violation" } };
          }
          tables[table] = [...(tables[table] ?? []), inserted];
          rows = [inserted];
        }
        if (operation === "update" && updatePatch) {
          const matched = rows;
          for (const row of matched) Object.assign(row, updatePatch);
          rows = matched;
        }
        return { data: rows, error: null };
      };
      const query: any = {
        select() {
          return this;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return this;
        },
        is(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return this;
        },
        ilike(key: string, value: string) {
          filters.push((row) =>
            String(row[key] ?? "").toLowerCase() === value.toLowerCase()
          );
          return this;
        },
        limit() {
          return this;
        },
        insert(row: Row) {
          operation = "insert";
          inserted = { ...row };
          return this;
        },
        update(row: Row) {
          operation = "update";
          updatePatch = { ...row };
          return this;
        },
        maybeSingle() {
          const result = run();
          return Promise.resolve({
            data: Array.isArray(result.data)
              ? result.data[0] ?? null
              : result.data,
            error: result.error,
          });
        },
        then(resolve: (value: unknown) => void) {
          resolve(run());
        },
      };
      return query;
    },
    _tables: tables,
  };
  return api;
}

Deno.test("identity preparation rejects captured/defaulted facts as confirmation", () => {
  const session = readySession();
  session.fieldStatus.email = "captured";
  assertEquals(voiceIdentityPreparationFacts(session), "email_unconfirmed");
  session.fieldStatus.email = "defaulted";
  assertEquals(voiceIdentityPreparationFacts(session), "email_unconfirmed");
});

Deno.test("new voice caller reaches local identity and authorized property readiness", async () => {
  const supabase = fakeSupabase();
  const result = await prepareVoiceBookingIdentity(supabase, {
    session: readySession(),
    conversationId: readySession().conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(supabase._tables.customers.length, 1);
  assertEquals(supabase._tables.properties.length, 1);
  assertEquals(supabase._tables.customer_properties.length, 1);
  assertEquals(
    supabase._tables.chat_conversations[0].confirmed_email_customer_id,
    result.customerId,
  );
  assertEquals(
    supabase._tables.chat_conversations[0].resolution_method,
    "customer_account",
  );
  assertEquals(
    supabase._tables.quote_sessions[0].property_id,
    result.propertyId,
  );

  const replay = await prepareVoiceBookingIdentity(supabase, {
    session: {
      ...readySession(),
      customerId: result.customerId,
      propertyId: result.propertyId,
    },
    conversationId: readySession().conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(replay.status, "ready");
  assertEquals(supabase._tables.customers.length, 1);
  assertEquals(supabase._tables.properties.length, 1);
  assertEquals(supabase._tables.customer_properties.length, 1);
});

Deno.test("phase7 verified phone candidate is reused only after every booking identity gate", async () => {
  const existingId = "00000000-0000-4000-8000-000000000075";
  const supabase = fakeSupabase({
    customers: [{
      id: existingId,
      organization_id: ORG,
      email: "synthetic.issue72@example.com",
      phone: "+14695550172",
      first_name: "Synthetic",
      last_name: "Caller",
    }],
  });
  const session = readySession();
  session.fields.returningCustomerId = existingId;
  session.fields.returningCustomerResolved = true;
  session.fields.returningCustomerLookupStatus = "verified";
  const result = await prepareVoiceBookingIdentity(supabase, {
    session,
    conversationId: session.conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(result.status, "ready");
  if (result.status === "ready") {
    assertEquals(result.customerId, existingId);
    assertEquals(result.customerCreated, false);
  }
  assertEquals(supabase._tables.customers.length, 1);
});

Deno.test("phase7 phone candidate alone cannot authorize identity or booking lineage", async () => {
  const supabase = fakeSupabase({
    customers: [{
      id: "00000000-0000-4000-8000-000000000075",
      organization_id: ORG,
      email: "synthetic.issue72@example.com",
      phone: "+14695550172",
      first_name: "Synthetic",
      last_name: "Caller",
    }],
  });
  const session = readySession();
  session.fields.returningCustomerCandidateId =
    "00000000-0000-4000-8000-000000000075";
  session.fields.returningCustomerResolved = false;
  session.fields.awaitingDisambiguator = true;
  session.fields.returningCustomerLookupStatus = "candidate";
  session.fieldStatus.email = "unanswered";
  const result = await prepareVoiceBookingIdentity(supabase, {
    session,
    conversationId: session.conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(result, {
    status: "not_ready",
    blocker: "email_unconfirmed",
  });
  assertEquals(supabase._tables.properties.length, 0);
  assertEquals(supabase._tables.customer_properties.length, 0);
  assertEquals(supabase._tables.chat_conversations[0].customer_id, null);
});

Deno.test("cross-tenant global email collision fails opaque and closed", async () => {
  const supabase = fakeSupabase({
    customers: [{
      id: "00000000-0000-4000-8000-000000000099",
      organization_id: "00000000-0000-4000-8000-000000000098",
      email: "synthetic.issue72@example.com",
      phone: "+14695550172",
    }],
  });
  const result = await prepareVoiceBookingIdentity(supabase, {
    session: readySession(),
    conversationId: readySession().conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(result, {
    status: "blocked",
    blocker: "customer_create_conflict",
  });
});

Deno.test("existing cross-customer lineage is never overwritten", async () => {
  const otherCustomer = "00000000-0000-4000-8000-000000000097";
  const supabase = fakeSupabase({
    customers: [{
      id: otherCustomer,
      organization_id: ORG,
      email: "another@example.com",
      phone: "+14695550199",
      first_name: "Another",
      last_name: "Customer",
    }],
    chat_conversations: [{
      id: readySession().conversationIds[0],
      organization_id: ORG,
      quote_session_id: readySession().id,
      customer_id: otherCustomer,
      property_id: null,
    }],
  });
  const result = await prepareVoiceBookingIdentity(supabase, {
    session: readySession(),
    conversationId: readySession().conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(result, {
    status: "blocked",
    blocker: "customer_contact_conflict",
  });
  assertEquals(supabase._tables.customers.length, 1);
  assertEquals(supabase._tables.properties.length, 0);
});

Deno.test("email-only customer match is not accepted as verified identity", async () => {
  const supabase = fakeSupabase({
    customers: [{
      id: "00000000-0000-4000-8000-000000000096",
      organization_id: ORG,
      email: "synthetic.issue72@example.com",
      phone: null,
      first_name: "Synthetic",
      last_name: "Caller",
    }],
  });
  const result = await prepareVoiceBookingIdentity(supabase, {
    session: readySession(),
    conversationId: readySession().conversationIds[0],
    organizationId: ORG,
  });
  assertEquals(result, {
    status: "blocked",
    blocker: "customer_contact_conflict",
  });
  assertEquals(supabase._tables.properties.length, 0);
});

Deno.test("conversation outside the session lineage is rejected before writes", async () => {
  const supabase = fakeSupabase();
  const result = await prepareVoiceBookingIdentity(supabase, {
    session: readySession(),
    conversationId: "00000000-0000-4000-8000-000000000095",
    organizationId: ORG,
  });
  assertEquals(result, {
    status: "blocked",
    blocker: "lineage_persistence_failed",
  });
  assertEquals(supabase._tables.customers.length, 0);
});
