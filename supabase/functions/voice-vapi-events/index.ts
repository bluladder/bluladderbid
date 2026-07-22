// ============================================================================
// voice-vapi-events — isolated Phase 4C-β Vapi server-event receiver.
//
// Accepts an explicit allowlist of Vapi server events required for the
// direct-DID test. Auth via a shared header credential (X-Vapi-Secret).
// Off by default: no transcript, message, address, or full-phone data is
// logged. Structural payload-shape diagnostics only run when
// VOICE_PROVIDER_DEBUG is explicitly enabled in a non-production environment.
//
// This function does NOT: implement transfers, book appointments, persist
// transcripts, correlate with CallRail, or forward to any downstream system.
// ============================================================================
import {
  VOICE_VAPI_ALLOWED_EVENTS,
  type VoiceVapiAllowedEvent,
} from "../_shared/voiceProviderConfig.ts";
import { summarizeVapiEvent, voiceProviderDebugEnabled } from "../_shared/voiceProviderDebug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-vapi-secret, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BODY_BYTES = 64 * 1024;

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isProduction(): boolean {
  const env = (Deno.env.get("DENO_ENV") ?? Deno.env.get("NODE_ENV") ?? "").toLowerCase();
  return env === "production" || env === "prod";
}

function checkSharedSecret(req: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  // Vapi uses X-Vapi-Secret as the server-URL shared credential.
  const supplied = req.headers.get("x-vapi-secret") || "";
  if (!supplied) return false;
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function extractEventType(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const nested = (b.message && typeof b.message === "object")
    ? (b.message as Record<string, unknown>).type
    : undefined;
  const top = b.type;
  const t = typeof nested === "string" ? nested : typeof top === "string" ? top : null;
  return t;
}

export async function handleVapiEventRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "unsupported_method");
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) return jsonError(415, "unsupported_content_type");

  const secret = Deno.env.get("VAPI_SERVER_SECRET");
  if (!secret) {
    console.warn("voice-vapi-events: shared secret not configured");
    return jsonError(500, isProduction() ? "shared_secret_missing_production" : "shared_secret_missing");
  }
  if (!checkSharedSecret(req, secret)) return jsonError(401, "unauthorized");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, "too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "malformed_json");
  }

  const eventType = extractEventType(body);
  const allowed = eventType !== null && (VOICE_VAPI_ALLOWED_EVENTS as readonly string[]).includes(eventType);

  // Sanitized log line. Never emits message content, addresses, full phone
  // numbers, secrets, or the Authorization header.
  const debug = voiceProviderDebugEnabled();
  const logBase: Record<string, unknown> = {
    at: "voice-vapi-events",
    eventType: eventType ?? null,
    accepted: allowed,
  };
  if (debug) {
    const shape = summarizeVapiEvent(body);
    logBase.shape = {
      topLevelKeys: shape.topLevelKeys,
      keyPaths: shape.keyPaths,
      types: shape.types,
      callIdPath: shape.callIdPath,
      customerNumberLast4: shape.customerNumberLast4,
      phoneNumberIdPath: shape.phoneNumberIdPath,
      providerTimestampPath: shape.providerTimestampPath,
    };
  }
  console.log(JSON.stringify(logBase));

  // Vapi expects 200 for well-formed events; return an explicit ignored flag
  // for anything outside the direct-DID allowlist so misconfigurations are
  // observable without erroring the provider.
  return new Response(
    JSON.stringify({ received: allowed, ignored: !allowed, eventType: eventType ?? null }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type _AllowedEvent = VoiceVapiAllowedEvent;

Deno.serve(handleVapiEventRequest);