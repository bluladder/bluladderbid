// ============================================================================
// voiceProviderDebug.ts — structural, PII-free payload-shape diagnostics for
// the isolated Phase 4C-β voice test. Emits key paths, value types, and a few
// explicitly allow-listed presence flags. NEVER emits transcript text,
// message content, full phone numbers, authorization headers, or full control
// URLs. Off by default; refuses in production unless an established
// administrative override is set.
// ============================================================================

export interface DebugFlagOptions {
  env?: Record<string, string | undefined>;
}

/** Returns true when structural payload diagnostics are safe to emit. */
export function voiceProviderDebugEnabled(opts: DebugFlagOptions = {}): boolean {
  const env = opts.env ?? readDenoEnv();
  const flag = (env.VOICE_PROVIDER_DEBUG ?? "").toLowerCase();
  if (flag !== "true" && flag !== "1") return false;
  const runtime = (env.DENO_ENV ?? env.NODE_ENV ?? "").toLowerCase();
  const isProduction = runtime === "production" || runtime === "prod";
  if (isProduction) {
    // Explicit, auditable admin override — never inferrable from the debug
    // flag alone.
    return (env.VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE ?? "").toLowerCase() === "true";
  }
  return true;
}

function readDenoEnv(): Record<string, string | undefined> {
  try {
    // deno-lint-ignore no-explicit-any
    const d: any = (globalThis as any).Deno;
    if (d && typeof d.env?.get === "function") {
      return {
        VOICE_PROVIDER_DEBUG: d.env.get("VOICE_PROVIDER_DEBUG") ?? undefined,
        VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE: d.env.get("VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE") ?? undefined,
        DENO_ENV: d.env.get("DENO_ENV") ?? undefined,
        NODE_ENV: d.env.get("NODE_ENV") ?? undefined,
      };
    }
  } catch { /* ignore */ }
  return {};
}

const MAX_PATHS = 200;
const MAX_DEPTH = 6;

/** Recursively describe an object's shape: key paths + value types only. */
export function describePayloadShape(payload: unknown): {
  paths: string[];
  types: Record<string, string>;
} {
  const paths: string[] = [];
  const types: Record<string, string> = {};
  const visit = (val: unknown, prefix: string, depth: number) => {
    if (paths.length >= MAX_PATHS || depth > MAX_DEPTH) return;
    const t = valueType(val);
    if (prefix) {
      paths.push(prefix);
      types[prefix] = t;
    }
    if (t === "object" && val && typeof val === "object") {
      for (const k of Object.keys(val as Record<string, unknown>)) {
        visit((val as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, depth + 1);
      }
    } else if (t === "array" && Array.isArray(val)) {
      // Describe only the first element's shape so we do not enumerate content.
      if (val.length > 0) visit(val[0], `${prefix}[0]`, depth + 1);
    }
  };
  visit(payload, "", 0);
  return { paths, types };
}

function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Last 4 digits of a phone-like string, or null. Never returns the full value. */
export function maskLast4(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const digits = v.replace(/\D+/g, "");
  if (digits.length < 4) return null;
  return `***${digits.slice(-4)}`;
}

/** Stable non-reversible hash for correlating identifiers across events
 *  without persisting the identifier itself. Uses the Web Crypto SHA-256
 *  digest and returns the first 16 hex chars. */
export async function stableIdHash(v: string): Promise<string> {
  const enc = new TextEncoder().encode(v);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

export interface ChatCompletionShapeSummary {
  kind: "chat_completion_request";
  topLevelKeys: string[];
  keyPaths: string[];
  types: Record<string, string>;
  messageCount: number;
  messageRoleSequence: string[];
  hasStream: boolean;
  hasUser: boolean;
  suppliedSessionId: boolean;
  callIdPath: string | null;
  customerNumberPath: string | null;
  phoneNumberIdPath: string | null;
  providerTimestampPath: string | null;
  monitorObjectPath: string | null;
  controlUrlPresent: boolean;
  assistantIdPath: string | null;
}

/** Summarize an incoming OpenAI-compatible chat-completions request without
 *  reading message content, phone numbers, or the Authorization header. */
export function summarizeChatCompletionRequest(
  body: unknown,
  meta: { suppliedSessionId: boolean } = { suppliedSessionId: false },
): ChatCompletionShapeSummary {
  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const { paths, types } = describePayloadShape(b);
  const messages = Array.isArray(b.messages) ? b.messages : [];
  const roles = messages
    .map((m) => (m && typeof m === "object" && typeof (m as any).role === "string" ? (m as any).role : "?"))
    .filter((r) => typeof r === "string");
  return {
    kind: "chat_completion_request",
    topLevelKeys: Object.keys(b),
    keyPaths: paths,
    types,
    messageCount: messages.length,
    messageRoleSequence: roles,
    hasStream: b.stream === true,
    hasUser: typeof b.user === "string" && (b.user as string).length > 0,
    suppliedSessionId: meta.suppliedSessionId,
    callIdPath: findFirstMatchingPath(paths, [/(^|\.)call\.id$/, /(^|\.)callId$/, /(^|\.)call_id$/]),
    customerNumberPath: findFirstMatchingPath(paths, [
      /customer\.number$/, /customer\.phone$/, /caller\.number$/, /from$/,
    ]),
    phoneNumberIdPath: findFirstMatchingPath(paths, [/phoneNumberId$/, /phone_number_id$/]),
    providerTimestampPath: findFirstMatchingPath(paths, [/timestamp$/, /createdAt$/, /created_at$/]),
    monitorObjectPath: findFirstMatchingPath(paths, [/monitor$/, /monitor\./]),
    controlUrlPresent: paths.some((p) => /controlUrl$/i.test(p) || /control_url$/i.test(p)),
    assistantIdPath: findFirstMatchingPath(paths, [/assistantId$/, /assistant\.id$/, /assistant_id$/]),
  };
}

export interface VapiEventShapeSummary {
  kind: "vapi_server_event";
  eventType: string | null;
  topLevelKeys: string[];
  keyPaths: string[];
  types: Record<string, string>;
  callIdPath: string | null;
  customerNumberLast4: string | null;
  phoneNumberIdPath: string | null;
  providerTimestampPath: string | null;
}

export function summarizeVapiEvent(body: unknown): VapiEventShapeSummary {
  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const { paths, types } = describePayloadShape(b);
  const message = (b.message && typeof b.message === "object") ? b.message as Record<string, unknown> : null;
  const eventType = typeof message?.type === "string" ? String(message.type)
    : typeof b.type === "string" ? String(b.type)
    : null;
  // Try common locations for customer number without ever emitting it in full.
  const rawCustomerNumber =
    (b as any)?.message?.call?.customer?.number
    ?? (b as any)?.call?.customer?.number
    ?? (b as any)?.customer?.number
    ?? null;
  return {
    kind: "vapi_server_event",
    eventType,
    topLevelKeys: Object.keys(b),
    keyPaths: paths,
    types,
    callIdPath: findFirstMatchingPath(paths, [/(^|\.)call\.id$/, /(^|\.)callId$/, /(^|\.)call_id$/]),
    customerNumberLast4: typeof rawCustomerNumber === "string" ? maskLast4(rawCustomerNumber) : null,
    phoneNumberIdPath: findFirstMatchingPath(paths, [/phoneNumberId$/, /phone_number_id$/]),
    providerTimestampPath: findFirstMatchingPath(paths, [/timestamp$/, /createdAt$/, /created_at$/]),
  };
}

function findFirstMatchingPath(paths: string[], patterns: RegExp[]): string | null {
  for (const p of paths) if (patterns.some((rx) => rx.test(p))) return p;
  return null;
}