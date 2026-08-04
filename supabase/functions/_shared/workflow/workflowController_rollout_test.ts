// deno-lint-ignore-file no-explicit-any
// End-to-end sequencing tests for the rollout controller: caller-ID
// handshake, tenant-safe returning-customer deferral, safe fallback, and
// email-after-quote timing. Uses an in-memory fake supabase.

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  persistControllerPatch,
  runControllerTurn as runControllerTurnBase,
} from "./workflowController.ts";
import { type QuoteSessionFields, sessionInputsKey } from "../quoteSession.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "../publicBookingServiceArea.ts";

type Row = Record<string, unknown>;
const TEST_ORGANIZATION_ID = PUBLIC_BOOKING_ORGANIZATION_ID;
const TEST_AUTHORITY = {
  status: "resolved" as const,
  organizationId: TEST_ORGANIZATION_ID,
  source: "resource" as const,
  evidence: ["resource:conversation"],
  sensitiveActionsAllowed: true,
};

function runControllerTurn(
  input: Parameters<typeof runControllerTurnBase>[0],
) {
  return runControllerTurnBase({
    ...input,
    organizationAuthority: input.organizationAuthority ?? TEST_AUTHORITY,
  });
}

function makeFake(opts: {
  customers?: Row[];
  customersThrow?: boolean;
  pricingRows?: Row[];
} = {}) {
  const state = {
    session: {
      id: "qs_1",
      channel: "voice",
      conversation_ids: ["c1"],
      fields: {} as Row,
      field_status: {} as Row,
      required_remaining: [],
      quote_status: "none",
      booking_ready: false,
      organization_id: TEST_ORGANIZATION_ID,
      updated_at: "2026-08-01T12:00:00.000Z",
    } as Row,
    convo: {
      id: "c1",
      quote_session_id: "qs_1",
      session_token: "tok",
      channel: "voice",
      organization_id: TEST_ORGANIZATION_ID,
    } as Row,
    customerReads: 0,
  };
  const sb: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        _filter: {} as Row,
        _in: null as null | [string, unknown[]],
        select() {
          return this;
        },
        eq(k: string, v: unknown) {
          this._filter[k] = v;
          return this;
        },
        is(k: string, v: unknown) {
          this._filter[k] = v;
          return this;
        },
        in(k: string, arr: unknown[]) {
          this._in = [k, arr];
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this._run();
        },
        maybeSingle() {
          const rows = this._run();
          if (rows instanceof Promise) {
            return rows.then((r: any) => ({
              data: r.data?.[0] ?? null,
              error: null,
            }));
          }
          return { data: (rows.data as Row[])?.[0] ?? null, error: null };
        },
        single() {
          const rows = this._run();
          if (rows instanceof Promise) {
            return rows.then((r: any) => ({
              data: r.data?.[0] ?? null,
              error: null,
            }));
          }
          return { data: (rows.data as Row[])?.[0] ?? null, error: null };
        },
        insert(row: Row) {
          if (this._table === "quote_sessions") {
            state.session = { ...state.session, ...row, id: "qs_new" };
            return {
              select() {
                return {
                  single: () =>
                    Promise.resolve({ data: state.session, error: null }),
                };
              },
            };
          }
          if (this._table === "chat_conversations") {
            state.convo = { ...state.convo, ...row };
            return {
              select() {
                return {
                  single: () =>
                    Promise.resolve({ data: state.convo, error: null }),
                };
              },
            };
          }
          return {
            select() {
              return {
                single: () => Promise.resolve({ data: null, error: null }),
              };
            },
          };
        },
        update(patch: Row) {
          const table = this._table;
          const filters: Row = {};
          let applied = false;
          const apply = () => {
            if (applied) return null;
            const current = table === "quote_sessions"
              ? state.session
              : table === "chat_conversations"
              ? state.convo
              : null;
            if (!current) return null;
            for (const [key, value] of Object.entries(filters)) {
              if (current[key] !== value) return null;
            }
            applied = true;
            const next = { ...current, ...patch };
            if (table === "quote_sessions") {
              next.updated_at = "2026-08-01T12:00:01.000Z";
              state.session = next;
            }
            if (table === "chat_conversations") state.convo = next;
            return next;
          };
          const chain = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return this;
            },
            is(key: string, value: unknown) {
              filters[key] = value;
              return this;
            },
            select() {
              return this;
            },
            maybeSingle() {
              const row = apply();
              return Promise.resolve({
                data: row ? { id: row.id } : null,
                error: null,
              });
            },
            then(resolve: (value: unknown) => void) {
              apply();
              resolve({ data: null, error: null });
            },
          };
          return chain;
        },
        _run() {
          if (this._table === "quote_sessions") {
            const matches = Object.entries(this._filter).every(
              ([key, value]) => state.session[key] === value,
            );
            return Promise.resolve({
              data: matches ? [state.session] : [],
              error: null,
            });
          }
          if (this._table === "chat_conversations") {
            const matches = Object.entries(this._filter).every(
              ([key, value]) => state.convo[key] === value,
            );
            return Promise.resolve({
              data: matches ? [state.convo] : [],
              error: null,
            });
          }
          if (this._table === "pricing_config") {
            return Promise.resolve({
              data: opts.pricingRows ?? [],
              error: null,
            });
          }
          if (this._table === "customers") {
            state.customerReads += 1;
            if (opts.customersThrow) throw new Error("db down");
            return Promise.resolve({ data: opts.customers ?? [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        then(
          resolve: (value: unknown) => void,
          reject: (reason: unknown) => void,
        ) {
          return Promise.resolve(this._run()).then(resolve, reject);
        },
      };
      return q;
    },
    rpc(name: string) {
      return Promise.resolve({
        data: name === "current_pricing_version" ? 7 : null,
        error: null,
      });
    },
    _state: state,
  };
  return sb;
}

Deno.test("voice controller rejects missing or blocked authority before any database access", async () => {
  let databaseReads = 0;
  const supabase = {
    from() {
      databaseReads += 1;
      throw new Error("database_must_not_be_reached");
    },
  };
  const base = {
    supabase,
    conversationId: "c1",
    channel: "voice" as const,
    utterance: "I need a quote",
    history: [],
  };

  await assertRejects(
    () => runControllerTurnBase(base),
    Error,
    "voice_organization_authority_required",
  );
  await assertRejects(
    () =>
      runControllerTurnBase({
        ...base,
        organizationAuthority: {
          status: "blocked",
          code: "conflicting_authority",
        },
      }),
    Error,
    "voice_organization_authority_required",
  );
  assertEquals(databaseReads, 0);
});

const PRICING_ROWS: Row[] = [
  {
    config_key: "window_cleaning",
    config_value: {
      exteriorPerSqFt: 0.08,
      interiorPerSqFt: 0.075,
      minimumPrice: 185,
      modifiers: {
        stories: { "1": 0, "2": 12, "3": 18 },
        condition: { heavy: 15, maintenance: 0 },
      },
    },
  },
  {
    config_key: "window_addons",
    config_value: { ladderWork: {}, sunroom: {} },
  },
  {
    config_key: "house_wash",
    config_value: {
      perSqFt: 0.25,
      minimumPrice: 396,
      modifiers: { stories: { "1": 0, "2": 10, "3": 15 } },
      rustStainSurcharge: 15,
    },
  },
  {
    config_key: "gutter_cleaning",
    config_value: {
      perSqFt: 0.08,
      minimumPrice: 200,
      modifiers: { stories: { "1": 0, "2": 10, "3": 12 } },
    },
  },
  {
    config_key: "roof_cleaning",
    config_value: {
      perSqFt: 0.3,
      minimumPrice: 500,
      modifiers: {
        stories: { "1": 0, "2": 10, "3": 15 },
        roofType: {},
        severity: {},
      },
    },
  },
  {
    config_key: "driveway_cleaning",
    config_value: {
      perSqFt: 0.2,
      minimumPrice: 200,
      surfaceMultipliers: { concrete: 1 },
    },
  },
  {
    config_key: "pressure_washing",
    config_value: {
      perSqFt: 0.25,
      minimumPrice: 75,
      surfaceMultipliers: { concrete: 1 },
    },
  },
  {
    config_key: "solar_panel_cleaning",
    config_value: { perPanel: 10, minimumPrice: 100 },
  },
  {
    config_key: "screen_repair",
    config_value: { perScreen: 25, minimumPrice: 75 },
  },
  {
    config_key: "tax_policy",
    config_value: {
      version: "tax-test-v1",
      rate: 0.0825,
      exemptLineItemKeys: [],
      customerLabel: "Estimated tax",
    },
  },
];

Deno.test("caller-ID confirmation: captures contact phone without verifying identity", async () => {
  const sb = makeFake();
  // Contact confirmation belongs after pricing in the express journey.
  sb._state.session.quote_status = "firm";
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote" },
  };
  const turn1 = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "Hi, I want a quote.",
    history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn1.pre.kind, "ask_confirm_caller_id");
  if (turn1.pre.kind === "ask_confirm_caller_id") {
    assertEquals(turn1.pre.last4, "2877");
    assertEquals(turn1.pre.spoken.includes("469747"), false);
  }
  await persistControllerPatch(sb, "qs_1", turn1.sessionPatch);
  // Session must have callerIdConfirmationStatus = pending.
  assertEquals(
    (sb._state.session.fields as any).callerIdConfirmationStatus,
    "pending",
  );

  const turn2 = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "yes that's right",
    history: [],
    callerIdE164: "+14697472877",
  });
  await persistControllerPatch(sb, "qs_1", turn2.sessionPatch);
  assertEquals((sb._state.session.fields as any).phone, "+14697472877");
  assertEquals(
    (sb._state.session.fields as any).callerIdConfirmationStatus,
    "contact_confirmed",
  );
  assertEquals((sb._state.session.field_status as any).phone, "captured");
  assertEquals(
    (sb._state.session.fields as any).returningCustomerId,
    undefined,
  );
});

