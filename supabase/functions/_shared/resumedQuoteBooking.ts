export interface ResumedQuoteBookingInput {
  resumedQuoteId?: unknown;
  resumedQuoteToken?: unknown;
  confirmedTotal?: unknown;
}

export type ParsedResumedQuoteBooking =
  | { kind: "none" }
  | { kind: "invalid" }
  | {
    kind: "valid";
    quoteId: string;
    resumeToken: string;
    confirmedTotal: number;
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export function parseResumedQuoteBooking(
  input: ResumedQuoteBookingInput,
): ParsedResumedQuoteBooking {
  const hasAny = input.resumedQuoteId !== undefined ||
    input.resumedQuoteToken !== undefined ||
    input.confirmedTotal !== undefined;
  if (!hasAny) return { kind: "none" };

  const quoteId = typeof input.resumedQuoteId === "string"
    ? input.resumedQuoteId
    : "";
  const resumeToken = typeof input.resumedQuoteToken === "string"
    ? input.resumedQuoteToken
    : "";
  const confirmedTotal = Number(input.confirmedTotal);

  if (
    !UUID_PATTERN.test(quoteId) ||
    !CAPABILITY_PATTERN.test(resumeToken) ||
    !Number.isFinite(confirmedTotal) ||
    confirmedTotal < 0
  ) {
    return { kind: "invalid" };
  }

  return { kind: "valid", quoteId, resumeToken, confirmedTotal };
}

export function isResumedQuoteBookable(
  status: unknown,
  expiresAt: unknown,
  nowMs = Date.now(),
): boolean {
  if (
    status !== "pending" &&
    status !== "viewed" &&
    status !== "emailed" &&
    status !== "saved"
  ) {
    return false;
  }

  if (typeof expiresAt === "string") {
    const expiryMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) return false;
  }

  return expiresAt === null || expiresAt === undefined ||
    typeof expiresAt === "string";
}
