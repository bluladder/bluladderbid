// ============================================================================
// voice-vapi-events — isolated Phase 4C-β Vapi server-event receiver.
//
// Accepts an explicit allowlist of Vapi server events required for the
// direct-DID test. Auth via a shared header credential (X-Vapi-Secret).
// No transcript, message, address, or full-phone data is logged. Bounded,
// sanitized user/assistant artifacts are persisted only through the tenant-
// scoped canonical conversation journal. Structural payload-shape diagnostics
// run only when VOICE_PROVIDER_DEBUG is explicitly enabled outside production.
//
// This function does NOT implement transfers, book appointments, correlate
// with CallRail, or persist raw provider payloads/recordings.
// ============================================================================
import {
  VOICE_VAPI_ALLOWED_EVENTS,
  type VoiceVapiAllowedEvent,
} from "../_shared/voiceProviderConfig.ts";
import {
  summarizeVapiEvent,
  voiceProviderDebugEnabled,
} from "../_shared/voiceProviderDebug.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isFinalCallEndedEvent,
  runVoiceHangupBidLinkFollowup,
} from "../_shared/voice/hangupBidLinkFollowup.ts";
import { BUILD_ID } from "../_shared/buildMarker.ts";
import { resolveVoiceProviderOrganizationAuthority } from "../_shared/voice/voiceOrganizationAuthority.ts";
import { persistVapiEndOfCallArtifacts } from "../_shared/voice/vapiArtifactJournal.ts";
import {
  persistPostCallOperationalNote,
  type PostCallOperationalNoteResult,
} from "../_shared/voice/postCallOperationalNote.ts";
import {
  handleVoiceLinkToolCalls,
  type VapiToolResultEnvelope,
} from "../_shared/voice/voiceLinkTools.ts";

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
  const env = (Deno.env.get("DENO_ENV") ?? Deno.env.get("NODE_ENV") ?? "")
    .toLowerCase();
  return env === "production" || env === "prod";
}

