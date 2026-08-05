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
  classifyContextualVoiceScheduleRejection,
  classifyContextualVoiceScheduleRequest,
  persistControllerPatch,
  runControllerTurn as runControllerTurnBase,
} from "./workflowController.ts";
import { type QuoteSessionFields, sessionInputsKey } from "../quoteSession.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "../publicBookingServiceArea.ts";
import { PRICE_ASSURANCE } from "../voice/voiceJourneyContract.ts";

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
  discountRows?: readonly Row[];
  discountError?: unknown;
} = {}) {
  let writeVersion = 0;
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
    discountReads: 0,
    discountWrites: 0,
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
          if (this._table === "discount_codes") state.discountWrites += 1;
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
          if (table === "discount_codes") state.discountWrites += 1;
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
              writeVersion += 1;
              next.updated_at = `2026-08-01T12:00:${
                String(writeVersion).padStart(2, "0")
              }.000Z`;
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
          if (this._table === "discount_codes") {
            state.discountReads += 1;
            if (opts.discountError) {
              return Promise.resolve({ data: null, error: opts.discountError });
            }
            const rows = (opts.discountRows ?? []).filter((row) =>
              Object.entries(this._filter).every(([key, value]) => row[key] === value)
            );
            return Promise.resolve({ data: rows, error: null });
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


const PROMO_PRICING_ROWS: Row[] = [
  ...PRICING_ROWS,
  {
    config_key: "window_promo_99",
    config_value: {
      active: true,
      promoId: "PROMO_99_WINDOWS",
      version: 1,
      flatPrice: 99,
      maxWindows: 10,
      effectiveStart: null,
      effectiveEnd: null,
      prepInstructions: "Please have the selected windows accessible.",
      stackingPolicy: "none",
    },
  },
];

const VALID_DISCOUNTS: Row[] = [
  {
    code: "SAVE10",
    discount_type: "percentage",
    discount_value: 10,
    is_active: true,
    expires_at: "2026-08-06T00:00:00.000Z",
    usage_count: 0,
    max_uses: null,
  },
  {
    code: "FIVE",
    discount_type: "fixed",
    discount_value: 5,
    is_active: true,
    expires_at: null,
    usage_count: 0,
    max_uses: null,
  },
];

function setFirmWindowSession(sb: any, requestedNextStep: "none" | "text_quote" | "schedule" = "none") {
  sb._state.session.quote_status = "firm";
  sb._state.session.fields = {
    voiceJourney: {
      intent: "new_quote",
      requestedNextStep,
      quoteContext: { inputsKey: "firm-before" },
      delivery: null,
      availability: null,
      booking: { status: "not_started" },
    },
    services: ["window_cleaning"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    squareFootage: 2000,
    stories: 1,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
    lastQuoteResult: {
      status: "firm",
      finalQuoteDisposition: "firm",
      estimatedTotal: 200.26,
      total: 185,
      discount: null,
      inputsKey: "firm-before",
    },
  };
}

Deno.test("phase3 schedule classifiers are clause-local, note-safe, and rejection-safe", () => {
  for (
    const utterance of [
      "Continue toward scheduling",
      "Please continue toward scheduling; text me before arrival because the dog is behind the gate",
      "Let's schedule an appointment, and please park outside the gate",
      "Please check current availability; the crew should use the side gate",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceScheduleRequest(utterance),
      true,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceScheduleRejection(utterance),
      false,
      utterance,
    );
  }

  for (
    const utterance of [
      "Don't schedule anything",
      "Do not continue toward scheduling",
      "I'm not ready to schedule",
      "I don't want an appointment",
      "Please do not check availability",
      "Schedule it later, not now",
      "Never mind, stop scheduling",
      "I’d rather not book an appointment",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceScheduleRejection(utterance),
      true,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceScheduleRequest(utterance),
      false,
      utterance,
    );
  }

  for (
    const operationalOnly of [
      "Text me before arrival",
      "The dog is behind the gate",
      "Please park outside",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceScheduleRequest(operationalOnly),
      false,
      operationalOnly,
    );
  }
});

Deno.test("caller-ID confirmation: captures contact phone without verifying identity", async () => {
  const sb = makeFake();
  // Contact confirmation belongs after pricing in the express journey.
  sb._state.session.quote_status = "firm";
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote", requestedNextStep: "schedule" },
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
    voiceJourney: { intent: "new_quote", requestedNextStep: "schedule" },
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
      requestedNextStep: "schedule",
      availability: { status: "not_requested" },
      booking: { status: "not_started" },
    },
  };
  sb._state.session.quote_status = "firm";
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
      requestedNextStep: "schedule",
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
  sb._state.session.quote_status = "firm";
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
      requestedNextStep: "schedule",
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
  sb._state.session.quote_status = "firm";
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
      requestedNextStep: "schedule",
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

async function persistAndReload(
  sb: any,
  turn: Awaited<ReturnType<typeof runControllerTurn>>,
) {
  const result = await persistControllerPatch(
    sb,
    turn.sessionId,
    turn.sessionPatch,
  );
  assertEquals(result.status, "persisted");
  return sb._state.session;
}

function completeWindowFields(
  overrides: Partial<QuoteSessionFields> = {},
): QuoteSessionFields {
  return {
    voiceJourney: {
      intent: "new_quote",
      policyVersion: "voice-express-v1",
      requestedNextStep: "none",
    },
    services: ["window_cleaning"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    squareFootage: 2000,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
    ...overrides,
  };
}

async function createFirmWindowQuote(
  overrides: Partial<QuoteSessionFields> = {},
) {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = completeWindowFields(overrides) as Row;
  const priced = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "continue",
    history: [],
  });
  assertEquals(priced.pre.kind, "fsm");
  if (priced.pre.kind === "fsm") {
    assertEquals(priced.pre.action.kind, "speak_price");
  }
  await persistAndReload(sb, priced);
  assertEquals(sb._state.session.quote_status, "firm");
  return sb;
}

Deno.test("phase3 firm quote corrections invalidate stale branches and reprice once without contact", async () => {
  const cases = [
    {
      utterance: "Actually it is 2500 square feet",
      initial: {},
      verify(fields: QuoteSessionFields) {
        assertEquals(fields.squareFootage, 2500);
      },
    },
    {
      utterance: "Actually I need inside and outside",
      initial: {},
      verify(fields: QuoteSessionFields) {
        assertEquals(fields.windowCleaningSides, "inside_and_outside");
      },
    },
    {
      utterance: "Actually no unusual ladder access",
      initial: {
        advancedWindowConditions: true,
        ladderWork: true,
        ladderAffectedWindowEquivalents: 2,
      },
      verify(fields: QuoteSessionFields) {
        assertEquals(fields.ladderWork, false);
        assertEquals(fields.ladderAffectedWindowEquivalents, undefined);
      },
    },
  ] as const;

  for (const correction of cases) {
    const sb = await createFirmWindowQuote(correction.initial);
    const before = sb._state.session.fields as QuoteSessionFields;
    const beforeInputsKey = String(before.lastQuoteResult?.inputsKey ?? "");
    sb._state.session.fields = {
      ...before,
      voiceJourney: {
        ...(before.voiceJourney ?? {}),
        requestedNextStep: "schedule",
        delivery: {
          channel: "sms",
          mode: "actual_quote",
          status: "pending",
        },
        availability: { status: "offered" },
        booking: { status: "confirmation_required" },
      },
    } as Row;
    sb._state.session.last_step = "offered_scheduling";
    const providerCalls: string[] = [];
    const corrected = await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance: correction.utterance,
      history: [],
      runTool: ((name: string) => {
        providerCalls.push(name);
        return Promise.resolve({});
      }) as any,
    });

    assertEquals(corrected.pre.kind, "fsm", correction.utterance);
    if (corrected.pre.kind === "fsm") {
      assertEquals(
        corrected.pre.action.kind,
        "speak_price",
        correction.utterance,
      );
      assertEquals(
        (corrected.pre.spoken.match(/\$[0-9,]+\.\d{2}/g) ?? []).length,
        1,
        correction.utterance,
      );
      assertEquals(
        corrected.pre.spoken.split(PRICE_ASSURANCE).length - 1,
        1,
        correction.utterance,
      );
    }
    const fields = corrected.sessionPatch.fields as QuoteSessionFields;
    correction.verify(fields);
    assertEquals(corrected.sessionPatch.quote_status, "firm");
    assertEquals(fields.voiceJourney?.requestedNextStep, "none");
    assertEquals(fields.voiceJourney?.delivery, null);
    assertEquals(fields.voiceJourney?.availability, null);
    assertEquals(fields.voiceJourney?.booking?.status, "not_started");
    assertEquals(fields.lastQuoteResult?.inputsKey, sessionInputsKey(fields));
    assertEquals(fields.lastQuoteResult?.inputsKey === beforeInputsKey, false);
    assertEquals(fields.name, undefined);
    assertEquals(fields.phone, undefined);
    assertEquals(fields.email, undefined);
    assertEquals(fields.address, undefined);
    assertEquals(providerCalls, []);
  }
});

