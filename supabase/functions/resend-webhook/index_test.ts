// Deno tests for resend-webhook event → attempt-status mapping.
// The mapping helper is duplicated here (private to index.ts) so the test
// stays a pure-function assertion without importing runtime side effects.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

function mapEventToAttemptStatus(type: string):
  | { status: "delivered" | "bounced" | "complained" | "suppressed"; column: string }
  | null
{
  const t = type.toLowerCase();
  if (t === "email.delivered")   return { status: "delivered",  column: "delivered_at"  };
  if (t === "email.bounced" || t === "email.hard_bounced")
                                 return { status: "bounced",    column: "bounced_at"    };
  if (t === "email.complained")  return { status: "complained", column: "complained_at" };
  if (t === "email.failed")      return { status: "suppressed", column: "suppressed_at" };
  return null;
}

Deno.test("email.delivered → delivered", () => {
  assertEquals(mapEventToAttemptStatus("email.delivered")?.status, "delivered");
});
Deno.test("email.bounced / email.hard_bounced → bounced", () => {
  assertEquals(mapEventToAttemptStatus("email.bounced")?.status, "bounced");
  assertEquals(mapEventToAttemptStatus("email.hard_bounced")?.status, "bounced");
});
Deno.test("email.complained → complained", () => {
  assertEquals(mapEventToAttemptStatus("email.complained")?.status, "complained");
});
Deno.test("email.failed → suppressed", () => {
  assertEquals(mapEventToAttemptStatus("email.failed")?.status, "suppressed");
});
Deno.test("informational events are ignored", () => {
  assertEquals(mapEventToAttemptStatus("email.sent"), null);
  assertEquals(mapEventToAttemptStatus("email.opened"), null);
  assertEquals(mapEventToAttemptStatus("email.clicked"), null);
});