Deno.test("spoofed ANI cannot disclose or link a returning customer", async () => {
  const sb = makeFake({
    customers: [{ id: "cust_1", first_name: "Alex", phone: "+14697472877" }],
  });
  sb._state.session.fields = {
    callerIdConfirmationStatus: "pending",
    callerIdProposedE164: "+14697472877",
  };
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "yes",
    history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.spoken.includes("Alex"), false);
  }
  assertEquals((turn.sessionPatch.fields as any).name, undefined);
  assertEquals(
    (turn.sessionPatch.fields as any).returningCustomerId,
    undefined,
  );
  assertEquals(sb._state.customerReads, 0);
});

Deno.test("caller-ID declined: asks for preferred mobile number without repeating full number", async () => {
  const sb = makeFake();
  // Pre-set pending state.
  sb._state.session.quote_status = "firm";
  sb._state.session.fields = {
    callerIdConfirmationStatus: "pending",
    callerIdProposedE164: "+14697472877",
    voiceJourney: { intent: "new_quote" },
  };
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "no, use a different one",
    history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "ask_preferred_phone");
  if (turn.pre.kind === "ask_preferred_phone") {
    assertEquals(turn.pre.spoken.includes("2877"), false);
  }
});

Deno.test("tenant boundary prevents phone-only returning-customer lookup", async () => {
  const sb = makeFake({
    customers: [{ id: "cust_1", first_name: "Alex", phone: "+14697472877" }],
  });
  // Simulate confirmed phone already captured.
  sb._state.session.fields = {
    phone: "+14697472877",
    callerIdConfirmationStatus: "confirmed",
  };
  sb._state.session.field_status = { phone: "verified" };
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "hi",
    history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind !== "retrieve_existing_quote", true);
    assertEquals(turn.pre.action.kind !== "retrieve_upcoming_bookings", true);
    assertEquals(turn.pre.spoken.includes("Alex"), false);
  }
  assertEquals(sb._state.customerReads, 0);
});