Deno.test("phase3 unchanged correction does not repeat price or cross a provider boundary", async () => {
  const sb = await createFirmWindowQuote();
  const fields = sb._state.session.fields as QuoteSessionFields;
  sb._state.session.fields = {
    ...fields,
    voiceJourney: {
      ...(fields.voiceJourney ?? {}),
      requestedNextStep: "schedule",
    },
  } as Row;
  sb._state.session.last_step = "offered_scheduling";
  const providerCalls: string[] = [];
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "Actually it is 2000 square feet",
    history: [],
    runTool: ((name: string) => {
      providerCalls.push(name);
      return Promise.resolve({});
    }) as any,
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind, "answer_side_question");
    assertStringIncludes(turn.pre.spoken, "matches the current quote");
    assertEquals(turn.pre.spoken.includes("$"), false);
    assertEquals(turn.pre.spoken.includes(PRICE_ASSURANCE), false);
  }
  assertEquals(providerCalls, []);
});

Deno.test("phase3 explicit price repeat speaks one persisted tax-inclusive total without disclosure", async () => {
  const sb = await createFirmWindowQuote();
  const providerCalls: string[] = [];
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "What was the price again?",
    history: [],
    runTool: ((name: string) => {
      providerCalls.push(name);
      return Promise.resolve({});
    }) as any,
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind, "speak_price");
    assertStringIncludes(turn.pre.spoken, "authoritative tax-inclusive total");
    assertEquals((turn.pre.spoken.match(/\$200\.26/g) ?? []).length, 1);
    assertEquals(turn.pre.spoken.includes(PRICE_ASSURANCE), false);
    assertStringIncludes(turn.pre.spoken, "Would you like the quote texted");
  }
  assertEquals(providerCalls, []);
});

