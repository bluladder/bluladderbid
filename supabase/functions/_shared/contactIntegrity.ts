// ============================================================================
// contactIntegrity.ts — leaf module (no imports) for strict contact
// normalization and provenance protection.
//
// Incident 019fb423-7a5b-7990-98fe-6e7db8062f50: a controller-confirmed caller
// ID (+14692150144) was clobbered by legacy transcript extraction that picked
// up the last four digits ("0144") from the assistant's own confirmation
// prompt and stored the fabricated value "+0144".
//
// Rules enforced here:
//   1. Only valid US/Canada E.164 candidates are ever produced: 10 digits =>
//      +1XXXXXXXXXX, or 11 digits beginning with 1 => +1XXXXXXXXXX. Anything
//      shorter/longer yields null. We never fabricate a "+" + digits value.
//   2. Once a phone is explicitly confirmed, lower-provenance extraction can
//      never replace it with a different number.
// ============================================================================

/** Strict US/Canada E.164 normalization. Returns null for anything that is not
 *  a plausible 10-digit NANP number (optionally with a leading country 1). */
export function normalizeUsCaE164(phone?: string | null): string | null {
  if (phone === null || phone === undefined) return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  // Reject explicit non-NANP international input rather than mangling it.
  if (raw.startsWith("+") && !/^\+1/.test(raw) && raw.replace(/\D/g, "").length !== 10) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return null;
}

/** True when the value is already a full, valid NANP E.164 string. */
export function isFullE164(phone?: string | null): boolean {
  return typeof phone === "string" && /^\+1[2-9][0-9]{9}$/.test(phone);
}

/**
 * Decide the phone that should be stored.
 *
 * - Invalid candidates (e.g. "0144", "144", "") are discarded outright.
 * - A confirmed existing phone wins over any unconfirmed candidate.
 * - Otherwise the newest valid candidate wins.
 */
export function resolvePhone(args: {
  existing?: string | null;
  existingConfirmed?: boolean;
  candidate?: string | null;
  candidateConfirmed?: boolean;
}): string | null {
  const existing = normalizeUsCaE164(args.existing) ?? (isFullE164(args.existing) ? args.existing! : null);
  const candidate = normalizeUsCaE164(args.candidate);
  if (!candidate) return existing;
  if (!existing) return candidate;
  if (existing === candidate) return existing;
  if (args.existingConfirmed && !args.candidateConfirmed) return existing;
  return candidate;
}
