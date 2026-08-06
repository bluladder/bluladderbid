// ============================================================================
// Privacy-safe latency recorder for one authoritative voice turn.
//
// Only a deterministic opaque correlation UUID, allow-listed route/outcome
// labels, numeric monotonic offsets, and numeric duration buckets are emitted.
// Raw call/turn ids, phones, addresses, transcripts, credentials, and customer
// data are never accepted by the event shape.
// ============================================================================

import { deterministicUuid } from "../deterministicUuid.ts";
import { voiceLatencyEnabled } from "../voiceLatencyMetrics.ts";

export const VOICE_TURN_LATENCY_VERSION = "voice-turn-latency-v1";
const MAX_PROVIDER_DELAY_MS = 10 * 60 * 1000;

export type VoiceTurnLatencyRoute =
  | "controller"
  | "authority_gate"
  | "single_flight"
  | "unknown";

export type VoiceTurnLatencyOutcome =
  | "responded"
  | "duplicate_suppressed"
  | "stale_suppressed"
  | "wait_suppressed"
  | "uncertain_suppressed"
  | "failed_closed";

export type VoiceTurnLatencyMilestone =
  | "providerEventReceivedMs"
  | "finalUserTurnReceivedMs"
  | "singleFlightClaimedMs"
  | "conversationSessionLoadedMs"
  | "controllerCompletedMs"
  | "persistenceCompletedMs"
  | "firstResponseChunkMs"
  | "responseCompletedMs";

export type VoiceTurnLatencyDuration =
  | "providerTranscriptionMs"
  | "singleFlightMs"
  | "conversationSessionLoadMs"
  | "databaseMs"
  | "deterministicControllerMs"
  | "pricingMs"
  | "addressIdentityMs"
  | "externalToolMs"
  | "persistenceMs"
  | "applicationToFirstChunkMs"
  | "applicationTotalMs";

export interface VoiceTurnLatencyEvent {
  at: "voice-turn-latency";
  version: typeof VOICE_TURN_LATENCY_VERSION;
  correlationId: string;
  channel: "voice";
  route: VoiceTurnLatencyRoute;
  outcome: VoiceTurnLatencyOutcome;
  stream: boolean;
  milestones: Partial<Record<VoiceTurnLatencyMilestone, number>>;
  durations: Partial<Record<VoiceTurnLatencyDuration, number | null>>;
}

export async function buildVoiceTurnCorrelationId(
  authoritativeTurnId: string,
): Promise<string> {
  return await deterministicUuid(
    "voice-turn-latency-correlation",
    authoritativeTurnId,
    VOICE_TURN_LATENCY_VERSION,
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function parsedTimestamp(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

/**
 * Read only known provider timestamp slots. This value is telemetry, never
 * authority. Unknown or future payload shapes remain explicitly unmeasured.
 */
export function extractProviderFinalUserTurnAtMs(body: unknown): number | null {
  const root = object(body);
  const messages = Array.isArray(root.messages) ? root.messages : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = object(messages[index]);
    if (message.role !== "user" && message.role !== "customer") continue;
    const value = parsedTimestamp(
      message.timestamp ?? message.createdAt ?? message.created_at,
    );
    if (value !== null) return value;
  }
  const metadata = object(root.metadata);
  return parsedTimestamp(
    metadata.finalUserTurnAt ?? metadata.transcriptEndAt,
  );
}

export class VoiceTurnLatencyRecorder {
  readonly #correlationId: string;
  readonly #stream: boolean;
  readonly #originMs: number;
  readonly #now: () => number;
  readonly #milestones: Partial<
    Record<VoiceTurnLatencyMilestone, number>
  > = { providerEventReceivedMs: 0 };
  readonly #durations: Partial<
    Record<VoiceTurnLatencyDuration, number | null>
  > = {};
  #finished = false;

  constructor(args: {
    correlationId: string;
    stream: boolean;
    originMs: number;
    receivedWallClockMs: number;
    providerFinalUserTurnAtMs?: number | null;
    now?: () => number;
  }) {
    this.#correlationId = args.correlationId;
    this.#stream = args.stream;
    this.#originMs = args.originMs;
    this.#now = args.now ?? (() => performance.now());
    const providerAt = args.providerFinalUserTurnAtMs ?? null;
    const delay = providerAt === null
      ? null
      : args.receivedWallClockMs - providerAt;
    this.#durations.providerTranscriptionMs = delay !== null && delay >= 0 &&
        delay <= MAX_PROVIDER_DELAY_MS
      ? Math.round(delay)
      : null;
  }

  offset(at = this.#now()): number {
    return Math.max(0, Math.round(at - this.#originMs));
  }

  mark(name: VoiceTurnLatencyMilestone, at = this.#now()): void {
    if (this.#milestones[name] === undefined) {
      this.#milestones[name] = this.offset(at);
    }
  }

  add(name: VoiceTurnLatencyDuration, durationMs: number): void {
    if (!Number.isFinite(durationMs)) return;
    const duration = Math.max(0, Math.round(durationMs));
    const current = this.#durations[name];
    this.#durations[name] = typeof current === "number"
      ? current + duration
      : duration;
  }

  finish(args: {
    route: VoiceTurnLatencyRoute;
    outcome: VoiceTurnLatencyOutcome;
  }): VoiceTurnLatencyEvent | null {
    if (this.#finished) return null;
    this.#finished = true;
    this.mark("responseCompletedMs");
    const first = this.#milestones.firstResponseChunkMs;
    const user = this.#milestones.finalUserTurnReceivedMs;
    const completed = this.#milestones.responseCompletedMs;
    if (first !== undefined && user !== undefined) {
      this.#durations.applicationToFirstChunkMs = Math.max(0, first - user);
    }
    if (completed !== undefined && user !== undefined) {
      this.#durations.applicationTotalMs = Math.max(0, completed - user);
    }
    return {
      at: "voice-turn-latency",
      version: VOICE_TURN_LATENCY_VERSION,
      correlationId: this.#correlationId,
      channel: "voice",
      route: args.route,
      outcome: args.outcome,
      stream: this.#stream,
      milestones: { ...this.#milestones },
      durations: { ...this.#durations },
    };
  }
}

export function emitVoiceTurnLatency(
  event: VoiceTurnLatencyEvent | null,
  env?: Record<string, string | undefined>,
): void {
  if (!event || !voiceLatencyEnabled(env)) return;
  try {
    console.log(JSON.stringify(event));
  } catch { /* telemetry must never change the call */ }
}
