// ============================================================================
// voice-llm-adapter — OpenAI-compatible /v1/chat/completions endpoint.
//
// True streaming: fast knowledge lane streams model tokens as they arrive.
// Slow business lane emits a deterministic acknowledgement immediately, then
// runs the authoritative orchestrator. Non-streaming callers keep working.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AdapterRequestError,
  buildNonStreamingResponse,
  parseAdapterRequest,
  runVoiceAdapter,
  runVoiceAdapterStream,
  type VoiceStreamEvent,
} from "../_shared/voiceAdapter.ts";
import { BUILD_FEATURES, BUILD_ID } from "../_shared/buildMarker.ts";
import {
  rolloutLogPayload,
  selectRoute,
} from "../_shared/workflow/rolloutRoute.ts";
import {
  persistControllerPatch,
  runControllerTurn,
} from "../_shared/workflow/workflowController.ts";
import { ensureVoiceConversation } from "../_shared/voiceAdapter.ts";
import { normalizeVoiceMessages } from "../_shared/voice/voiceInputNormalizer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-bluladder-session-id",
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
    case "unsupported_method":
      return 405;
    case "unsupported_content_type":
      return 415;
    case "too_large":
      return 413;
    case "malformed_json":
    case "missing_messages":
    case "empty_conversation":
    case "invalid_session_identifier":
    case "conflicting_session_identifiers":
      return 400;
  }
}

function isProduction(): boolean {
  const env = (Deno.env.get("DENO_ENV") ?? Deno.env.get("NODE_ENV") ?? "")
    .toLowerCase();
  return env === "production" || env === "prod";
}

