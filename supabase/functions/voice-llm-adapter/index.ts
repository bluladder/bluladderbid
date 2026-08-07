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
  legacyVoiceExecutionAllowed,
  rolloutLogPayload,
  selectRoute,
} from "../_shared/workflow/rolloutRoute.ts";
import { ensureVoiceConversation } from "../_shared/voiceAdapter.ts";
import { normalizeVoiceMessages } from "../_shared/voice/voiceInputNormalizer.ts";
import {
  resolveVoiceOrganizationAuthority,
  resolveVoiceProviderOrganizationAuthority,
} from "../_shared/voice/voiceOrganizationAuthority.ts";
import { executeControllerRoute } from "../_shared/voice/controllerRoute.ts";
import { runTool } from "../_shared/aiTools.ts";
import {
  buildSilentVoiceResponse as buildSilentResponse,
  claimVoiceTurn,
  completeVoiceTurn,
  isAuthoritativeVoiceTurn,
  markVoiceTurnUncertain,
  prepareVoiceIngress,
  runClaimedExternalAction,
  type VoiceTurnDescriptor,
} from "../_shared/voice/voiceTurnCoordinator.ts";
import {
  buildVoiceTurnCorrelationId,
  emitVoiceTurnLatency,
  extractProviderFinalUserTurnAtMs,
  type VoiceTurnLatencyOutcome,
  VoiceTurnLatencyRecorder,
  type VoiceTurnLatencyRoute,
} from "../_shared/voice/voiceTurnLatency.ts";
import { readReplayableControllerReply } from "../_shared/voice/turnJournal.ts";
import {
  resolveCompletedVoiceTurnReplay,
} from "../_shared/voice/voiceTurnReplay.ts";
import {
  buildControllerStreamResponse,
  type ControllerStreamResult,
} from "../_shared/voice/voiceControllerStream.ts";

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

