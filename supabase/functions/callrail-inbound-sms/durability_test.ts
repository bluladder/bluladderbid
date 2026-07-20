import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  classifyError, isTransient, nextAttemptAt, MAX_ATTEMPTS, safePayloadSnapshot,
  recordInboundReceipt,
} from "../_shared/callrailReceipts.ts";

Deno.test("classifyError maps common failures", () => {
  assertEquals(classifyError(new Error("Network fetch failed")).category, "network");
  assertEquals(classifyError(new Error("Request timed out")).category, "timeout");
  assertEquals(classifyError(new Error("Rate limit exceeded")).category, "rate_limited");
  assertEquals(classifyError(new Error("401 Unauthorized")).category, "auth");
  assertEquals(classifyError(new Error("weird")).category, "unknown");
});

Deno.test("transient categories retry, permanent do not", () => {
  assertEquals(isTransient("network"), true);
  assertEquals(isTransient("timeout"), true);
  assertEquals(isTransient("auth"), false);
  assertEquals(isTransient("unknown"), false);
});

Deno.test("backoff is bounded", () => {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const at = nextAttemptAt(i);
    if (i < MAX_ATTEMPTS) {
      if (!at) throw new Error(`expected next_attempt_at for attempt ${i}`);
      const delta = new Date(at).getTime() - Date.now();
      if (delta <= 0) throw new Error("backoff must be in the future");
    }
  }
  assertEquals(nextAttemptAt(MAX_ATTEMPTS + 1), null);
});

Deno.test("safePayloadSnapshot strips unknown fields and secrets", () => {
  const safe = safePayloadSnapshot({
    message_id: "abc",
    from: "+15551234567",
    content: "hi",
    authorization: "Bearer LEAK",
    cookie: "sess=leak",
    signature: "leak",
    "x-webhook-token": "leak",
  });
  assertEquals(safe.message_id, "abc");
  assertEquals(safe.from, "+15551234567");
  assertEquals(safe.content, "hi");
  assertEquals("authorization" in safe, false);
  assertEquals("cookie" in safe, false);
  assertEquals("signature" in safe, false);
  assertEquals("x-webhook-token" in safe, false);
});

// Fake supabase-shaped client that simulates the unique-constraint behavior
// on provider_message_id: the first insert succeeds; subsequent inserts with
// the same id fail and the caller falls back to the existing row.
function fakeSupabase() {
  const rows: Record<string, unknown>[] = [];
  return {
    from(_t: string) {
      let filterId: string | null = null;
      const builder = {
        insert(row: Record<string, unknown>) {
          const dup = rows.find(r => r.provider_message_id === row.provider_message_id);
          return {
            select() { return { maybeSingle: async () => dup ? { data: null, error: { code: "23505" } } : (rows.push({ id: crypto.randomUUID(), ...row }), { data: rows[rows.length - 1], error: null }) }; },
          };
        },
        select(_c: string) { return builder; },
        eq(_c: string, v: string) { filterId = v; return builder; },
        async maybeSingle() {
          const found = rows.find(r => r.provider_message_id === filterId);
          return { data: found ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

Deno.test("recordInboundReceipt returns duplicate=true on the second delivery", async () => {
  // deno-lint-ignore no-explicit-any
  const supa: any = fakeSupabase();
  const first = await recordInboundReceipt(supa, {
    providerMessageId: "cr_msg_1",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  assertEquals(first.duplicate, false);
  const second = await recordInboundReceipt(supa, {
    providerMessageId: "cr_msg_1",
    fromPhone: "+15551234567",
    toPhone: "+14697472877",
    payloadSafe: { content: "hi" },
  });
  assertEquals(second.duplicate, true);
  assertEquals(second.receipt.provider_message_id, "cr_msg_1");
});