function checkBearer(req: Request, secret: string | undefined): boolean {
  const header = req.headers.get("Authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token || !secret) return false;
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Emit one deterministic controller reply using the same OpenAI-compatible SSE
 * contract Vapi expects for stream=true requests.
 */
function buildStreamingTextResponse(model: string, spoken: string): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      write({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null,
        }],
      });
      write({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: { content: spoken },
          finish_reason: null,
        }],
      });
      write({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "stop",
        }],
        bluladder: {
          buildId: BUILD_ID,
          action: { kind: "speak" },
          state: "workflow_controller",
          route: "controller",
        },
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Safe diagnostics: non-authenticated GET returns the build marker only.
  // Never speaks to a caller and never exposes secrets, env values, or PII.
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/diagnostics")) {
    return new Response(
      JSON.stringify({ buildId: BUILD_ID, features: BUILD_FEATURES }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const secret = Deno.env.get("VOICE_LLM_ADAPTER_SHARED_SECRET");
  if (!secret) {
    console.warn("voice-llm-adapter: shared secret not configured");
    return jsonError(
      500,
      isProduction()
        ? "shared_secret_missing_production"
        : "shared_secret_missing",
    );
  }
  if (!checkBearer(req, secret)) return jsonError(401, "unauthorized");

  const parsed = await parseAdapterRequest(req);
  if (!parsed.ok) {
    return jsonError(errorStatus(parsed.error), parsed.error.kind);
  }

  // Keep one request object for both routing lanes. The canonical pre-routing
  // normalizer below updates its message list before either lane consumes it.
  const request = parsed.value;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError(500, "supabase_env_missing");
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const model = request.model || "bluladder-voice-adapter";

  // ---- Pre-routing normalization ----------------------------------------
  // Context-aware story / spoken-square-footage / window-side normalization
  // runs BEFORE the deterministic controller and the legacy orchestrator so
  // both lanes see the same unambiguous utterance. Address-shaped replies are
  // left untouched by the normalizer.
  try {
    const normalized = normalizeVoiceMessages(request.messages);
    if (normalized.applied.length) {
      request.messages = normalized.messages;
      console.log(JSON.stringify({
        at: "voice-llm-adapter",
        buildId: BUILD_ID,
        normalization: normalized.applied,
      }));
    }
  } catch {
    console.warn(JSON.stringify({
      at: "voice-llm-adapter",
      buildId: BUILD_ID,
      reason: "voice_input_normalization_failed",
    }));
  }

  // ---- Rollout gate ------------------------------------------------------
  const decision = selectRoute({
    syntheticTestHeader: req.headers.get("x-bluladder-synthetic-test"),
    callerIdE164: request.callerIdE164,
    env: {
      enabled: Deno.env.get("VOICE_WORKFLOW_CONTROLLER_ENABLED") ?? null,
      allowlist: Deno.env.get("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST") ?? null,
      testSecret: Deno.env.get("VOICE_WORKFLOW_TEST_SECRET") ?? null,
    },
  });
  try {
    console.log(JSON.stringify(
      await rolloutLogPayload(decision, request.callerIdE164),
    ));
  } catch {
    /* never throw from telemetry */
  }

  if (decision.route === "controller") {
    // Rollout-gated deterministic journey. Canonical pricing, availability,
    // and booking tool boundaries are invoked by the controller; unsupported
    // tenant-scoped record actions fail closed instead of falling through.
    try {
      const identity = await ensureVoiceConversation({ supabase, request });
      // Reconstruct history + last utterance the same way the legacy adapter does.
      const nonSystem = request.messages.filter((m) =>
        m.role !== "system" && m.role !== "tool"
      );
      let lastUserIdx = -1;
      for (let i = nonSystem.length - 1; i >= 0; i--) {
        if (nonSystem[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      const history = lastUserIdx >= 0
        ? nonSystem.slice(0, lastUserIdx).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
        : [];
      const userMessage = lastUserIdx >= 0
        ? nonSystem[lastUserIdx].content
        : "";
      const turn = await runControllerTurn({
        supabase,
        conversationId: identity.conversationId,
        channel: "voice",
        utterance: userMessage,
        history,
        callerIdE164: request.callerIdE164,
      });
      const persistence = await persistControllerPatch(
        supabase,
        turn.sessionId,
        turn.sessionPatch,
      );
      if (persistence.status === "conflict" || persistence.status === "error") {
        // Never fall through to legacy after the deterministic controller has
        // already decided or invoked a guarded tool. That could repeat a
        // mutation against stale state. A confirmed booking remains truthful
        // because create_bluladder_booking requires provider + local booking
        // persistence before it returns success; only the journey cursor failed.
        const bookingAlreadyConfirmed = turn.pre.kind === "fsm" &&
          turn.pre.action.kind === "confirm_result" &&
          turn.pre.action.success === true;
        const bookingWasAttempted = turn.pre.kind === "fsm" &&
          turn.pre.action.kind === "confirm_result";
        const spoken = bookingAlreadyConfirmed
          ? `${turn.pre.spoken} I couldn't save the call's progress marker, so please don't repeat the booking request.`
          : bookingWasAttempted
          ? `${turn.pre.spoken} I also couldn't save the call's progress marker. I will not repeat the booking request automatically; a team member should verify the result.`
          : "I couldn't safely save that update because the call state changed. I have not repeated or advanced the request. Please try that answer once more, or a team member can help.";
        console.warn(JSON.stringify({
          at: "voice-llm-adapter",
          buildId: BUILD_ID,
          route: "controller",
          persistence: persistence.status,
          reason: persistence.reason,
        }));
        const completion = {
          content: spoken,
          action: { kind: "speak" as const },
          orchestrator: {
            reply: spoken,
            toolEvents: [],
            events: ["workflow_controller_persistence_blocked"],
            state: "workflow_controller" as const,
            voice: { type: "speak" as const },
          },
        };
        return request.stream
          ? buildStreamingTextResponse(model, spoken)
          : buildNonStreamingResponse(model, completion);
      }
      const spoken = turn.pre.spoken;
      const completion = {
        content: spoken,
        action: { kind: "speak" as const },
        orchestrator: {
          reply: spoken,
          toolEvents: [],
          events: ["workflow_controller"],
          state: "workflow_controller" as const,
          voice: { type: "speak" as const },
        },
      };
      console.log(JSON.stringify({
        at: "voice-llm-adapter",
        buildId: BUILD_ID,
        route: "controller",
        preKind: turn.pre.kind,
        replyLen: spoken.length,
        stream: request.stream,
      }));
      return request.stream
        ? buildStreamingTextResponse(model, spoken)
        : buildNonStreamingResponse(model, completion);
    } catch {
      console.warn(JSON.stringify({
        at: "voice-llm-adapter",
        buildId: BUILD_ID,
        route: "controller",
        reason: "workflow_controller_failed_closed",
      }));
      const spoken =
        "I couldn't safely confirm the result of that request. I will not repeat any booking or other external action automatically. A team member can verify the result.";
      return request.stream
        ? buildStreamingTextResponse(model, spoken)
        : buildNonStreamingResponse(model, {
          content: spoken,
          action: { kind: "speak" as const },
          orchestrator: {
            reply: spoken,
            toolEvents: [],
            events: ["workflow_controller_failed_closed"],
            state: "workflow_controller" as const,
            voice: { type: "speak" as const },
          },
        });
    }
  }

  // Non-streaming: preserve existing behavior for provider fallbacks/tests.
  if (!request.stream) {
    const completion = await runVoiceAdapter({ supabase, request });
    console.log(JSON.stringify({
      at: "voice-llm-adapter",
      buildId: BUILD_ID,
      route: decision.route,
      stream: false,
      action: completion.action.kind,
      state: completion.orchestrator.state ?? null,
      replyLen: completion.content.length,
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
            write({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: { role: "assistant" },
                finish_reason: null,
              }],
            });
          } else if (ev.type === "text_delta") {
            write({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{
                index: 0,
                delta: { content: ev.text },
                finish_reason: null,
              }],
            });
          }
          // Other event types are internal — no SSE frame.
        } catch {
          /* transport closed */
        }
      };
      try {
        const result = await runVoiceAdapterStream({
          supabase,
          request,
          emit,
        });
        write({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
          bluladder: {
            buildId: BUILD_ID,
            action: result.action,
            state: result.orchestrator.state ?? null,
            route: result.route.type,
          },
        });
      } catch (_e) {
        write({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: "Sorry, I hit a snag." },
            finish_reason: "stop",
          }],
          bluladder: {
            buildId: BUILD_ID,
            action: {
              kind: "safe_failure",
              reasonCode: "adapter_exception",
            },
          },
        });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