function constantTimeEqual(
  supplied: string,
  expected: string,
): boolean {
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function checkLegacySharedSecret(
  req: Request,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  // Vapi uses X-Vapi-Secret as the server-URL shared credential.
  const supplied = req.headers.get("x-vapi-secret") || "";
  return supplied.length > 0 && constantTimeEqual(supplied, expected);
}

function normalizeSha256Digest(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function checkHashedSharedSecret(
  req: Request,
  expectedDigest: string,
): Promise<boolean> {
  const supplied = req.headers.get("x-vapi-secret") || "";
  const suppliedDigest = await sha256Hex(supplied);
  return constantTimeEqual(suppliedDigest, expectedDigest);
}

function extractEventType(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const nested = (b.message && typeof b.message === "object")
    ? (b.message as Record<string, unknown>).type
    : undefined;
  const top = b.type;
  const t = typeof nested === "string"
    ? nested
    : typeof top === "string"
    ? top
    : null;
  return t;
}

export interface VapiEventDeps {
  /** Injected in tests so the receiver never touches a real backend. */
  runHangupFollowup?: typeof runVoiceHangupBidLinkFollowup;
  persistArtifacts?: typeof persistVapiEndOfCallArtifacts;
  persistPostCallNote?: typeof persistPostCallOperationalNote;
  handleLinkTools?: typeof handleVoiceLinkToolCalls;
  organizationId?: string;
}

async function callInternalQuoteFunction(
  supabaseUrl: string,
  serviceKey: string,
  name: string,
  body: unknown,
) {
  if (name !== "save-quote" && name !== "send-sms") {
    return { status: 403, json: { status: "forbidden" } };
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text.length <= 64 * 1024) {
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { status: "malformed_internal_response" };
    }
  }
  return { status: response.status, json };
}

export async function handleVapiEventRequest(
  req: Request,
  deps: VapiEventDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonError(405, "unsupported_method");
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return jsonError(415, "unsupported_content_type");
  }

  const configuredDigest = Deno.env.get("VAPI_SERVER_SECRET_SHA256");
  let authenticated = false;
  if (configuredDigest !== undefined) {
    const expectedDigest = normalizeSha256Digest(configuredDigest);
    if (!expectedDigest) {
      console.warn("voice-vapi-events: shared secret digest is invalid");
      return jsonError(
        500,
        isProduction()
          ? "shared_secret_digest_invalid_production"
          : "shared_secret_digest_invalid",
      );
    }
    authenticated = await checkHashedSharedSecret(req, expectedDigest);
  } else {
    const legacySecret = Deno.env.get("VAPI_SERVER_SECRET");
    if (!legacySecret) {
      console.warn("voice-vapi-events: shared secret not configured");
      return jsonError(
        500,
        isProduction()
          ? "shared_secret_missing_production"
          : "shared_secret_missing",
      );
    }
    authenticated = checkLegacySharedSecret(req, legacySecret);
  }
  if (!authenticated) return jsonError(401, "unauthorized");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, "too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "malformed_json");
  }

  const eventType = extractEventType(body);
  const allowed = eventType !== null &&
    (VOICE_VAPI_ALLOWED_EVENTS as readonly string[]).includes(eventType);

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

  // Thin Realtime MVP tools. The model selects only one exact link purpose;
  // tenant and destination authority are resolved from the authenticated Vapi
  // envelope before the durable outbox can run. Vapi requires a synchronous
  // 200 + results response even when the action fails closed.
  if (allowed && eventType === "tool-calls") {
    let toolResponse: VapiToolResultEnvelope;
    const run = deps.handleLinkTools ?? handleVoiceLinkToolCalls;
    try {
      if (deps.handleLinkTools) {
        toolResponse = await run(null, {
          body,
          organizationId: deps.organizationId ?? "",
        });
      } else {
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !key) {
          toolResponse = await handleVoiceLinkToolCalls(null, {
            body,
            organizationId: "",
          });
        } else {
          const supabase = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const authority = deps.organizationId
            ? {
              status: "resolved" as const,
              organizationId: deps.organizationId,
            }
            : await resolveVoiceProviderOrganizationAuthority(supabase, body);
          toolResponse = await run(supabase, {
            body,
            organizationId: authority.status === "resolved"
              ? authority.organizationId
              : "",
          });
        }
      }
    } catch {
      toolResponse = await handleVoiceLinkToolCalls(null, {
        body,
        organizationId: "",
      });
    }
    return new Response(JSON.stringify(toolResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Post-hangup online-bid SMS fallback. Runs ONLY for the authoritative final
  // call-ended event, never for status-update / hang / diagnostics traffic.
  // Fails closed and never throws into the provider response.
  if (allowed && isFinalCallEndedEvent(eventType)) {
    let followup: { status: string; detail?: string | null } = {
      status: "failed",
      detail: "not_attempted",
    };
    let postCallNote: PostCallOperationalNoteResult = {
      status: "ignored",
      conversationId: null,
      quoteSessionId: null,
      noteId: null,
      providerMemoStatus: "disabled",
      reason: "missing_call_identity",
    };
    try {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const run = deps.runHangupFollowup;
      if (run) {
        if (deps.persistPostCallNote) {
          postCallNote = await deps.persistPostCallNote(null, {
            body,
            organizationId: deps.organizationId ?? "test-authority",
          });
        }
        followup = await run({
          supabase: null,
          body,
          eventType,
          organizationId: deps.organizationId ?? null,
        });
      } else if (!url || !key) {
        followup = { status: "failed", detail: "backend_not_configured" };
      } else {
        const supabase = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const authority = deps.organizationId
          ? {
            status: "resolved" as const,
            organizationId: deps.organizationId,
          }
          : await resolveVoiceProviderOrganizationAuthority(supabase, body);
        if (authority.status !== "resolved") {
          followup = {
            status: "failed",
            detail: `organization_authority_${authority.code}`,
          };
          throw new Error("organization_authority_blocked");
        }
        const persistArtifacts = deps.persistArtifacts ??
          persistVapiEndOfCallArtifacts;
        const artifactResult = await persistArtifacts(supabase, {
          body,
          organizationId: authority.organizationId,
        });
        console.log(JSON.stringify({
          at: "voice-vapi-events",
          buildId: BUILD_ID,
          artifactJournal: artifactResult.status,
          sourceMessages: artifactResult.sourceMessages,
          written: artifactResult.written,
          duplicates: artifactResult.duplicates,
          failed: artifactResult.failed,
        }));
        try {
          const persistNote = deps.persistPostCallNote ??
            persistPostCallOperationalNote;
          postCallNote = await persistNote(supabase, {
            body,
            organizationId: authority.organizationId,
          });
        } catch {
          postCallNote = {
            status: "error",
            conversationId: null,
            quoteSessionId: null,
            noteId: null,
            providerMemoStatus: "disabled",
            reason: "note_write_failed",
          };
        }
        console.log(JSON.stringify({
          at: "voice-vapi-events",
          buildId: BUILD_ID,
          postCallNote: postCallNote.status,
          providerMemo: postCallNote.providerMemoStatus,
        }));
        followup = await runVoiceHangupBidLinkFollowup({
          supabase,
          body,
          eventType,
          organizationId: authority.organizationId,
          callFunction: (name, payload) =>
            callInternalQuoteFunction(url, key, name, payload),
        });
      }
    } catch (e) {
      followup = { status: "failed", detail: String(e).slice(0, 180) };
    }
    console.log(JSON.stringify({
      at: "voice-vapi-events",
      buildId: BUILD_ID,
      followup: "voice_call_bid_link",
      status: followup.status,
      detail: followup.detail ?? null,
    }));
    return new Response(
      JSON.stringify({
        received: true,
        ignored: false,
        eventType,
        followup: { kind: "voice_call_bid_link", status: followup.status },
        postCallNote: {
          status: postCallNote.status,
          providerMemoStatus: postCallNote.providerMemoStatus,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Vapi expects 200 for well-formed events; return an explicit ignored flag
  // for anything outside the direct-DID allowlist so misconfigurations are
  // observable without erroring the provider.
  return new Response(
    JSON.stringify({
      received: allowed,
      ignored: !allowed,
      eventType: eventType ?? null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type _AllowedEvent = VoiceVapiAllowedEvent;

if (import.meta.main) {
  Deno.serve((req: Request) => handleVapiEventRequest(req));
}
