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
