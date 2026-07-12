// Security tests for the shared authorization helper.
// Verifies constant-time cron-secret comparison and service-role token checks
// that gate cron/service-to-service functions (process-sms-queue,
// verify-schedule-mirror, send-notification, jobber-autosync, etc.).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Env must be set BEFORE importing the module (it reads secrets at load time).
Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
Deno.env.set("CRON_SECRET", "cron-test-secret");

const { isServiceRoleToken, isCronRequest, getBearer } = await import("./auth.ts");

Deno.test("getBearer extracts a valid bearer token", () => {
  const req = new Request("https://x", { headers: { Authorization: "Bearer abc123" } });
  assertEquals(getBearer(req), "abc123");
});

Deno.test("getBearer returns null when header missing or malformed", () => {
  assertEquals(getBearer(new Request("https://x")), null);
  assertEquals(getBearer(new Request("https://x", { headers: { Authorization: "Basic xyz" } })), null);
  assertEquals(getBearer(new Request("https://x", { headers: { Authorization: "Bearer " } })), null);
});

Deno.test("isServiceRoleToken only matches the exact service-role key", () => {
  assertEquals(isServiceRoleToken("service-role-test-key"), true);
  assertEquals(isServiceRoleToken("anon-test-key"), false);
  assertEquals(isServiceRoleToken("wrong"), false);
  assertEquals(isServiceRoleToken(null), false);
});

Deno.test("isCronRequest accepts the exact cron secret", () => {
  const req = new Request("https://x", { headers: { "x-cron-secret": "cron-test-secret" } });
  assertEquals(isCronRequest(req), true);
});

Deno.test("isCronRequest rejects missing, wrong, or wrong-length secrets", () => {
  assertEquals(isCronRequest(new Request("https://x")), false);
  assertEquals(isCronRequest(new Request("https://x", { headers: { "x-cron-secret": "wrong-value-1234" } })), false);
  assertEquals(isCronRequest(new Request("https://x", { headers: { "x-cron-secret": "short" } })), false);
});
