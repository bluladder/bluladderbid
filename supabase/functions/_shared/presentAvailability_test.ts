// Phase 4C tests — pure helpers and no-op paths for presentAvailability /
// handleSlotSelectionReply. Full end-to-end lifecycle tests live alongside
// the availability + presentation suites; this file locks down the two
// invariants that are cheapest to verify and easiest to regress:
//   1. Idempotency key changes ONLY when materially-relevant inputs change.
//   2. Slot-selection handler is a strict no-op when no active presentation
//      exists for the conversation.
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  buildPresentationIdempotencyKey,
  formatOptionsMessage,
} from "./presentAvailability.ts";
import { handleSlotSelectionReply } from "./handleSlotSelectionReply.ts";
import type { AvailabilitySlot } from "./availabilityLookup.ts";

const slot = (start: string, end: string): AvailabilitySlot => ({
  slot_id: `s|${start}`,
  start_at: start,
  end_at: end,
  date: start.slice(0, 10),
  timezone: "America/Chicago",
  arrival_window_label: "9–11 AM",
  customer_label: "9–11 AM",
} as AvailabilitySlot);

Deno.test("buildPresentationIdempotencyKey is deterministic and preference-sensitive", () => {
  const base = {
    conversationId: "c1",
    triggeringInboundSmsId: "in-1",
    quoteSessionId: "q1",
    inputsKey: "ik-1",
    pricingVersion: "pv-1",
    preference: { time_of_day: "morning" as const, max_options: 3 },
    slots: [slot("2026-08-01T14:00:00Z", "2026-08-01T16:00:00Z")],
  };
  const k1 = buildPresentationIdempotencyKey(base);
  const k2 = buildPresentationIdempotencyKey(base);
  assertEquals(k1, k2, "identical inputs → identical key");

  const kPref = buildPresentationIdempotencyKey({
    ...base,
    preference: { time_of_day: "afternoon" as const, max_options: 3 },
  });
  assertNotEquals(k1, kPref, "preference change → new key");

  const kSlot = buildPresentationIdempotencyKey({
    ...base,
    slots: [slot("2026-08-02T14:00:00Z", "2026-08-02T16:00:00Z")],
  });
  assertNotEquals(k1, kSlot, "slot signature change → new key");

  const kInputs = buildPresentationIdempotencyKey({ ...base, inputsKey: "ik-2" });
  assertNotEquals(k1, kInputs, "inputs_key change → new key");

  const kInbound = buildPresentationIdempotencyKey({ ...base, triggeringInboundSmsId: "in-2" });
  assertNotEquals(k1, kInbound, "different triggering inbound → new key");
});

Deno.test("formatOptionsMessage renders numbered options from persisted array only", () => {
  const body = formatOptionsMessage({
    options: [
      { ...slot("2026-08-01T14:00:00Z", "2026-08-01T16:00:00Z"), option_number: 1 } as any,
      { ...slot("2026-08-02T18:00:00Z", "2026-08-02T20:00:00Z"), option_number: 2 } as any,
    ],
  });
  assert(body.includes("1)"), "numbered option 1 present");
  assert(body.includes("2)"), "numbered option 2 present");
  assert(body.includes("9–11 AM"), "customer window label present");
  assert(body.toLowerCase().includes("reply with the option number"), "selection instruction present");
});

Deno.test("handleSlotSelectionReply is a strict no-op when no active presentation exists", async () => {
  const spy: any = {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
  const result = await handleSlotSelectionReply(spy, {
    conversationId: "c1",
    phone: "+15125550001",
    inboundSmsId: "in-1",
    inboundText: "1",
  });
  assertEquals(result.handled, false);
  assertEquals(result.action, "no_active_presentation");
});

Deno.test("handleSlotSelectionReply skips when caller flags the inbound as compliance", async () => {
  const spy: any = {
    from: () => {
      throw new Error("MUST_NOT_QUERY_ON_COMPLIANCE");
    },
  };
  const result = await handleSlotSelectionReply(spy, {
    conversationId: "c1",
    phone: "+15125550001",
    inboundSmsId: "in-1",
    inboundText: "STOP",
    isCompliance: true,
  });
  assertEquals(result.handled, false);
});