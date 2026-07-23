import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSlotSelection, type PresentedOption } from "./slotSelectionParser.ts";

const TZ = "America/Chicago";

// Friday 2026-07-24 → 8-10 AM, 10 AM-12 PM. Monday 2026-07-27 → 1-3 PM.
const OPTIONS: PresentedOption[] = [
  { option_number: 1, slot_id: "slot_a_1", start_at: "2026-07-24T08:00:00-05:00", end_at: "2026-07-24T10:00:00-05:00", timezone: TZ },
  { option_number: 2, slot_id: "slot_a_2", start_at: "2026-07-24T10:00:00-05:00", end_at: "2026-07-24T12:00:00-05:00", timezone: TZ },
  { option_number: 3, slot_id: "slot_a_3", start_at: "2026-07-27T13:00:00-05:00", end_at: "2026-07-27T15:00:00-05:00", timezone: TZ },
];

const pick = (text: string) => parseSlotSelection({ text, options: OPTIONS });

Deno.test("digit '1' selects option 1", () => {
  const r = pick("1");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 1);
  assertEquals(r.selected_slot_id, "slot_a_1");
});
Deno.test("'option 2' selects option 2", () => {
  const r = pick("option 2");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 2);
});
Deno.test("'the first one' selects option 1", () => {
  const r = pick("the first one please");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 1);
});
Deno.test("'the last option' selects LAST regardless of count", () => {
  const r = pick("the last option works");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 3);
});
Deno.test("'Friday morning' selects the sole Friday-AM option", () => {
  const r = pick("friday morning works for me");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 1);
});
Deno.test("'Friday' alone (two Friday options) → ambiguous", () => {
  const r = pick("friday");
  assertEquals(r.status, "ambiguous");
  assert(r.clarification_message && r.clarification_message.includes("1"));
});
Deno.test("'Monday afternoon' selects Monday PM", () => {
  const r = pick("monday afternoon");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 3);
});
Deno.test("'the 10 to 12 one' selects the 10-12 slot (no hour eaten as option)", () => {
  const r = pick("the 10 to 12 one");
  assertEquals(r.status, "selected");
  assertEquals(r.matched_option_number, 2);
});
Deno.test("gibberish returns no_match with clarification", () => {
  const r = pick("lol whatever");
  assertEquals(r.status, "no_match");
  assert(r.clarification_message && r.clarification_message.length > 0);
  assertEquals(r.selected_slot_id, null);
});
Deno.test("expired=true short-circuits regardless of text", () => {
  const r = parseSlotSelection({ text: "1", options: OPTIONS, expired: true });
  assertEquals(r.status, "expired_options");
  assertEquals(r.selected_slot_id, null);
});
Deno.test("empty options → expired_options", () => {
  const r = parseSlotSelection({ text: "1", options: [] });
  assertEquals(r.status, "expired_options");
});
Deno.test("empty text → no_match (never silent selection)", () => {
  const r = pick("   ");
  assertEquals(r.status, "no_match");
});
Deno.test("out-of-range digit '9' → no_match", () => {
  const r = pick("9");
  assertEquals(r.status, "no_match");
});
Deno.test("weekday not shown ('tuesday') → no_match", () => {
  const r = pick("tuesday please");
  assertEquals(r.status, "no_match");
});
