// Deno unit tests: the authorization ledger enforces per-test-type,
// single-use scope even when idempotency keys collide across types.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

interface AuthRow {
  id: string;
  test_type: string;
  idempotency_key: string;
  consumed_at: string | null;
  expires_at: string;
}

function makeLedger() {
  const rows: AuthRow[] = [];
  return {
    authorize(test_type: string, idempotency_key: string, ttlMinutes = 15) {
      const row: AuthRow = {
        id: crypto.randomUUID(),
        test_type,
        idempotency_key,
        consumed_at: null,
        expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      };
      rows.push(row);
      return row;
    },
    consume(test_type: string, idempotency_key: string) {
      const now = Date.now();
      const row = rows.find(
        (r) =>
          r.test_type === test_type &&
          r.idempotency_key === idempotency_key &&
          r.consumed_at === null &&
          new Date(r.expires_at).getTime() > now,
      );
      if (!row) return { status: "denied" };
      row.consumed_at = new Date().toISOString();
      return { status: "authorized", id: row.id };
    },
    expireAll() {
      for (const r of rows) r.expires_at = new Date(Date.now() - 1000).toISOString();
    },
  };
}

Deno.test("authorization for one test type cannot be consumed by another", () => {
  const L = makeLedger();
  L.authorize("sms_otp", "shared-key");
  const wrongType = L.consume("booking_link_sms", "shared-key");
  assertEquals(wrongType.status, "denied");
  const rightType = L.consume("sms_otp", "shared-key");
  assertEquals(rightType.status, "authorized");
});

Deno.test("email_otp authorization cannot send SMS", () => {
  const L = makeLedger();
  L.authorize("email_otp", "k1");
  assertEquals(L.consume("sms_otp", "k1").status, "denied");
  assertEquals(L.consume("booking_link_sms", "k1").status, "denied");
  assertEquals(L.consume("email_otp", "k1").status, "authorized");
});

Deno.test("each override is consumed exactly once", () => {
  const L = makeLedger();
  L.authorize("sms_otp", "k2");
  assertEquals(L.consume("sms_otp", "k2").status, "authorized");
  assertEquals(L.consume("sms_otp", "k2").status, "denied");
});

Deno.test("expired authorization sends nothing", () => {
  const L = makeLedger();
  L.authorize("sms_otp", "k3");
  L.expireAll();
  assertEquals(L.consume("sms_otp", "k3").status, "denied");
});

Deno.test("three concurrent authorizations remain independent", () => {
  const L = makeLedger();
  L.authorize("sms_otp", "sms");
  L.authorize("email_otp", "email");
  L.authorize("booking_link_sms", "link");
  assertEquals(L.consume("sms_otp", "sms").status, "authorized");
  // Consuming sms does not affect the others.
  assertEquals(L.consume("email_otp", "email").status, "authorized");
  assertEquals(L.consume("booking_link_sms", "link").status, "authorized");
});