Deno.test("legacy unscoped identity markers are cleared without customer reads", async () => {
  const sb = makeFake({
    customers: [
      { id: "a", first_name: "A", phone: "+14697472877" },
      { id: "b", first_name: "B", phone: "+14697472877" },
    ],
  });
  sb._state.session.fields = {
    phone: "+14697472877",
    returningCustomerId: "legacy-unscoped-id",
    awaitingDisambiguator: true,
  };
  sb._state.session.field_status = { phone: "verified" };
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "hi",
    history: [],
    callerIdE164: "+14697472877",
  });
  const patched = turn.sessionPatch.fields as QuoteSessionFields;
  assertEquals(patched.returningCustomerId, undefined);
  assertEquals(patched.awaitingDisambiguator, undefined);
  assertEquals(sb._state.customerReads, 0);
});

Deno.test("customer table failures are unreachable before tenant authority", async () => {
  const sb = makeFake({ customersThrow: true });
  sb._state.session.fields = { phone: "+14697472877" };
  sb._state.session.field_status = { phone: "verified" };
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "hi",
    history: [],
    callerIdE164: "+14697472877",
  });
  assertEquals(turn.pre.kind, "fsm");
  assertEquals(sb._state.customerReads, 0);
});

Deno.test("scheduling decline ends without creating an appointment", async () => {
  const sb = makeFake();
  sb._state.session.fields = {
    phone: "+14697472877",
    returningCustomerResolved: true,
    voiceJourney: {
      intent: "schedule",
      availability: { status: "not_requested" },
      booking: { status: "not_started" },
    },
  };
  sb._state.session.field_status = { phone: "verified" };
  sb._state.session.last_step = "offered_scheduling";

  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "No, not yet",
    history: [],
    callerIdE164: "+14697472877",
  });

  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action, {
      kind: "end",
      reason: "scheduling_declined",
    });
    assertEquals(turn.pre.spoken.includes("No appointment was created"), true);
  }
  assertEquals(
    (turn.sessionPatch.fields as any).voiceJourney.booking.status,
    "not_started",
  );
});