Deno.test("phase3 post-price branch refusals clear authority before availability or booking", async () => {
  for (
    const utterance of [
      "Don't schedule anything",
      "I'm not ready to continue toward scheduling",
      "No thanks",
      "Not right now",
      "I don't want to continue",
    ]
  ) {
    const sb = await createFirmWindowQuote();
    const fields = sb._state.session.fields as QuoteSessionFields;
    sb._state.session.fields = {
      ...fields,
      voiceJourney: {
        ...(fields.voiceJourney ?? {}),
        requestedNextStep: "schedule",
        availability: { status: "not_requested" },
        booking: { status: "not_started" },
      },
    } as Row;
    sb._state.session.last_step = "offered_scheduling";
    const providerCalls: string[] = [];
    const turn = await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance,
      history: [],
      runTool: ((name: string) => {
        providerCalls.push(name);
        return Promise.resolve({});
      }) as any,
    });
    assertEquals(turn.pre.kind, "fsm", utterance);
    if (turn.pre.kind === "fsm") {
      assertEquals(turn.pre.action.kind, "end", utterance);
      assertStringIncludes(turn.pre.spoken, "No appointment was created");
    }
    assertEquals(
      (turn.sessionPatch.fields as QuoteSessionFields).voiceJourney
        ?.requestedNextStep,
      "none",
      utterance,
    );
    assertEquals(providerCalls, [], utterance);
  }

  for (
    const utterance of [
      "Don't text it",
      "I do not want the quote texted",
      "No, do not send that",
    ]
  ) {
    const sb = await createFirmWindowQuote();
    const fields = sb._state.session.fields as QuoteSessionFields;
    sb._state.session.fields = {
      ...fields,
      voiceJourney: {
        ...(fields.voiceJourney ?? {}),
        requestedNextStep: "text_quote",
      },
    } as Row;
    const providerCalls: string[] = [];
    const turn = await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance,
      history: [],
      runTool: ((name: string) => {
        providerCalls.push(name);
        return Promise.resolve({});
      }) as any,
    });
    assertEquals(turn.pre.kind, "fsm", utterance);
    assertEquals(
      (turn.sessionPatch.fields as QuoteSessionFields).voiceJourney
        ?.requestedNextStep,
      "none",
      utterance,
    );
    assertEquals(providerCalls, [], utterance);
  }
});

Deno.test("phase3 schedule choice with inert notes is persisted before any provider call", async () => {
  const sb = await createFirmWindowQuote();
  const providerCalls: string[] = [];
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance:
      "Continue toward scheduling; please text me before arrival because the dog is behind the gate",
    history: [],
    runTool: ((name: string) => {
      providerCalls.push(name);
      return Promise.resolve({});
    }) as any,
  });
  assertEquals(turn.pre.kind, "fsm");
  assertEquals(
    (turn.sessionPatch.fields as QuoteSessionFields).voiceJourney
      ?.requestedNextStep,
    "schedule",
  );
  assertEquals(providerCalls, []);
});

Deno.test("phase3 same-turn schedule choice cannot authorize availability or booking", async () => {
  for (const lastStep of ["offered_scheduling", "confirming_booking"]) {
    const sb = await createFirmWindowQuote();
    const fields = sb._state.session.fields as QuoteSessionFields;
    sb._state.session.fields = {
      ...fields,
      voiceJourney: {
        ...(fields.voiceJourney ?? {}),
        requestedNextStep: "none",
        availability: lastStep === "confirming_booking"
          ? {
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
          }
          : { status: "not_requested" },
        booking: lastStep === "confirming_booking"
          ? { status: "confirmation_required" }
          : { status: "not_started" },
      },
    } as Row;
    sb._state.session.last_step = lastStep;
    const providerCalls: string[] = [];
    const turn = await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance: "Yes, continue toward scheduling",
      history: [],
      runTool: ((name: string) => {
        providerCalls.push(name);
        return Promise.resolve({});
      }) as any,
    });
    assertEquals(turn.pre.kind, "fsm", lastStep);
    assertEquals(providerCalls, [], lastStep);
    assertEquals(
      (turn.sessionPatch.fields as QuoteSessionFields).voiceJourney
        ?.requestedNextStep,
      "schedule",
      lastStep,
    );
  }
});

Deno.test("phase3 direct outside quote skips generic intent and persists sticky new_quote", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote for outside window cleaning",
    history: [],
  });
  assertEquals(turn.pre.kind, "fsm");
  if (turn.pre.kind === "fsm") {
    assertEquals(turn.pre.action.kind, "ask");
    assertEquals((turn.pre.action as any).field, "squareFootage");
  }
  const row = await persistAndReload(sb, turn);
  assertEquals((row.fields as any).voiceJourney.intent, "new_quote");
  assertEquals((row.fields as any).services, ["window_cleaning"]);
  assertEquals((row.fields as any).windowCleaningSides, "outside_only");
});

Deno.test("phase3 asked ladder context stores Two as numeric affected window equivalents", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    services: ["window_cleaning"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    squareFootage: 2000,
    stories: 1,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: true,
    enclosedPatioProfile: "none",
  };
  sb._state.session.field_status = { services: "captured" };
  sb._state.session.last_step = "asked:ladderAffectedWindowEquivalents";
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "Two.",
    history: [],
  });
  const row = await persistAndReload(sb, turn);
  assertEquals((row.fields as any).ladderAffectedWindowEquivalents, 2);
});

