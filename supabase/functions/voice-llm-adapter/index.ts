// ============================================================================
// voice-llm-adapter — OpenAI-compatible /v1/chat/completions endpoint for the
// BluLadder inbound voice beta.
//
// This function is provider-independent. Any telephony vendor (Vapi, LiveKit,
// etc.) that speaks the OpenAI custom-LLM contract can point their custom-LLM
// at this endpoint. Business logic remains inside runOrchestrator().
//
// The function:
//   - accepts POST only
//   - rejects unsupported content types
//   - enforces a small request-size cap
//   - authenticates via `Authorization: Bearer <VOICE_LLM_ADAPTER_SHARED_SECRET>`
//   - refuses to run in production if the secret is missing
//   - never logs the Authorization header, PII, or full transcripts
//   - streams or non-streams a valid OpenAI response
//   - terminates SSE with `data: [DONE]\n\n`
//
// It does NOT: perform live provider transfers, connect to any Vapi API,
// persist transcripts or call events, or make routing decisions.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildNonStreamingResponse,
  buildStreamingResponse,
  parseAdapterRequest,
  runVoiceAdapter,
  type AdapterRequestError,
} from "../_shared/voiceAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bluladder-session-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorStatus(err: AdapterRequestError): number {
  switch (err.kind) {
    case "unsupported_method": return 405;
    case "unsupported_content_type": return 415;
    case "too_large": return 413;
    case "malformed_json":
    case "missing_messages":
    case "empty_conversation": return 400;
  }
}

function isProduction(): boolean {
  const env = (Deno.env.get("DENO_ENV") ?? Deno.env.get("NODE_ENV") ?? "").toLowerCase();
  return env === "production" || env === "prod";
}

function checkBearer(req: Request, secret: string | undefined): boolean {
  const header = req.headers.get("Authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token || !secret) return false;
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = Deno.env.get("VOICE_LLM_ADAPTER_SHARED_SECRET");
  if (!secret) {
    // Fail closed in production; return 500 so a misconfiguration is loud.
    // In non-production we still refuse so tests exercise the same code path.
    console.warn("voice-llm-adapter: shared secret not configured");
    return jsonError(500, isProduction() ? "shared_secret_missing_production" : "shared_secret_missing");
  }
  if (!checkBearer(req, secret)) {
    return jsonError(401, "unauthorized");
  }

  const parsed = await parseAdapterRequest(req);
  if (!parsed.ok) return jsonError(errorStatus(parsed.error), parsed.error.kind);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError(500, "supabase_env_missing");
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const completion = await runVoiceAdapter({
    supabase,
    request: parsed.value,
  });

  // Structured, PII-free log line. Never log the Authorization header, full
  // phone numbers, addresses, or the full transcript.
  console.log(JSON.stringify({
    at: "voice-llm-adapter",
    sessionSynthetic: parsed.value.sessionIdIsSynthetic,
    stream: parsed.value.stream,
    action: completion.action.kind,
    state: completion.orchestrator.state ?? null,
    replyLen: completion.content.length,
  }));

  const model = parsed.value.model || "bluladder-voice-adapter";
  return parsed.value.stream
    ? buildStreamingResponse(model, completion)
    : buildNonStreamingResponse(model, completion);
});