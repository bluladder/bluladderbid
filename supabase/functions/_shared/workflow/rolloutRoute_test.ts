import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAllowlist, selectRoute } from "./rolloutRoute.ts";

const baseEnv = { enabled: "true", allowlist: null, testSecret: null };

Deno.test("disabled flag forces legacy regardless of caller/header", () => {
  const d = selectRoute({
    syntheticTestHeader: "abc",
    callerIdE164: "+14697472877",
    env: { enabled: "false", allowlist: "+14697472877", testSecret: "abc" },
  });
  assertEquals(d.route, "legacy");
  assertEquals(d.reason, "disabled");
});

Deno.test("authenticated synthetic test selects controller", () => {
  const d = selectRoute({
    syntheticTestHeader: "s3cret-value",
    callerIdE164: null,
    env: { ...baseEnv, testSecret: "s3cret-value" },
  });
  assertEquals(d.route, "controller");
  assertEquals(d.reason, "synthetic_test_authenticated");
});

Deno.test("synthetic header without matching env secret stays legacy", () => {
  const d = selectRoute({
    syntheticTestHeader: "wrong",
    callerIdE164: null,
    env: { ...baseEnv, testSecret: "right" },
  });
  assertEquals(d.route, "legacy");
});

Deno.test("allowlisted real caller selects controller", () => {
  const d = selectRoute({
    syntheticTestHeader: null,
    callerIdE164: "+14695551212",
    env: { ...baseEnv, allowlist: "+14695551212, +19725550000" },
  });
  assertEquals(d.route, "controller");
  assertEquals(d.reason, "caller_allowlisted");
});

Deno.test("non-allowlisted real caller remains on legacy", () => {
  const d = selectRoute({
    syntheticTestHeader: null,
    callerIdE164: "+15551234567",
    env: { ...baseEnv, allowlist: "+14695551212" },
  });
  assertEquals(d.route, "legacy");
  assertEquals(d.reason, "not_allowlisted");
});

Deno.test("caller-controlled request field alone cannot bypass legacy", () => {
  // No matching env secret; only a caller-supplied header value is present.
  const d = selectRoute({
    syntheticTestHeader: "any-value",
    callerIdE164: "+15551234567",
    env: { ...baseEnv, testSecret: null, allowlist: null },
  });
  assertEquals(d.route, "legacy");
});

Deno.test("parseAllowlist normalizes 10-digit and 11-digit formats", () => {
  assertEquals(parseAllowlist("4695551212, 14695551213, +14695551214"), [
    "+14695551212",
    "+14695551213",
    "+14695551214",
  ]);
});