Deno.test("phase3 durable retry persists first unclear, terminal second, third does not reask or price", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    services: ["window_cleaning"],
  };
  sb._state.session.last_step = "asked:squareFootage";
  const first = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "not sure",
    history: [],
  });
  let row = await persistAndReload(sb, first);
  assertEquals((row.fields as any).voiceJourney.retryCounts.squareFootage, 1);
  assertEquals(row.quote_status, "none");
  assertEquals(row.last_step, "asked:squareFootage");

  const second = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I don't know",
    history: [],
  });
  row = await persistAndReload(sb, second);
  assertEquals(row.quote_status, "manual_review");
  assertEquals(row.last_step, "manual_review:retry_exhausted:squareFootage");
  assertEquals((row.fields as any).voiceJourney.retryCounts.squareFootage, 1);
  assertEquals((row.fields as any).lastQuoteResult, undefined);
  assertEquals((row.fields as any).voiceJourney.requestedNextStep, "none");
  assertEquals((row.fields as any).voiceJourney.delivery, null);

  let pricingLoads = 0;
  const terminalSnapshot = JSON.stringify(sb._state.session);
  const third = await runControllerTurn({
    supabase: {
      ...sb,
      from(table: string) {
        if (table === "pricing_config") pricingLoads += 1;
        return sb.from(table);
      },
    },
    conversationId: "c1",
    channel: "voice",
    utterance: "2000 square feet",
    history: [],
  });
  assertEquals(third.pre.kind, "fsm");
  if (third.pre.kind === "fsm") {
    assertEquals(third.pre.action.kind, "handoff");
    assertEquals((third.pre.action as any).field, undefined);
  }
  assertEquals(pricingLoads, 0);
  assertEquals(JSON.stringify(sb._state.session), terminalSnapshot);
});

Deno.test("phase3 valid second answer advances without exhausting retry", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    services: ["window_cleaning"],
  };
  sb._state.session.last_step = "asked:squareFootage";
  await persistAndReload(
    sb,
    await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance: "unclear",
      history: [],
    }),
  );
  const second = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "about 2,000 square feet",
    history: [],
  });
  const row = await persistAndReload(sb, second);
  assertEquals((row.fields as any).squareFootage, 2000);
  assertEquals(row.quote_status, "none");
  assertEquals(row.last_step, "asked:windowCleaningSides");
});

Deno.test("phase3 persistence conflict/noop does not spend another retry and duplicate loser composes to count one", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    services: ["window_cleaning"],
  };
  sb._state.session.last_step = "asked:squareFootage";
  const loser = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "unclear",
    history: [],
  });
  sb._state.session.updated_at = "changed-before-loser";
  const conflict = await persistControllerPatch(
    sb,
    loser.sessionId,
    loser.sessionPatch,
  );
  assertEquals(conflict.status, "conflict");
  assertEquals(
    (sb._state.session.fields as any).voiceJourney.retryCounts,
    undefined,
  );
  sb._state.session.updated_at = "2026-08-01T12:00:00.000Z";
  const winner = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "unclear",
    history: [],
  });
  const row = await persistAndReload(sb, winner);
  assertEquals((row.fields as any).voiceJourney.retryCounts.squareFootage, 1);
});

Deno.test("phase3 story-neutral fingerprint for window-only but mixed services remain story-sensitive", () => {
  const windowBase = {
    services: ["windowCleaning"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    squareFootage: 2000,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
    answerProvenance: { stories: "approved_business_default" },
  };
  const one = sessionInputsKey({ ...windowBase, stories: 1 } as any);
  const three = sessionInputsKey(
    {
      ...windowBase,
      stories: 3,
      answerProvenance: { stories: "explicitly_selected" },
    } as any,
  );
  assertEquals(one, three);
  const mixedOne = sessionInputsKey(
    {
      ...windowBase,
      services: ["windowCleaning", "houseWash"],
      stories: 1,
    } as any,
  );
  const mixedThree = sessionInputsKey(
    {
      ...windowBase,
      services: ["windowCleaning", "houseWash"],
      stories: 3,
    } as any,
  );
  assertEquals(mixedOne === mixedThree, false);
});

Deno.test("phase3 conditional modifier budget asks at most one specialty quantity", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = {
    voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    services: ["window_cleaning"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    squareFootage: 2000,
    stories: 1,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: true,
    hardWaterStains: true,
    frenchPanes: false,
    ladderWork: true,
    enclosedPatioProfile: "none",
  };
  const first = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "continue",
    history: [],
  });
  let row = await persistAndReload(sb, first);
  assertEquals(row.last_step, "asked:ladderAffectedWindowEquivalents");
  assertEquals(
    (row.fields as any).voiceJourney.conditionalModifierQuestionAsked,
    "ladderAffectedWindowEquivalents",
  );
  const second = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "two",
    history: [],
  });
  row = await persistAndReload(sb, second);
  assertEquals(row.quote_status, "manual_review");
  assertEquals(
    row.last_step,
    "manual_review:conditional_modifier_budget:hardWaterAffectedWindowEquivalents",
  );
  let pricingLoads = 0;
  const terminalSnapshot = JSON.stringify(sb._state.session);
  const third = await runControllerTurn({
    supabase: {
      ...sb,
      from(table: string) {
        if (table === "pricing_config") pricingLoads += 1;
        return sb.from(table);
      },
    },
    conversationId: "c1",
    channel: "voice",
    utterance: "three ladder windows",
    history: [],
  });
  assertEquals(third.pre.kind, "fsm");
  if (third.pre.kind === "fsm") assertEquals(third.pre.action.kind, "handoff");
  assertEquals(pricingLoads, 0);
  assertEquals(JSON.stringify(sb._state.session), terminalSnapshot);
});