Deno.test("slot selection is resolved only against the current offered set", async () => {
  const sb = makeFake();
  sb._state.session.fields = {
    phone: "+14697472877",
    returningCustomerResolved: true,
    address: "100 Main Street",
    lastQuoteResult: { total: 250 },
    voiceJourney: {
      intent: "schedule",
      quoteContext: { estimatedTotal: 250 },
      availability: {
        status: "offered",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        offeredSlotIds: ["slot-1", "slot-2"],
        offeredSlots: [
          {
            slotId: "slot-1",
            startAt: "2026-08-03T09:00:00-05:00",
            endAt: "2026-08-03T11:00:00-05:00",
            label: "Monday from 9 to 11 AM",
            timezone: "America/Chicago",
          },
          {
            slotId: "slot-2",
            startAt: "2026-08-04T13:00:00-05:00",
            endAt: "2026-08-04T15:00:00-05:00",
            label: "Tuesday from 1 to 3 PM",
            timezone: "America/Chicago",
          },
        ],
      },
      booking: { status: "not_started" },
    },
  };
  sb._state.session.field_status = { phone: "verified" };
  sb._state.session.last_step = "awaiting_slot_selection";

  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "option two",
    history: [],
    callerIdE164: "+14697472877",
  });

  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action, {
      kind: "confirm_slot",
      slotId: "slot-2",
      spoken: "Tuesday from 1 to 3 PM",
    });
    assertEquals(turn.pre.spoken.includes("submit that appointment now"), true);
  }
  assertEquals(
    (turn.sessionPatch.fields as any).voiceJourney.availability.selectedSlotId,
    "slot-2",
  );
  assertEquals(
    (turn.sessionPatch.fields as any).voiceJourney.booking.status,
    "confirmation_required",
  );
});

Deno.test("ambiguous booking confirmation cannot reach the booking tool", async () => {
  const sb = makeFake();
  sb._state.session.fields = {
    phone: "+14697472877",
    returningCustomerResolved: true,
    voiceJourney: {
      intent: "schedule",
      availability: {
        status: "offered",
        selectedSlotId: "slot-1",
        offeredSlotIds: ["slot-1"],
        offeredSlots: [{
          slotId: "slot-1",
          startAt: "2026-08-03T09:00:00-05:00",
          endAt: "2026-08-03T11:00:00-05:00",
          label: "Monday from 9 to 11 AM",
          timezone: "America/Chicago",
        }],
      },
      booking: { status: "confirmation_required" },
    },
  };
  sb._state.session.field_status = { phone: "verified" };
  sb._state.session.last_step = "confirming_booking";

  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I think that should work",
    history: [],
    callerIdE164: "+14697472877",
  });

  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind, "confirm_slot");
    assertEquals(
      turn.pre.spoken.includes("No appointment has been created"),
      true,
    );
  }
  assertEquals(
    (turn.sessionPatch.fields as any)?.voiceJourney?.booking?.status,
    undefined,
  );
});

