// ============================================================================
// voice-llm-adapter — OpenAI-compatible /v1/chat/completions endpoint.
//
// True streaming: fast knowledge lane streams model tokens as they arrive.
// Slow business lane emits a deterministic acknowledgement immediately, then
// runs the authoritative orchestrator. Non-streaming callers keep working.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildNonStreamingResponse,
  parseAdapterRequest,
  runVoiceAdapter,
  runVoiceAdapterStream,
  type AdapterRequestError,
  type VoiceStreamEvent,
} from "../_shared/voiceAdapter.ts";
import { BUILD_ID, BUILD_FEATURES } from "../_shared/buildMarker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bluladder-session-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

  // Safe diagnostics: non-authenticated GET returns the build marker only.
  // Never speaks to a caller and never exposes secrets, env values, or PII.
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/diagnostics")) {
    return new Response(
      JSON.stringify({ buildId: BUILD_ID, features: BUILD_FEATURES }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const secret = Deno.env.get("VOICE_LLM_ADAPTER_SHARED_SECRET");
  if (!secret) {
    console.warn("voice-llm-adapter: shared secret not configured");
    return jsonError(500, isProduction() ? "shared_secret_missing_production" : "shared_secret_missing");
  }
  if (!checkBearer(req, secret)) return jsonError(401, "unauthorized");

  const parsed = await parseAdapterRequest(req);
  if (!parsed.ok) return jsonError(errorStatus(parsed.error), parsed.error.kind);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return jsonError(500, "supabase_env_missing");
  const supabase = createClient(supabaseUrl, serviceKey);
  const model = parsed.value.model || "bluladder-voice-adapter";

  // Non-streaming: preserve existing behavior for provider fallbacks/tests.
  if (!parsed.value.stream) {
    const completion = await runVoiceAdapter({ supabase, request: parsed.value });
    console.log(JSON.stringify({
      at: "voice-llm-adapter", buildId: BUILD_ID, stream: false, action: completion.action.kind,
      state: completion.orchestrator.state ?? null, replyLen: completion.content.length,
    }));
    return buildNonStreamingResponse(model, completion);
  }

  // Streaming: assemble OpenAI-compatible chat.completion.chunk SSE frames as
  // adapter events arrive.
  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let closed = false;
      const emit = (ev: VoiceStreamEvent) => {
        if (closed) return false;
        try {
          if (ev.type === "role_delta") {
            write({ id, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
          } else if (ev.type === "text_delta") {
            write({ id, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null }] });
          }
          // Other event types are internal — no SSE frame.
        } catch { /* transport closed */ }
      };
      try {
        const result = await runVoiceAdapterStream({ supabase, request: parsed.value, emit });
        write({ id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          bluladder: { buildId: BUILD_ID, action: result.action, state: result.orchestrator.state ?? null, route: result.route.type } });
      } catch (_e) {
        write({ id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { content: "Sorry, I hit a snag." }, finish_reason: "stop" }],
          bluladder: { buildId: BUILD_ID, action: { kind: "safe_failure", reasonCode: "adapter_exception" } } });
      } finally {
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
});