Deno.test("phase3 synthetic behavioral reconstruction 019fc50e-8582-7bb3-9545-2005bbfee183", async () => {
  // Synthetic deterministic behavioral reconstruction only: not original provider logs, no real PII.
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  const trace: string[] = [];
  const turn1 = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance:
      "I need a quote for outside window cleaning about 2,000 square feet and ladder work",
    history: [],
  });
  trace.push(
    turn1.pre.kind === "fsm"
      ? `${turn1.pre.action.kind}:${(turn1.pre.action as any).field ?? ""}`
      : turn1.pre.kind,
  );
  await persistAndReload(sb, turn1);
  assertEquals((sb._state.session.fields as any).services, ["window_cleaning"]);
  assertEquals(
    (sb._state.session.fields as any).windowCleaningScope,
    "whole_home",
  );
  assertEquals(
    (sb._state.session.fields as any).windowCleaningSides,
    "outside_only",
  );
  assertEquals((sb._state.session.fields as any).squareFootage, 2000);
  assertEquals((sb._state.session.fields as any).ladderWork, true);
  assertEquals(
    JSON.stringify(sb._state.session.fields).includes("houseWashWindowBundle"),
    false,
  );
  assertEquals(
    ((sb._state.session.fields as any).services ?? []).includes("house_wash"),
    false,
  );

  const turn2 = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "Two.",
    history: [],
  });
  trace.push(
    turn2.pre.kind === "fsm"
      ? `${turn2.pre.action.kind}:${(turn2.pre.action as any).field ?? ""}`
      : turn2.pre.kind,
  );
  assertEquals(turn2.pre.kind, "fsm");
  if (turn2.pre.kind === "fsm") {
    assertEquals(turn2.pre.action.kind, "speak_price");
  }
  await persistAndReload(sb, turn2);
  assertEquals(
    (sb._state.session.fields as any).ladderAffectedWindowEquivalents,
    2,
  );
  assertEquals(sb._state.session.quote_status, "firm");
  assertEquals(
    (sb._state.session.fields as any).lastQuoteResult?.finalQuoteDisposition,
    "firm",
  );
  assertEquals(
    (sb._state.session.fields as any).lastQuoteResult?.estimatedTotal,
    200.26,
  );
  assertStringIncludes(turn2.pre.spoken, "For all exterior windows");
  assertEquals(
    (`${turn1.pre.spoken} ${turn2.pre.spoken}`.match(/\$[0-9]/g) ?? []).length,
    1,
  );
  assertEquals(turn2.pre.spoken.split(PRICE_ASSURANCE).length - 1, 1);
  assertStringIncludes(turn2.pre.spoken, PRICE_ASSURANCE);
  assertEquals(
    /priceChangingAssumptionConfirmation|recap|summary/i.test(
      trace.join(" ") + turn2.pre.spoken,
    ),
    false,
  );
  assertEquals(/name|phone|address|email/i.test(turn2.pre.spoken), false);
  assertStringIncludes(
    turn2.pre.spoken,
    "Would you like the quote texted, or would you like to continue toward scheduling?",
  );
  assertEquals(
    trace.filter((value) => value === "ask:ladderAffectedWindowEquivalents")
      .length,
    1,
  );
  assertEquals(trace.includes("ask:advancedWindowConditions"), false);
  assertEquals(trace.includes("ask:stories"), false);
});

Deno.test("phase3 price input change clears stale requestedNextStep", async () => {
  const before: QuoteSessionFields = {
    services: ["window_cleaning"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    squareFootage: 2000,
    stories: 1,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
    voiceJourney: {
      intent: "new_quote",
      policyVersion: "voice-express-v1",
      requestedNextStep: "text_quote",
    },
    lastQuoteResult: { status: "firm" },
  };
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  sb._state.session.fields = before as any;
  sb._state.session.quote_status = "firm";
  sb._state.session.last_step = "asked:squareFootage";
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "2500 square feet",
    history: [],
  });
  const row = await persistAndReload(sb, turn);
  assertEquals((row.fields as any).voiceJourney.requestedNextStep, "none");
  assertEquals((row.fields as any).lastQuoteResult?.status, "firm");
  assertEquals(
    (row.fields as any).lastQuoteResult?.inputsKey,
    sessionInputsKey(row.fields as any),
  );
});