Deno.test("post-price contact answer advances without repeating the price", async () => {
  const sb = makeFake();
  const pricingFields: QuoteSessionFields = {
    services: ["windowCleaning"],
    windowCleaningScope: "whole_home",
    squareFootage: 2000,
    stories: 2,
    windowCleaningSides: "outside_only",
    condition: "maintenance",
    advancedWindowConditions: false,
    screenProfile: "standard_removable",
    enclosedPatioProfile: "none",
    name: "Alex",
    phone: "+14697472877",
    returningCustomerResolved: true,
  };
  const inputsKey = sessionInputsKey(pricingFields);
  sb._state.session.fields = {
    ...pricingFields,
    lastQuoteResult: {
      status: "firm",
      total: 200,
      estimatedTotal: 216.50,
      inputsKey,
      finalQuoteDisposition: "firm",
    },
    voiceJourney: {
      intent: "new_quote",
      quoteContext: {
        inputsKey,
        estimatedTotal: 216.50,
        finalQuoteDisposition: "firm",
        spokenAt: "2026-08-01T12:00:00.000Z",
      },
      booking: { status: "not_started" },
    },
  };
  sb._state.session.field_status = {
    services: "captured",
    squareFootage: "captured",
    stories: "captured",
    windowCleaningSides: "captured",
    condition: "captured",
    name: "captured",
    phone: "captured",
  };
  sb._state.session.quote_status = "firm";
  sb._state.session.last_step = "asked:contact_email";

  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "alex@example.com",
    history: [],
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind, "ask", JSON.stringify(turn.pre));
    if (turn.pre.action.kind === "ask") {
      assertEquals(turn.pre.action.field, "contact_email");
    }
    assertEquals(turn.pre.spoken.includes("alex at example dot com"), true);
    assertEquals(turn.pre.spoken.includes("216"), false);
  }

  // The production controller route persists this patch before accepting the
  // next provider turn. Mirror that transaction boundary in the in-memory
  // scenario so the confirmation applies to the captured email.
  sb._state.session = { ...sb._state.session, ...turn.sessionPatch };

  const confirmed = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "yes",
    history: [],
  });
  assertEquals(confirmed.pre.kind, "fsm");
  if (confirmed.pre.kind === "fsm") {
    assertEquals(
      confirmed.pre.action.kind,
      "ask",
      JSON.stringify(confirmed.pre),
    );
    if (confirmed.pre.action.kind === "ask") {
      assertEquals(confirmed.pre.action.field, "address");
    }
    assertEquals(confirmed.pre.spoken.includes("216"), false);
  }
});

Deno.test("reachable controller speaks the canonical tax-inclusive total with cents", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = {
    services: ["houseWash"],
    squareFootage: 2000,
    stories: 1,
    enclosedPatioProfile: "none",
    name: "Alex",
    phone: "+14697472877",
    returningCustomerResolved: true,
    voiceJourney: { intent: "new_quote" },
  };
  sb._state.session.field_status = {
    services: "captured",
    squareFootage: "captured",
    stories: "captured",
    enclosedPatioProfile: "captured",
    name: "captured",
    phone: "captured",
  };

  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "that's all correct",
    history: [],
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind, "speak_price");
    assertStringIncludes(turn.pre.spoken, "$541.25");
    assertEquals(turn.pre.spoken.includes("$500"), false);
  }
  const patchedFields = turn.sessionPatch.fields as QuoteSessionFields;
  assertEquals(patchedFields.lastQuoteResult?.estimatedTax, 41.25);
  assertEquals(
    patchedFields.voiceJourney?.quoteContext?.spokenAt != null,
    true,
  );
});

Deno.test("mapped organization without an approved pricing capability cannot inherit DFW pricing", async () => {
  const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.organization_id = organizationId;
  sb._state.convo.organization_id = organizationId;
  sb._state.session.fields = {
    services: ["houseWash"],
    squareFootage: 2000,
    stories: 1,
    enclosedPatioProfile: "none",
    name: "Alex",
    phone: "+14697472877",
    returningCustomerResolved: true,
    voiceJourney: { intent: "new_quote" },
  };
  sb._state.session.field_status = {
    services: "captured",
    squareFootage: "captured",
    stories: "captured",
    enclosedPatioProfile: "captured",
    name: "captured",
    phone: "captured",
  };

  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "that's all correct",
    history: [],
    organizationAuthority: {
      status: "resolved",
      organizationId,
      source: "resource",
      evidence: ["provider:vapi_assistant_id"],
      sensitiveActionsAllowed: true,
    },
  });

  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action, {
      kind: "handoff",
      reason: "tenant_authority_required",
    });
    assertStringIncludes(
      turn.pre.spoken,
      "will not calculate or state a price",
    );
  }
  assertEquals(
    (turn.sessionPatch.fields as QuoteSessionFields).lastQuoteResult,
    undefined,
  );
});

