// ============================================================================
// voiceLatencyMetrics.ts — sanitized timing instrumentation for the voice
// adapter and orchestrator. Emits ONLY numeric monotonic timings plus a small
// allow-listed set of structural flags. Never emits message content,
// transcript, addresses, customer names, full identifiers, secrets, or full
// monitor/control URLs.
//
// Gated by a dedicated feature flag (VOICE_LATENCY_METRICS=true) so it can be
// enabled independently of the general provider-debug diagnostics.
// ============================================================================

export interface VoiceLatencyEvent {
  at: "voice-latency";
  sessionHash: string;               // sha256(first 16) of synthetic/session id
  channel: "voice";
  route: "fast_knowledge" | "full_orchestrator" | "unknown";
  intentCategory: string;
  ackEmitted: boolean;
  toolInvoked: boolean;
  dispositionType: string | null;
  errorCategory: string | null;
  // Monotonic ms offsets from adapter t0. Absent when not reached.
  t: {
    requestReceived: number;
    authenticated?: number;
    parsed?: number;
    orchestratorInvoked?: number;
    modelRequestStarted?: number;
    firstModelToken?: number;
    firstRoleDelta?: number;
    firstContentDelta?: number;
    orchestratorCompleted?: number;
    finalSseEvent?: number;
    total?: number;
  };
}

export function voiceLatencyEnabled(env?: Record<string, string | undefined>): boolean {
  const e = env ?? readDenoEnv();
  return (e.VOICE_LATENCY_METRICS ?? "").toLowerCase() === "true"
      || (e.VOICE_LATENCY_METRICS ?? "") === "1";
}

function readDenoEnv(): Record<string, string | undefined> {
  try {
    // deno-lint-ignore no-explicit-any
    const d: any = (globalThis as any).Deno;
    if (d && typeof d.env?.get === "function") {
      return { VOICE_LATENCY_METRICS: d.env.get("VOICE_LATENCY_METRICS") ?? undefined };
    }
  } catch { /* ignore */ }
  return {};
}

export async function sessionHash(id: string): Promise<string> {
  const enc = new TextEncoder().encode(id);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

/** Small helper for building a timings recorder from a monotonic origin. */
export function makeClock(): { mark: () => number; since: (t0: number) => number } {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  return {
    mark: () => now(),
    since: (t0: number) => Math.round(now() - t0),
  };
}

export function emitLatencyEvent(ev: VoiceLatencyEvent): void {
  if (!voiceLatencyEnabled()) return;
  try {
    console.log(JSON.stringify(ev));
  } catch { /* never throw from telemetry */ }
}