Deno.test("phase3 canonical engine totals are story-neutral only for window-only", async () => {
  const totals: number[] = [];
  for (const storyValue of [undefined, 1, 3]) {
    const sb = makeFake({ pricingRows: PRICING_ROWS });
    sb._state.session.fields = {
      voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
      services: ["window_cleaning"],
      customerType: "residential",
      windowCleaningScope: "whole_home",
      windowCleaningSides: "outside_only",
      squareFootage: 2000,
      condition: "maintenance",
      screenProfile: "standard_removable",
      advancedWindowConditions: false,
      hardWaterStains: false,
      frenchPanes: false,
      ladderWork: false,
      enclosedPatioProfile: "none",
      ...(storyValue === undefined ? {} : { stories: storyValue }),
    };
    const turn = await runControllerTurn({
      supabase: sb,
      conversationId: "c1",
      channel: "voice",
      utterance: "continue",
      history: [],
    });
    await persistAndReload(sb, turn);
    assertEquals(sb._state.session.quote_status, "firm");
    totals.push(
      (sb._state.session.fields as any).lastQuoteResult.estimatedTotal,
    );
  }
  assertEquals(totals, [200.26, 200.26, 200.26]);

  const mixed = makeFake({ pricingRows: PRICING_ROWS });
  mixed._state.session.fields = {
    voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    services: ["window_cleaning", "house_wash"],
    customerType: "residential",
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    squareFootage: 2000,
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
  };
  const mixedTurn = await runControllerTurn({
    supabase: mixed,
    conversationId: "c1",
    channel: "voice",
    utterance: "continue",
    history: [],
  });
  assertEquals(mixedTurn.pre.kind, "fsm");
  if (mixedTurn.pre.kind === "fsm") {
    assertEquals(mixedTurn.pre.action.kind, "ask");
    assertEquals((mixedTurn.pre.action as any).field, "stories");
  }
  assertEquals((mixed._state.session.fields as any).stories, undefined);
  assertEquals(
    (mixed._state.session.fields as any).answerProvenance?.stories,
    undefined,
  );
  const withStory = sessionInputsKey({
    ...(mixed._state.session.fields as any),
    stories: 1,
  });
  const withoutStory = sessionInputsKey(mixed._state.session.fields as any);
  assertEquals(withStory === withoutStory, false);
});


Deno.test("phase4 coupons are never requested proactively during express intake", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS });
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote for outside window cleaning",
    history: [],
  });
  assertEquals(turn.pre.kind, "fsm");
  assertEquals(/coupon|promo|discount code/i.test(turn.pre.spoken), false);
  assertEquals((turn.sessionPatch.fields as any).discountCode, undefined);
});

Deno.test("phase4 direct malformed discount separators ask one clarification without valid lookup", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote for outside window cleaning and coupon code is save-10",
    history: [],
  });
  const row = await persistAndReload(sb, turn);
  assertEquals(sb._state.discountReads, 0);
  assertStringIncludes(turn.pre.spoken, "Please spell the discount code once");
  assertEquals((row.fields as any).discountCode, undefined);
  assertEquals((row.fields as any).voiceJourney.retryCounts.discountCode, 1);
  assertEquals((row.fields as any).voiceJourney.coupon.status, "unclear");
});

Deno.test("phase4 asked discount spelling parser accepts letters once and rejects claims", async () => {
  const accepted = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  accepted._state.session.fields = { voiceJourney: { intent: "new_quote" }, services: ["window_cleaning"] };
  accepted._state.session.last_step = "asked:discountCode";
  const acceptedTurn = await runControllerTurn({ supabase: accepted, conversationId: "c1", channel: "voice", utterance: "S A V E 1 0", history: [] });
  let row = await persistAndReload(accepted, acceptedTurn);
  assertEquals((row.fields as any).discountCode, "SAVE10");
  assertEquals((row.fields as any).voiceJourney.coupon.status, "valid");

  const rejected = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  rejected._state.session.fields = { voiceJourney: { intent: "new_quote" }, services: ["window_cleaning"] };
  rejected._state.session.last_step = "asked:discountCode";
  const rejectedTurn = await runControllerTurn({ supabase: rejected, conversationId: "c1", channel: "voice", utterance: "the code gives me ten percent", history: [] });
  row = await persistAndReload(rejected, rejectedTurn);
  assertEquals(rejected._state.discountReads, 0);
  assertEquals((row.fields as any).discountCode, undefined);
  assertEquals((row.fields as any).voiceJourney.coupon.status, "unclear");
  assertEquals((row.fields as any).voiceJourney.coupon.reason, "malformed");
  assertStringIncludes(rejectedTurn.pre.spoken, "Please spell the discount code once");
  assertEquals((row.fields as any).voiceJourney.retryCounts.discountCode, 1);
});

Deno.test("phase4 pre-price valid coupon is normalized captured and later priced authoritatively", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  const turn1 = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote for outside window cleaning and coupon code is save10",
    history: [],
  });
  let row = await persistAndReload(sb, turn1);
  assertStringIncludes(turn1.pre.spoken, "I have that discount code");
  assertStringIncludes(turn1.pre.spoken, "How many square feet is your home?");
  assertEquals((row.fields as any).discountCode, "SAVE10");
  assertEquals((row.fields as any).voiceJourney.coupon.discountValue, 10);
  const turn2 = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "about 2,000 square feet",
    history: [],
  });
  row = await persistAndReload(sb, turn2);
  assertEquals(row.quote_status, "firm");
  assertEquals((row.fields as any).lastQuoteResult.discount.code, "SAVE10");
  assertEquals((row.fields as any).lastQuoteResult.discount.amount > 0, true);
  assertEquals((turn2.pre.spoken.match(/\$[0-9]/g) ?? []).length, 1);
});

