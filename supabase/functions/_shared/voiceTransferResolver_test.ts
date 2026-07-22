// Deno tests for the server-only voice transfer destination resolver.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AI_ENTRANCE_E164,
  RETIRED_TRANSFER_NUMBERS,
  maskForLog,
  normalizeE164,
  resolveTransferDestination,
} from "./voiceTransferResolver.ts";

const BENS_CELL = "+14692150144";

function envWith(map: Record<string, string | undefined>) {
  return (n: string) => map[n];
}

Deno.test("resolves Ben's configured number to a valid destination", () => {
  const r = resolveTransferDestination({ getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: BENS_CELL }) });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.destinationE164, BENS_CELL);
});

Deno.test("full number is masked in logs", () => {
  const r = resolveTransferDestination({ getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: BENS_CELL }) });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.destinationMasked, "***-***-0144");
  // Direct helper: must never leave the last-4 unmasked with more digits.
  assertEquals(maskForLog(BENS_CELL), "***-***-0144");
  assert(!r.destinationMasked.includes("469"));
  assert(!r.destinationMasked.includes("215"));
});

Deno.test("rejects the AI entrance number", () => {
  const r = resolveTransferDestination({ getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: AI_ENTRANCE_E164 }) });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "ai_entrance");
});

Deno.test("rejects a self-transfer to the current caller", () => {
  const r = resolveTransferDestination({
    getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: BENS_CELL }),
    currentCallerAni: BENS_CELL,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "self_transfer");
});

Deno.test("rejects the provider receiving DID", () => {
  const r = resolveTransferDestination({
    getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: BENS_CELL }),
    providerDid: BENS_CELL,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "provider_did");
});

Deno.test("rejects the retired ResponsiBid number", () => {
  assert(RETIRED_TRANSFER_NUMBERS.includes("+14692426556"));
  const r = resolveTransferDestination({ getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: "+14692426556" }) });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "retired_number");
});

Deno.test("rejects invalid E.164 input", () => {
  const r = resolveTransferDestination({ getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: "not-a-number" }) });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "invalid");
});

Deno.test("rejects missing configuration", () => {
  const r = resolveTransferDestination({ getEnv: envWith({}) });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "missing");
});

Deno.test("rejects a known forwarding-loop number", () => {
  const r = resolveTransferDestination({
    getEnv: envWith({ VOICE_HUMAN_TRANSFER_NUMBER: BENS_CELL }),
    extraLoopNumbers: [BENS_CELL],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "known_forwarding_loop");
});

Deno.test("normalizeE164 accepts common US formats", () => {
  assertEquals(normalizeE164("469-215-0144"), BENS_CELL);
  assertEquals(normalizeE164("(469) 215-0144"), BENS_CELL);
  assertEquals(normalizeE164("14692150144"), BENS_CELL);
  assertEquals(normalizeE164("+14692150144"), BENS_CELL);
  assertEquals(normalizeE164("garbage"), null);
});