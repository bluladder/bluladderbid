// ============================================================================
// rolloutRoute.ts — narrow routing gate for the new workflow controller.
//
// Selects between "legacy" (existing runVoiceAdapter path) and "controller"
// (new workflow controller path) per request. The default is ALWAYS legacy.
// The controller is enabled only when one of:
//   1. The request carries a valid synthetic-test header AND its shared
//      secret matches the server-side env var VOICE_WORKFLOW_TEST_SECRET.
//      This is the "authenticated synthetic test" lane.
//   2. The normalized inbound caller ID matches one entry in the env
//      VOICE_WORKFLOW_CONTROLLER_ALLOWLIST (comma-separated E.164). This is
//      the "explicit allowlisted real caller" lane.
//
// Caller-controlled request fields alone MUST NOT be able to bypass legacy.
// Rollback: unset VOICE_WORKFLOW_CONTROLLER_ALLOWLIST and/or
// VOICE_WORKFLOW_TEST_SECRET, or set VOICE_WORKFLOW_CONTROLLER_ENABLED=false.
// ============================================================================

export type RolloutRoute = "legacy" | "controller";

export interface RolloutDecision {
  route: RolloutRoute;
  reason:
    | "disabled"
    | "synthetic_test_authenticated"
    | "caller_allowlisted"
    | "not_allowlisted"
    | "no_caller_id";
}

export interface RolloutInputs {
  /** Value of request header `x-bluladder-synthetic-test`, if any. */
  syntheticTestHeader: string | null;
  /** Normalized E.164 caller ID extracted from the request body, if any. */
  callerIdE164: string | null;
  /** Env values (injected for testability). */
  env: {
    enabled: string | null; // VOICE_WORKFLOW_CONTROLLER_ENABLED, default "true"
    allowlist: string | null; // VOICE_WORKFLOW_CONTROLLER_ALLOWLIST
    testSecret: string | null; // VOICE_WORKFLOW_TEST_SECRET
  };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function normalizeE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return raw.startsWith("+") ? raw : `+${digits}`;
}

export function parseAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeE164);
}

export function selectRoute(inputs: RolloutInputs): RolloutDecision {
  const enabled = (inputs.env.enabled ?? "true").toLowerCase() !== "false";
  if (!enabled) return { route: "legacy", reason: "disabled" };

  // Lane 1: authenticated synthetic test.
  if (
    inputs.syntheticTestHeader &&
    inputs.env.testSecret &&
    inputs.env.testSecret.length > 0 &&
    constantTimeEq(inputs.syntheticTestHeader, inputs.env.testSecret)
  ) {
    return { route: "controller", reason: "synthetic_test_authenticated" };
  }

  // Lane 2: allowlisted real caller.
  const allowlist = parseAllowlist(inputs.env.allowlist);
  if (!inputs.callerIdE164) {
    return { route: "legacy", reason: "no_caller_id" };
  }
  const normalized = normalizeE164(inputs.callerIdE164);
  if (allowlist.includes(normalized)) {
    return { route: "controller", reason: "caller_allowlisted" };
  }
  return { route: "legacy", reason: "not_allowlisted" };
}

/** PII-safe log payload for the rollout decision. Never emits raw phone
 *  numbers — only last-4 digits when a caller ID is present. */
export async function rolloutLogPayload(
  decision: RolloutDecision,
  callerIdE164: string | null,
): Promise<Record<string, unknown>> {
  let callerHash: string | null = null;
  let last4: string | null = null;
  if (callerIdE164) {
    const digits = callerIdE164.replace(/\D/g, "");
    last4 = digits.slice(-4) || null;
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(callerIdE164),
    );
    callerHash = Array.from(new Uint8Array(buf))
      .slice(0, 6)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return {
    at: "voice-workflow-rollout",
    route: decision.route,
    reason: decision.reason,
    callerLast4: last4,
    callerHash,
  };
}

/** Extract caller ID from a Vapi-like custom-LLM request body. Best-effort:
 *  tries several known shapes; returns null if nothing usable. Never throws. */
export function extractCallerIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const b: any = body;
  const candidates: unknown[] = [
    b?.call?.customer?.number,
    b?.call?.customer?.phoneNumber,
    b?.call?.from,
    b?.call?.fromNumber,
    b?.customer?.number,
    b?.metadata?.callerId,
    b?.metadata?.from,
    b?.metadata?.caller_number,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}