Deno.test("phase4 post-price valid coupon causes one canonical repricing and concise updated total", async () => {
  let pricingLoads = 0;
  const base = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(base);
  const sb = {
    ...base,
    from(table: string) {
      if (table === "pricing_config") pricingLoads += 1;
      return base.from(table);
    },
  };
  const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
  const row = await persistAndReload(base, turn);
  // Two reads are expected: one readiness probe plus one authoritative pricing calculation.
  // The single currency token and persisted authoritative discount snapshot prove one customer-facing repricing.
  assertEquals(pricingLoads, 2);
  assertStringIncludes(turn.pre.spoken, "That code is valid. Your updated total is");
  assertEquals((turn.pre.spoken.match(/\$[0-9]/g) ?? []).length, 1);
  assertEquals((row.fields as any).lastQuoteResult.discount.code, "SAVE10");
  assertEquals((row.fields as any).voiceJourney.coupon.authoritativeAmount, (row.fields as any).lastQuoteResult.discount.amount);
});

Deno.test("phase4 generated quote snapshot retains authoritative discount", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(sb);
  const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is five", history: [] });
  const row = await persistAndReload(sb, turn);
  assertEquals((row.fields as any).discountCode, "FIVE");
  assertEquals((row.fields as any).voiceJourney.coupon.discountType, "fixed");
  assertEquals((row.fields as any).lastQuoteResult.discount.code, "FIVE");
  assertEquals((row.fields as any).lastQuoteResult.discount.amount, 5);
});

Deno.test("phase4 invalid inactive expired exhausted and uncertain codes are rejected without changing firm quote", async () => {
  for (const [label, discountRows, expected] of [
    ["unknown", [], "could not find"],
    ["inactive", [{ ...VALID_DISCOUNTS[0], is_active: false }], "not active"],
    ["expired", [{ ...VALID_DISCOUNTS[0], expires_at: "2020-01-01T00:00:00.000Z" }], "expired"],
    ["exhausted", [{ ...VALID_DISCOUNTS[0], usage_count: 1, max_uses: 1 }], "usage limit"],
    ["uncertain", [{ ...VALID_DISCOUNTS[0], discount_value: 101 }], "couldn't safely validate"],
  ] as const) {
    const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows });
    setFirmWindowSession(sb, "text_quote");
    const before = structuredClone(sb._state.session.fields);
    const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
    const row = await persistAndReload(sb, turn);
    assertStringIncludes(turn.pre.spoken, expected);
    assertEquals((row.fields as any).discountCode, undefined);
    assertEquals((row.fields as any).lastQuoteResult, (before as any).lastQuoteResult);
    assertEquals((row.fields as any).voiceJourney.quoteContext, (before as any).voiceJourney.quoteContext);
    assertEquals((row.fields as any).voiceJourney.delivery, (before as any).voiceJourney.delivery);
    assertEquals((row.fields as any).voiceJourney.availability, (before as any).voiceJourney.availability);
    assertEquals((row.fields as any).voiceJourney.booking, (before as any).voiceJourney.booking);
    assertEquals((row.fields as any).voiceJourney.requestedNextStep, "text_quote");
  }
});

Deno.test("phase4 malformed discount code receives one spelling clarification", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  sb._state.session.fields = { voiceJourney: { intent: "new_quote" }, services: ["window_cleaning"] };
  const first = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "my coupon code is dash dash", history: [] });
  let row = await persistAndReload(sb, first);
  assertStringIncludes(first.pre.spoken, "Please spell the discount code once");
  assertEquals((row.fields as any).voiceJourney.retryCounts.discountCode, 1);
  const second = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "still dash dash", history: [] });
  row = await persistAndReload(sb, second);
  assertEquals((row.fields as any).voiceJourney.coupon.status, "invalid");
  assertEquals((row.fields as any).voiceJourney.coupon.reason, "malformed");
});

Deno.test("phase4 duplicate text delivery after discount does not reapply or respeak adjustment", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(sb, "text_quote");
  sb._state.session.fields.discountCode = "SAVE10";
  sb._state.session.fields.voiceJourney.coupon = { code: "SAVE10", status: "valid", discountType: "percentage", discountValue: 10, authoritativeAmount: 18.5 };
  const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
  assertEquals((turn.pre.spoken.match(/updated total|\$[0-9]/g) ?? []).length, 0);
  assertEquals((turn.sessionPatch.fields as any)?.voiceJourney?.delivery?.status, undefined);
});

