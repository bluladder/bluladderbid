// ============================================================================
// voiceTransferResolver.ts — server-only human-transfer destination resolver.
//
// The transfer destination is read ONLY from server-side configuration
// (VOICE_HUMAN_TRANSFER_NUMBER). It is never:
//   - placed in the orchestrator prompt
//   - included in the VoiceDisposition
//   - exposed to client code
//   - selected or altered by the language model
//
// Ordinary logs must call maskForLog() so the full number never appears.
// ============================================================================

export type TransferDestinationResult =
  | {
      ok: true;
      destinationE164: string;
      destinationMasked: string;
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "invalid"
        | "self_transfer"
        | "ai_entrance"
        | "provider_did"
        | "retired_number"
        | "known_forwarding_loop";
    };

// The public AI entrance. Transferring to this number would loop the caller
// straight back into the assistant.
export const AI_ENTRANCE_E164 = "+14697472877";

// Retired numbers that must never become a transfer destination even if a
// stale config somehow points at them.
export const RETIRED_TRANSFER_NUMBERS: ReadonlyArray<string> = ["+14692426556"];

// Additional numbers known to forward back into this assistant. Populated as
// they are discovered; used defensively by the loop guard.
export const KNOWN_FORWARDING_LOOP_NUMBERS: ReadonlyArray<string> = [];

export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Accept +1XXXXXXXXXX or 1XXXXXXXXXX or XXXXXXXXXX (bare US number).
  const digits = trimmed.replace(/[^\d+]/g, "");
  let e164 = digits;
  if (/^\d{10}$/.test(digits)) e164 = `+1${digits}`;
  else if (/^1\d{10}$/.test(digits)) e164 = `+${digits}`;
  else if (/^\+1\d{10}$/.test(digits)) e164 = digits;
  else return null;
  return e164;
}

/**
 * Mask a full E.164 to `***-***-LAST4` for ordinary logs. Never log the raw
 * number.
 */
export function maskForLog(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const last4 = digits.slice(-4).padStart(4, "0");
  return `***-***-${last4}`;
}

export interface ResolveTransferOptions {
  /** Env-lookup override; defaults to Deno.env.get("VOICE_HUMAN_TRANSFER_NUMBER"). */
  getEnv?: (name: string) => string | undefined;
  /** The current inbound caller ANI, if known. Rejected as a self-transfer. */
  currentCallerAni?: string | null;
  /** The Vapi/provider receiving DID for the call, if known. Rejected to
   *  prevent a transfer back into the assistant leg. */
  providerDid?: string | null;
  /** Additional loop numbers to reject for this call. Merged with
   *  KNOWN_FORWARDING_LOOP_NUMBERS. */
  extraLoopNumbers?: ReadonlyArray<string>;
}

export function resolveTransferDestination(opts: ResolveTransferOptions = {}): TransferDestinationResult {
  const getEnv = opts.getEnv ?? ((n) => {
    try {
      // Deno is available in edge functions; fall back to process.env for tests
      // that run under Node.
      // deno-lint-ignore no-explicit-any
      const d = (globalThis as any).Deno;
      if (d?.env?.get) return d.env.get(n);
    } catch { /* ignore */ }
    // deno-lint-ignore no-explicit-any
    return (globalThis as any).process?.env?.[n];
  });

  const raw = getEnv("VOICE_HUMAN_TRANSFER_NUMBER");
  if (!raw) return { ok: false, reason: "missing" };
  const e164 = normalizeE164(raw);
  if (!e164) return { ok: false, reason: "invalid" };

  if (RETIRED_TRANSFER_NUMBERS.includes(e164)) {
    return { ok: false, reason: "retired_number" };
  }
  if (e164 === AI_ENTRANCE_E164) return { ok: false, reason: "ai_entrance" };

  const caller = normalizeE164(opts.currentCallerAni ?? null);
  if (caller && caller === e164) return { ok: false, reason: "self_transfer" };

  const providerDid = normalizeE164(opts.providerDid ?? null);
  if (providerDid && providerDid === e164) return { ok: false, reason: "provider_did" };

  const loopNumbers = new Set<string>([
    ...KNOWN_FORWARDING_LOOP_NUMBERS,
    ...(opts.extraLoopNumbers ?? []),
  ]);
  if (loopNumbers.has(e164)) return { ok: false, reason: "known_forwarding_loop" };

  return { ok: true, destinationE164: e164, destinationMasked: maskForLog(e164) };
}