const buildSilentVoiceResponse = (model: string, stream: boolean) =>
  buildSilentResponse(model, stream, BUILD_ID);

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
  const raw = await response.text();
  let json: unknown = null;
  if (raw.length <= 64 * 1024) {
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = { status: "malformed_internal_response" };
    }
  }
  return { status: response.status, json };
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
function buildStreamingTextResponse(
  model: string,
  spoken: string,
  metadata: {
    action?: { kind: string; reasonCode?: string };
    event?: string;
    route?: string;
  } = {},
  lifecycle: {
    onFirstChunk?: () => void;
    onComplete?: () => void;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let firstChunk = true;
      const write = (obj: unknown) => {
        if (firstChunk) {
          firstChunk = false;
          try {
            lifecycle.onFirstChunk?.();
          } catch { /* telemetry must never change streaming */ }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

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
          action: metadata.action ?? { kind: "speak" },
          state: "workflow_controller",
          route: metadata.route ?? "controller",
          ...(metadata.event ? { event: metadata.event } : {}),
        },
      });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
      try {
        lifecycle.onComplete?.();
      } catch { /* telemetry must never change streaming */ }
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

function buildAuthorityBlockedResponse(
  model: string,
  stream: boolean,
  reasonCode: string,
): Response {
  const spoken =
    "I can't safely access this account right now, so I haven't opened, changed, or booked anything. A team member can help verify the account setup.";
  const action = { kind: "safe_failure" as const, reasonCode };
  if (stream) {
    return buildStreamingTextResponse(model, spoken, {
      action,
      event: "organization_authority_blocked",
      route: "authority_gate",
    });
  }
  return buildNonStreamingResponse(model, {
    content: spoken,
    action,
    orchestrator: {
      reply: spoken,
      toolEvents: [],
      events: ["organization_authority_blocked"],
      state: "authority_blocked",
      voice: { type: "safe_failure", reasonCode },
    },
  });
}

Deno.serve(async (req) => {
  const requestArrival = performance.now();
  const requestWallClock = Date.now();
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
  const finalUserTurnReceivedAt = performance.now();

  // Keep one request object for both routing lanes. The canonical pre-routing
  // normalizer below updates its message list before either lane consumes it.
  const request = parsed.value;

  // Remove only the narrow provider boilerplate before normalization,
  // reconstruction, classification, journaling, or any tenant-owned write.
  const earlyModel = request.model || "bluladder-voice-adapter";
  const ingress = await prepareVoiceIngress(request);
  if (ingress.status === "ignored") {
    console.log(JSON.stringify({
      at: "voice-llm-adapter",
      buildId: BUILD_ID,
      route: "ingress",
      reason: `ingress_ignored_${ingress.reason}`,
    }));
    return buildSilentVoiceResponse(earlyModel, request.stream);
  }
  const turn: VoiceTurnDescriptor = ingress.turn;
  const correlationId = await buildVoiceTurnCorrelationId(turn.turnId);
  const latency = new VoiceTurnLatencyRecorder({
    correlationId,
    stream: request.stream,
    originMs: requestArrival,
    receivedWallClockMs: requestWallClock,
    providerFinalUserTurnAtMs: extractProviderFinalUserTurnAtMs(
      request.rawBody,
    ),
  });
  latency.mark("finalUserTurnReceivedMs", finalUserTurnReceivedAt);
  const finishImmediate = (
    response: Response,
    route: VoiceTurnLatencyRoute,
    outcome: VoiceTurnLatencyOutcome,
  ): Response => {
    latency.mark("firstResponseChunkMs");
    latency.mark("responseCompletedMs");
    emitVoiceTurnLatency(latency.finish({ route, outcome }));
    return response;
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return finishImmediate(
      jsonError(500, "supabase_env_missing"),
      "unknown",
      "failed_closed",
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const model = request.model || "bluladder-voice-adapter";
  // Preserve the provider's exact bounded message strings for the canonical
  // journal. Parsing-only normalization below must not rewrite the transcript.
  const providerMessagesForJournal = request.messages.map((message) => ({
    ...message,
  }));

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

  // ---- Tenant authority ingress gate ------------------------------------
  // Provider mappings are resolved before any tenant-owned conversation is
  // read or created. ANI, email, body metadata, and caller-provided tenant IDs
  // are never authority. The created/loaded conversation is then reconciled as
  // additional trusted evidence, and both rollout lanes receive the same
  // resolved organization.
  let identity: Awaited<ReturnType<typeof ensureVoiceConversation>>;
  let organizationAuthority: Awaited<
    ReturnType<typeof resolveVoiceOrganizationAuthority>
  >;
  let providerAuthorityResolved = false;
  let turnClaimed = false;
  let claimedOrganizationId: string | null = null;
  try {
    const providerAuthorityStarted = performance.now();
    const providerAuthority = await resolveVoiceProviderOrganizationAuthority(
      supabase,
      request.rawBody,
    );
    latency.add(
      "databaseMs",
      performance.now() - providerAuthorityStarted,
    );
    if (providerAuthority.status !== "resolved") {
      console.warn(JSON.stringify({
        at: "voice-llm-adapter",
        buildId: BUILD_ID,
        reason: "organization_authority_blocked",
        authorityCode: providerAuthority.code,
      }));
      return finishImmediate(
        buildAuthorityBlockedResponse(
          model,
          request.stream,
          providerAuthority.code,
        ),
        "authority_gate",
        "failed_closed",
      );
    }
    const claimStarted = performance.now();
    const claim = await claimVoiceTurn(supabase, {
      ...turn,
      organizationId: providerAuthority.organizationId,
    });
    const claimMs = performance.now() - claimStarted;
    latency.add("singleFlightMs", claimMs);
    latency.add("databaseMs", claimMs);
    if (claim !== "acquired") {
      const outcome: VoiceTurnLatencyOutcome = claim === "duplicate"
        ? "duplicate_suppressed"
        : claim === "stale"
        ? "stale_suppressed"
        : claim === "wait"
        ? "wait_suppressed"
        : "uncertain_suppressed";
      if (claim === "duplicate") {
        const replayStarted = performance.now();
        const replay = await resolveCompletedVoiceTurnReplay({
          readReply: () =>
            readReplayableControllerReply(supabase, {
              organizationId: providerAuthority.organizationId,
              sessionToken: request.sessionId,
              turnId: turn.turnId,
              turnPosition: turn.position,
              contentHash: turn.contentHash,
              messages: providerMessagesForJournal,
            }),
          isAuthoritative: () =>
            isAuthoritativeVoiceTurn(supabase, {
              organizationId: providerAuthority.organizationId,
              callId: turn.callId,
              turnId: turn.turnId,
            }),
        });
        latency.add("databaseMs", performance.now() - replayStarted);
        if (replay.status === "replay") {
          console.log(JSON.stringify({
            at: "voice-llm-adapter",
            buildId: BUILD_ID,
            correlationId,
            route: "single_flight",
            reason: "duplicate_replayed",
          }));
          if (!request.stream) {
            return finishImmediate(
              buildNonStreamingResponse(model, {
                content: replay.spoken,
                action: { kind: "speak" },
                orchestrator: {
                  reply: replay.spoken,
                  toolEvents: [],
                  events: ["voice_turn_replayed"],
                  state: "workflow_controller",
                  voice: { type: "speak" },
                },
              }),
              "single_flight",
              "responded",
            );
          }
          return buildControllerStreamResponse({
            model,
            buildId: BUILD_ID,
            headers: corsHeaders,
            run: () =>
              Promise.resolve({
                status: "speak",
                spoken: replay.spoken,
                metadata: {
                  event: "voice_turn_replayed",
                  route: "single_flight_replay",
                },
              }),
            lifecycle: {
              onFirstChunk: () => latency.mark("firstResponseChunkMs"),
              onComplete: () =>
                emitVoiceTurnLatency(latency.finish({
                  route: "single_flight",
                  outcome: "responded",
                })),
            },
          });
        }
        console.log(JSON.stringify({
          at: "voice-llm-adapter",
          buildId: BUILD_ID,
          correlationId,
          route: "single_flight",
          reason: replay.reason === "reply_unavailable"
            ? "duplicate_replay_unavailable"
            : "duplicate_replay_not_authoritative",
          replayReason: replay.detail ?? replay.reason,
        }));
      } else {
        console.log(JSON.stringify({
          at: "voice-llm-adapter",
          buildId: BUILD_ID,
          correlationId,
          route: "single_flight",
          reason: claim === "stale"
            ? "stale_suppressed"
            : claim === "wait"
            ? "wait_suppressed"
            : "uncertain_suppressed",
        }));
      }
      return finishImmediate(
        buildSilentVoiceResponse(model, request.stream),
        "single_flight",
        outcome,
      );
    }
    latency.mark("singleFlightClaimedMs");
    turnClaimed = true;
    claimedOrganizationId = providerAuthority.organizationId;
    const conversationLoadStarted = performance.now();
    identity = await ensureVoiceConversation({
      supabase,
      request,
      organizationId: providerAuthority.organizationId,
    });
    organizationAuthority = await resolveVoiceOrganizationAuthority(
      supabase,
      {
        conversationId: identity.conversationId,
        rawBody: request.rawBody,
      },
    );
    const conversationLoadMs = performance.now() - conversationLoadStarted;
    latency.add("conversationSessionLoadMs", conversationLoadMs);
    latency.add("databaseMs", conversationLoadMs);
    latency.mark("conversationSessionLoadedMs");
    if (
      organizationAuthority.status !== "resolved" ||
      organizationAuthority.organizationId !== providerAuthority.organizationId
    ) {
      const code = organizationAuthority.status === "blocked"
        ? organizationAuthority.code
        : "conflicting_authority";
      console.warn(JSON.stringify({
        at: "voice-llm-adapter",
        buildId: BUILD_ID,
        reason: "organization_authority_reconciliation_blocked",
        authorityCode: code,
      }));
      await markVoiceTurnUncertain(supabase, {
        organizationId: providerAuthority.organizationId,
        callId: turn.callId,
        turnId: turn.turnId,
      });
      return finishImmediate(
        buildSilentVoiceResponse(model, request.stream),
        "authority_gate",
        "failed_closed",
      );
    }
    providerAuthorityResolved = true;
  } catch {
    console.warn(JSON.stringify({
      at: "voice-llm-adapter",
      buildId: BUILD_ID,
      reason: "organization_authority_lookup_unavailable",
    }));
    if (turnClaimed && claimedOrganizationId) {
      await markVoiceTurnUncertain(supabase, {
        organizationId: claimedOrganizationId,
        callId: turn.callId,
        turnId: turn.turnId,
      });
      return finishImmediate(
        buildSilentVoiceResponse(model, request.stream),
        "authority_gate",
        "uncertain_suppressed",
      );
    }
    return finishImmediate(
      buildAuthorityBlockedResponse(
        model,
        request.stream,
        "lookup_unavailable",
      ),
      "authority_gate",
      "failed_closed",
    );
  }

  // ---- Rollout gate ------------------------------------------------------
  const decision = selectRoute({
    syntheticTestHeader: req.headers.get("x-bluladder-synthetic-test"),
    callerIdE164: request.callerIdE164,
    trustedProviderAuthorityResolved: providerAuthorityResolved,
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
    const finishControllerSuppressed = (
      route: VoiceTurnLatencyRoute,
      outcome: VoiceTurnLatencyOutcome,
    ) => {
      latency.mark("firstResponseChunkMs");
      emitVoiceTurnLatency(latency.finish({ route, outcome }));
    };

    const runControllerTurn = async (): Promise<ControllerStreamResult> => {
      try {
        const route = await executeControllerRoute({
          supabase,
          conversationId: identity.conversationId,
          organizationId: organizationAuthority.organizationId,
          organizationAuthority,
          callId: request.sessionId,
          turnId: turn.turnId,
          turnPosition: turn.position,
          contentHash: turn.contentHash,
          messages: request.messages,
          journalMessages: providerMessagesForJournal,
          callerIdE164: request.callerIdE164,
          runTool: (name, context, body) =>
            runClaimedExternalAction(supabase, {
              organizationId: organizationAuthority.organizationId,
              callId: turn.callId,
              turnId: turn.turnId,
              actionKey: `tool:${name}`,
              run: () => runTool(name, context, body),
              uncertain: () => ({
                status: "uncertain",
                message:
                  "The provider outcome could not be confirmed and will not be retried automatically.",
              }),
            }),
          callFunction: (name, body) =>
            runClaimedExternalAction(supabase, {
              organizationId: organizationAuthority.organizationId,
              callId: turn.callId,
              turnId: turn.turnId,
              actionKey: `edge:${name}`,
              run: () =>
                callInternalQuoteFunction(supabaseUrl, serviceKey, name, body),
              uncertain: () => ({
                status: 503,
                json: { status: "uncertain", retryable: false },
              }),
            }),
        });
        latency.mark("controllerCompletedMs");
        latency.mark("persistenceCompletedMs");
        latency.add(
          "deterministicControllerMs",
          route.timings.controllerMs,
        );
        latency.add("conversationSessionLoadMs", route.timings.sessionLoadMs);
        latency.add("pricingMs", route.timings.pricingMs);
        latency.add(
          "addressIdentityMs",
          route.timings.addressServiceAreaMs +
            route.timings.identityPreparationMs,
        );
        latency.add("externalToolMs", route.timings.externalToolMs);
        const persistenceMs = route.timings.persistenceMs +
          route.timings.projectionMs + route.timings.journalMs;
        latency.add("persistenceMs", persistenceMs);
        latency.add(
          "databaseMs",
          route.timings.sessionLoadMs + persistenceMs,
        );
        const spoken = route.spoken;
        console.log(JSON.stringify({
          at: "voice-llm-adapter",
          buildId: BUILD_ID,
          correlationId,
          route: "controller",
          event: route.event,
          preKind: route.pre.kind,
          replyLen: spoken.length,
          stream: request.stream,
          projectionStatus: route.projection?.status ?? null,
          identityPreparationStatus: route.identityPreparation?.status ?? null,
          journal: {
            written: route.journal.written,
            duplicates: route.journal.duplicates,
            failed: route.journal.failed,
            reason: route.journal.reason ?? null,
          },
          timings: {
            requestToControllerCompletionMs: Math.max(
              0,
              Math.round(performance.now() - requestArrival),
            ),
            ...route.timings,
          },
        }));
        const completionStarted = performance.now();
        await completeVoiceTurn(supabase, {
          organizationId: organizationAuthority.organizationId,
          callId: turn.callId,
          turnId: turn.turnId,
        });
        // Re-read immediately before canonical content is emitted. A newer
        // committed turn revokes this turn's authority after the harmless role
        // delta/neutral acknowledgement but before any business response.
        const authoritative = await isAuthoritativeVoiceTurn(supabase, {
          organizationId: organizationAuthority.organizationId,
          callId: turn.callId,
          turnId: turn.turnId,
        });
        latency.add("databaseMs", performance.now() - completionStarted);
        if (!authoritative) {
          console.log(JSON.stringify({
            at: "voice-llm-adapter",
            buildId: BUILD_ID,
            correlationId,
            route: "single_flight",
            reason: "stale_suppressed",
          }));
          finishControllerSuppressed(
            "single_flight",
            "stale_suppressed",
          );
          return { status: "suppressed" };
        }
        return {
          status: "speak",
          spoken,
          metadata: { event: route.event },
        };
      } catch {
        console.warn(JSON.stringify({
          at: "voice-llm-adapter",
          buildId: BUILD_ID,
          route: "controller",
          reason: "workflow_controller_failed_closed",
        }));
        console.log(JSON.stringify({
          at: "voice-llm-adapter",
          buildId: BUILD_ID,
          correlationId,
          route: "controller",
          reason: "uncertain_suppressed",
        }));
        // The claim is terminal after an unknown execution outcome. An
        // external action may have crossed its provider boundary, so emit and
        // retry none.
        await markVoiceTurnUncertain(supabase, {
          organizationId: organizationAuthority.organizationId,
          callId: turn.callId,
          turnId: turn.turnId,
        });
        finishControllerSuppressed(
          "controller",
          "uncertain_suppressed",
        );
        return { status: "suppressed" };
      }
    };

    if (!request.stream) {
      const result = await runControllerTurn();
      if (result.status !== "speak") {
        return buildSilentVoiceResponse(model, false);
      }
      const event = result.metadata?.event;
      const completion = {
        content: result.spoken,
        action: { kind: "speak" as const },
        orchestrator: {
          reply: result.spoken,
          toolEvents: [],
          events: event ? [event] : [],
          state: "workflow_controller" as const,
          voice: { type: "speak" as const },
        },
      };
      return finishImmediate(
        buildNonStreamingResponse(model, completion),
        "controller",
        "responded",
      );
    }

    // Return the SSE response immediately. The role frame establishes the
    // stream; canonical business content remains gated by controller
    // completion and the final authoritative-turn re-read.
    return buildControllerStreamResponse({
      model,
      buildId: BUILD_ID,
      headers: corsHeaders,
      run: runControllerTurn,
      lifecycle: {
        onFirstChunk: () => latency.mark("firstResponseChunkMs"),
        onComplete: (status) => {
          emitVoiceTurnLatency(latency.finish({
            route: "controller",
            outcome: status === "speak" ? "responded" : "uncertain_suppressed",
          }));
        },
      },
    });
  }

  // All accepted Vapi traffic reaches this point with reconciled provider
  // authority. It may use the deterministic controller or fail closed, but it
  // must never execute the competing legacy quote/action workflow. The legacy
  // adapter remains available only to explicitly non-mapped compatibility
  // callers outside this authority-gated production ingress.
  // The compatibility path has no durable claim-aware tool boundary.
  if (turnClaimed) {
    await markVoiceTurnUncertain(supabase, {
      organizationId: organizationAuthority.organizationId,
      callId: turn.callId,
      turnId: turn.turnId,
    });
    return finishImmediate(
      buildSilentVoiceResponse(model, request.stream),
      "single_flight",
      "uncertain_suppressed",
    );
  }
  if (!legacyVoiceExecutionAllowed(decision, providerAuthorityResolved)) {
    return finishImmediate(
      buildAuthorityBlockedResponse(
        model,
        request.stream,
        "deterministic_controller_required",
      ),
      "authority_gate",
      "failed_closed",
    );
  }

  // Legacy compatibility branch. Reconciled mapped production traffic cannot
  // reach it; it remains only for isolated non-mapped compatibility callers.
  if (!request.stream) {
    const completion = await runVoiceAdapter({
      supabase,
      request,
      organizationId: organizationAuthority.organizationId,
      conversationId: identity.conversationId,
      sessionToken: identity.sessionToken,
    });
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
          organizationId: organizationAuthority.organizationId,
          conversationId: identity.conversationId,
          sessionToken: identity.sessionToken,
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
