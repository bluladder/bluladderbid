// Tests for the shared campaign emitter. It must ALWAYS route through the
// canonical campaign-event function (never insert enrollments itself), forward
// the deterministic idempotency key verbatim, and never throw on failure.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { emitCampaignEvent } from "./campaignEmitter.ts";

Deno.env.set("SUPABASE_URL", "http://local.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");

Deno.test("forwards event to campaign-event with deterministic idempotency key", async () => {
  let captured: { url: string; body: any; auth: string | null } | null = null;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = {
      url: String(url),
      body: JSON.parse(init.body),
      auth: init.headers.Authorization ?? null,
    };
    return new Response(JSON.stringify({ event_id: "e1", decisions: [] }), { status: 200 });
  }) as typeof fetch;

  const res = await emitCampaignEvent({
    eventName: "booking_completed",
    idempotencyKey: "booking_completed:quote-123",
    email: "a@b.com",
    customerId: "cust-1",
    source: "test",
  });

  globalThis.fetch = orig;
  assertEquals(res.ok, true);
  assertEquals(captured!.url, "http://local.test/functions/v1/campaign-event");
  assertEquals(captured!.body.event_name, "booking_completed");
  assertEquals(captured!.body.idempotency_key, "booking_completed:quote-123");
  assertEquals(captured!.body.customer_id, "cust-1");
  assertEquals(captured!.auth, "Bearer svc-key");
});

Deno.test("never throws when the campaign-event call fails", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  const res = await emitCampaignEvent({
    eventName: "customer_replied",
    idempotencyKey: "customer_replied:msg-1",
    phone: "+14692150144",
    source: "callrail",
  });
  globalThis.fetch = orig;
  assertEquals(res.ok, false);
  assertEquals(res.status, 0);
});

Deno.test("retries transient 5xx then succeeds", async () => {
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    if (calls < 2) return new Response("boom", { status: 503 });
    return new Response(JSON.stringify({ event_id: "e2" }), { status: 200 });
  }) as typeof fetch;
  const res = await emitCampaignEvent({
    eventName: "booking_completed",
    idempotencyKey: "booking_completed:retry",
    source: "test",
    maxAttempts: 3,
    timeoutMs: 500,
  });
  globalThis.fetch = orig;
  assertEquals(res.ok, true);
  assertEquals(calls, 2);
});

Deno.test("does NOT retry permanent 4xx", async () => {
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; return new Response("bad", { status: 400 }); }) as typeof fetch;
  const res = await emitCampaignEvent({
    eventName: "quote_calculated",
    idempotencyKey: "q:1",
    source: "test",
    maxAttempts: 3,
    timeoutMs: 500,
  });
  globalThis.fetch = orig;
  assertEquals(res.ok, false);
  assertEquals(calls, 1);
});

Deno.test("persists a pending recovery row for a critical event on final failure", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  let inserted: any = null;
  const recoverySupabase = {
    from: (_t: string) => ({
      insert: async (v: any) => { inserted = v; return { error: null }; },
    }),
  };
  const res = await emitCampaignEvent({
    eventName: "consent_revoked",
    idempotencyKey: "consent_revoked:evt-1",
    email: "a@b.com",
    source: "ai_chat",
    maxAttempts: 2,
    timeoutMs: 200,
    recoverySupabase,
  });
  globalThis.fetch = orig;
  assertEquals(res.ok, false);
  assertEquals(res.recovered, true);
  assertEquals(inserted.event_name, "consent_revoked");
  assertEquals(inserted.idempotency_key, "consent_revoked:evt-1");
  assertEquals(inserted.processed_at, null);
  assertEquals(inserted.metadata.__recovery_payload.idempotency_key, "consent_revoked:evt-1");
});

Deno.test("does NOT persist recovery for a non-critical event", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
  let insertCalled = false;
  const recoverySupabase = { from: (_t: string) => ({ insert: async () => { insertCalled = true; return { error: null }; } }) };
  const res = await emitCampaignEvent({
    eventName: "quote_calculated",
    idempotencyKey: "q:2",
    source: "test",
    maxAttempts: 1,
    timeoutMs: 200,
    recoverySupabase,
  });
  globalThis.fetch = orig;
  assertEquals(res.ok, false);
  assertEquals(insertCalled, false);
});