Deno.test("phase4 promotion path remains distinct and coupon state alone cannot authorize providers", async () => {
  const promo = makeFake({ pricingRows: PROMO_PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  promo._state.session.fields = { voiceJourney: { intent: "new_quote" } };
  promo._state.session.last_step = "asked:services";
  const promoTurn = await runControllerTurn({
    supabase: promo,
    conversationId: "c1",
    channel: "voice",
    utterance: "I want the $99 window special",
    history: [],
  });
  const promoRow = await persistAndReload(promo, promoTurn);
  assertEquals((promoRow.fields as any).promotionId, "PROMO_99_WINDOWS");
  assertEquals((promoRow.fields as any).discountCode, undefined);

  const couponOnly = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(couponOnly, "none");
  const turn = await runControllerTurn({ supabase: couponOnly, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
  const row = await persistAndReload(couponOnly, turn);
  assertEquals((row.fields as any).voiceJourney.requestedNextStep, "none");
  assertEquals((row.fields as any).voiceJourney.delivery, null);
  assertEquals((row.fields as any).voiceJourney.availability, null);
  assertEquals((row.fields as any).voiceJourney.booking.status, "not_started");
});

Deno.test("phase4 non-DFW voice coupon fails closed without discount lookup or provider state changes", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(sb, "schedule");
  sb._state.session.organization_id = "org_oregon";
  sb._state.convo.organization_id = "org_oregon";
  const before = structuredClone(sb._state.session.fields);
  const turn = await runControllerTurnBase({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "discount code is save10",
    history: [],
    organizationAuthority: {
      status: "resolved",
      organizationId: "org_oregon",
      source: "resource",
      evidence: ["resource:conversation"],
      sensitiveActionsAllowed: true,
    },
  });
  const row = await persistAndReload(sb, turn);
  assertEquals(sb._state.discountReads, 0);
  assertEquals((row.fields as any).lastQuoteResult, (before as any).lastQuoteResult);
  assertEquals((row.fields as any).voiceJourney.quoteContext, (before as any).voiceJourney.quoteContext);
  assertEquals((row.fields as any).voiceJourney.delivery, (before as any).voiceJourney.delivery);
  assertEquals((row.fields as any).voiceJourney.availability, (before as any).voiceJourney.availability);
  assertEquals((row.fields as any).voiceJourney.booking, (before as any).voiceJourney.booking);
  assertEquals((row.fields as any).voiceJourney.requestedNextStep, "schedule");
  assertStringIncludes(turn.pre.spoken, "cannot apply discount codes for this market yet");
});

Deno.test("phase4 pre-price invalid coupon explains rejection and continues exact intake", async () => {
  const sb = makeFake({ pricingRows: PRICING_ROWS, discountRows: [] });
  const turn = await runControllerTurn({
    supabase: sb,
    conversationId: "c1",
    channel: "voice",
    utterance: "I need a quote for outside window cleaning and coupon code is nope",
    history: [],
  });
  const row = await persistAndReload(sb, turn);
  assertStringIncludes(turn.pre.spoken, "I could not find that discount code");
  assertStringIncludes(turn.pre.spoken, "How many square feet is your home?");
  assertEquals((row.fields as any).discountCode, undefined);
  assertEquals((row.fields as any).voiceJourney.coupon.status, "invalid");
});

Deno.test("phase4 identical already-applied valid coupon is idempotent", async () => {
  let pricingLoads = 0;
  const base = makeFake({ pricingRows: PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(base);
  base._state.session.fields.discountCode = "SAVE10";
  base._state.session.fields.voiceJourney = {
    ...(base._state.session.fields.voiceJourney as any),
    coupon: { code: "SAVE10", status: "valid", discountType: "percentage", discountValue: 10, authoritativeAmount: 18.5 },
  };
  const sb = {
    ...base,
    from(table: string) {
      if (table === "pricing_config") pricingLoads += 1;
      return base.from(table);
    },
  };
  const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
  assertEquals(pricingLoads, 0);
  assertEquals((turn.pre.spoken.match(/\$[0-9]/g) ?? []).length, 0);
  assertStringIncludes(turn.pre.spoken, "already applied");
});

Deno.test("phase4 post-price promotion stacking none refuses coupon with unchanged total", async () => {
  const sb = makeFake({ pricingRows: PROMO_PRICING_ROWS, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(sb);
  sb._state.session.fields = {
    ...sb._state.session.fields,
    voiceJourney: { ...(sb._state.session.fields as any).voiceJourney, quoteContext: { inputsKey: "promo-before" } },
    promotionId: "PROMO_99_WINDOWS",
    windowCount: 10,
    lastQuoteResult: { status: "firm", finalQuoteDisposition: "firm", estimatedTotal: 107.17, total: 99, discount: null, inputsKey: "promo-before" },
  };
  const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
  const row = await persistAndReload(sb, turn);
  assertStringIncludes(turn.pre.spoken, "cannot be combined with this promotion");
  assertStringIncludes(turn.pre.spoken, "Your total remains");
  assertEquals((row.fields as any).lastQuoteResult.discount, null);
  assertEquals((row.fields as any).voiceJourney.coupon.status, "valid");
});

Deno.test("phase4 post-price promotion allow_discount_codes speaks canonical updated total", async () => {
  const allowRows = PROMO_PRICING_ROWS.map((row) => row.config_key === "window_promo_99" ? {
    ...row,
    config_value: { ...(row.config_value as any), stackingPolicy: "allow_discount_codes" },
  } : row);
  const sb = makeFake({ pricingRows: allowRows, discountRows: VALID_DISCOUNTS });
  setFirmWindowSession(sb);
  sb._state.session.fields = {
    ...sb._state.session.fields,
    voiceJourney: { ...(sb._state.session.fields as any).voiceJourney, quoteContext: { inputsKey: "promo-before" } },
    promotionId: "PROMO_99_WINDOWS",
    windowCount: 10,
    lastQuoteResult: { status: "firm", finalQuoteDisposition: "firm", estimatedTotal: 107.17, total: 99, discount: null, inputsKey: "promo-before" },
  };
  const turn = await runControllerTurn({ supabase: sb, conversationId: "c1", channel: "voice", utterance: "coupon code is save10", history: [] });
  const row = await persistAndReload(sb, turn);
  assertStringIncludes(turn.pre.spoken, "That code is valid. Your updated total is");
  assertEquals((row.fields as any).lastQuoteResult.discount.code, "SAVE10");
  assertEquals((row.fields as any).lastQuoteResult.discount.amount, 9.9);
});
