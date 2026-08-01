import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  legacyVoiceExecutionAllowed,
  parseAllowlist,
  selectRoute,
} from "./rolloutRoute.ts";

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

Deno.test("reconciled mapped Vapi authority selects the deterministic controller without caller allowlisting", () => {
  const d = selectRoute({
    syntheticTestHeader: null,
    callerIdE164: "+15551234567",
    trustedProviderAuthorityResolved: true,
    env: { ...baseEnv, allowlist: null },
  });
  assertEquals(d, {
    route: "controller",
    reason: "mapped_provider_authority",
  });
  assertEquals(legacyVoiceExecutionAllowed(d, true), false);
});

Deno.test("a disabled controller fails mapped traffic closed instead of permitting legacy execution", () => {
  const d = selectRoute({
    syntheticTestHeader: null,
    callerIdE164: "+15551234567",
    trustedProviderAuthorityResolved: true,
    env: { ...baseEnv, enabled: "false" },
  });
  assertEquals(d, { route: "legacy", reason: "disabled" });
  assertEquals(legacyVoiceExecutionAllowed(d, true), false);
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

Deno.test("voice adapter carries mapped authority through routing and guards every legacy adapter call", async () => {
  const source = await Deno.readTextFile(
    new URL("../../voice-llm-adapter/index.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    "trustedProviderAuthorityResolved: providerAuthorityResolved",
  );
  const reconciled = source.indexOf("providerAuthorityResolved = true");
  const route = source.indexOf("const decision = selectRoute");
  const controller = source.indexOf('if (decision.route === "controller")');
  const legacyGuard = source.indexOf(
    "if (!legacyVoiceExecutionAllowed(decision, providerAuthorityResolved))",
    controller,
  );
  const nonStreamingLegacy = source.indexOf(
    "const completion = await runVoiceAdapter",
    legacyGuard,
  );
  const streamingLegacy = source.indexOf(
    "const result = await runVoiceAdapterStream",
    legacyGuard,
  );
  assert(
    reconciled > 0 && reconciled < route && route < controller &&
      controller < legacyGuard && legacyGuard < nonStreamingLegacy &&
      legacyGuard < streamingLegacy,
    "mapped authority must select the controller before one fail-closed guard protects both legacy adapters",
  );
});