Deno.test("tenant-scoped record, appointment, and memo intents fail closed", async () => {
  const cases = [
    ["existing_quote", "yes"],
    ["reschedule", "yes"],
    ["cancel", "yes"],
    ["question_or_memo", "Please tell the crew my gate code"],
  ] as const;
  for (const [intent, utterance] of cases) {
    const sb = makeFake();
    sb._state.session.fields = {
      phone: "+14697472877",
      returningCustomerResolved: true,
      voiceJourney: { intent },
    };
    sb._state.session.field_status = { phone: "captured" };
    const turn = await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance,
      history: [],
    });
    assertEquals(turn.pre.kind, "fsm");
    if (turn.pre.kind === "fsm") {
      assertEquals(turn.pre.action, {
        kind: "handoff",
        reason: "tenant_authority_required",
      });
      assertStringIncludes(turn.pre.spoken, "Nothing was disclosed or changed");
    }
  }
});

Deno.test("resolved tenant authority does not prematurely enable deferred sensitive voice actions", async () => {
  const sb = makeFake();
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  sb._state.session.organization_id = organizationId;
  sb._state.convo.organization_id = organizationId;
  sb._state.session.fields = {
    phone: "+14697472877",
    returningCustomerResolved: true,
    voiceJourney: { intent: "cancel" },
  };
  sb._state.session.field_status = { phone: "captured" };
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "cancel it",
    history: [],
    organizationAuthority: {
      status: "resolved",
      organizationId,
      source: "resource",
      evidence: ["resource:conversation"],
      sensitiveActionsAllowed: true,
    },
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action, {
      kind: "handoff",
      reason: "tenant_authority_required",
    });
    assertStringIncludes(turn.pre.spoken, "Nothing was disclosed or changed");
  }
});

Deno.test("controller persistence rejects an interleaved stale-row update", async () => {
  const sb = makeFake();
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote",
    history: [],
  });
  sb._state.session.updated_at = "2026-08-01T12:00:00.500Z";
  const result = await persistControllerPatch(
    sb,
    turn.sessionId,
    turn.sessionPatch,
  );
  assertEquals(result, {
    status: "conflict",
    reason: "quote_session_changed",
  });
  const persistedFields = sb._state.session.fields as QuoteSessionFields;
  assertEquals(persistedFields.voiceJourney, undefined);
});

Deno.test("an explicit missing session fails instead of falling back to the conversation", async () => {
  const sb = makeFake();
  await assertRejects(
    () =>
      runControllerTurnBase({
        supabase: sb,
        conversationId: "c1",
        sessionId: "qs_missing",
        channel: "voice",
        utterance: "I need a quote",
        history: [],
        organizationAuthority: TEST_AUTHORITY,
      }),
    Error,
    "quote_session_explicit_session_unavailable",
  );
  assertEquals(sb._state.session.id, "qs_1");
});

Deno.test("controller persistence refuses a patch without organization authority", async () => {
  let databaseWrites = 0;
  const result = await persistControllerPatch(
    {
      from() {
        databaseWrites += 1;
        throw new Error("database_must_not_be_reached");
      },
    },
    "qs_1",
    { fields: { services: ["houseWash"] } },
  );
  assertEquals(result, {
    status: "error",
    reason: "organization_authority_required",
  });
  assertEquals(databaseWrites, 0);
});

Deno.test("controller persistence predicates the organization as well as row version", async () => {
  const sb = makeFake();
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  sb._state.session.organization_id = organizationId;
  sb._state.convo.organization_id = organizationId;
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote",
    history: [],
    organizationAuthority: {
      status: "resolved",
      organizationId,
      source: "resource",
      evidence: ["resource:conversation"],
      sensitiveActionsAllowed: true,
    },
  });
  sb._state.session.organization_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const result = await persistControllerPatch(
    sb,
    turn.sessionId,
    turn.sessionPatch,
  );
  assertEquals(result, {
    status: "conflict",
    reason: "quote_session_changed",
  });
});
