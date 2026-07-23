// Tests the deterministic identity-anchor reader. Uses a tiny fake Supabase
// client so we can precisely simulate the chat_conversations shape.
// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readIdentityAnchor } from "./identityAnchor.ts";

function makeSupa(resp: { data: any; error: any } | (() => { data: any; error: any })) {
  return {
    from(_name: string) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() {
          return typeof resp === "function" ? resp() : resp;
        },
      };
      return builder;
    },
  };
}

Deno.test("resolved when confirmed_email_customer_id is set", async () => {
  const supa = makeSupa({ data: {
    id: "c1", customer_id: null, confirmed_email_customer_id: "cust-1",
    resolution_method: "ambiguous", resolution_confidence: "ambiguous",
    awaiting_email_disambiguation: true,
  }, error: null });
  const a = await readIdentityAnchor(supa, "c1");
  assertEquals(a.identity_status, "resolved");
  assertEquals(a.confirmed_email_customer_id, "cust-1");
});

Deno.test("resolved on phone_exact with customer_id", async () => {
  const supa = makeSupa({ data: {
    customer_id: "cust-2", confirmed_email_customer_id: null,
    resolution_method: "phone_exact", resolution_confidence: "high",
    awaiting_email_disambiguation: false,
  }, error: null });
  const a = await readIdentityAnchor(supa, "c1");
  assertEquals(a.identity_status, "resolved");
});

Deno.test("ambiguous when resolution_method=ambiguous", async () => {
  const supa = makeSupa({ data: {
    customer_id: null, confirmed_email_customer_id: null,
    resolution_method: "ambiguous", resolution_confidence: "ambiguous",
    awaiting_email_disambiguation: true,
  }, error: null });
  const a = await readIdentityAnchor(supa, "c1");
  assertEquals(a.identity_status, "ambiguous");
});

Deno.test("NOT resolved by newest quote / booking / property (recent_quote)", async () => {
  const supa = makeSupa({ data: {
    customer_id: "cust-3", confirmed_email_customer_id: null,
    resolution_method: "recent_quote", resolution_confidence: "medium",
    awaiting_email_disambiguation: false,
  }, error: null });
  const a = await readIdentityAnchor(supa, "c1");
  // recent_quote is explicitly non-deterministic — treated as unresolved.
  assertEquals(a.identity_status, "unresolved");
});

Deno.test("unresolved when no anchor and not ambiguous", async () => {
  const supa = makeSupa({ data: {
    customer_id: null, confirmed_email_customer_id: null,
    resolution_method: "unresolved", resolution_confidence: "unknown",
    awaiting_email_disambiguation: false,
  }, error: null });
  const a = await readIdentityAnchor(supa, "c1");
  assertEquals(a.identity_status, "unresolved");
});

Deno.test("FAIL-CLOSED: read error yields unreadable", async () => {
  const supa = makeSupa({ data: null, error: { message: "boom" } });
  const a = await readIdentityAnchor(supa, "c1");
  assertEquals(a.identity_status, "unreadable");
});

Deno.test("FAIL-CLOSED: missing row yields unreadable", async () => {
  const supa = makeSupa({ data: null, error: null });
  const a = await readIdentityAnchor(supa, "c1");
  assertEquals(a.identity_status, "unreadable");
});

Deno.test("FAIL-CLOSED: missing conversationId yields unreadable", async () => {
  const supa = makeSupa({ data: null, error: null });
  const a = await readIdentityAnchor(supa, null);
  assertEquals(a.identity_status, "unreadable");
});