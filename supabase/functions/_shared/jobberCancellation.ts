// ---------------------------------------------------------------------------
// Jobber visit-cancellation helpers.
//
// The live Jobber GraphQL schema (version 2025-04-16) exposes:
//
//   visitDelete(visitIds: [EncodedId!]!): VisitDeletePayload
//   type VisitDeletePayload { visits: [Visit!]  userErrors: [MutationErrors!]! }
//
// The OLD (now-removed) form was `visitDelete(visitId: EncodedId!)` returning a
// `deletedVisitId` field. That form is gone and must never be used again.
//
// These helpers are intentionally pure so they can be unit-tested without a live
// Jobber connection. `interpretVisitDelete` decides — fail CLOSED — whether a
// cancellation was genuinely confirmed by Jobber.
// ---------------------------------------------------------------------------

/** Correct plural-form mutation matching the live Jobber schema. */
export const DELETE_VISIT_MUTATION = `
  mutation DeleteVisit($visitIds: [EncodedId!]!) {
    visitDelete(visitIds: $visitIds) {
      visits {
        id
      }
      userErrors {
        message
        path
      }
    }
  }
`;

export interface VisitDeleteUserError {
  message: string;
  path?: string[] | null;
}

export interface VisitDeletePayload {
  visits?: Array<{ id: string }> | null;
  userErrors?: VisitDeleteUserError[] | null;
}

/** Mirror of the shape returned by `jobberGraphQL`. */
export interface VisitDeleteResult {
  data?: { visitDelete?: VisitDeletePayload | null } | null;
  errors?: Array<{ message: string }> | null;
  throttled?: boolean;
}

export type CancelOutcome =
  | "confirmed" // Jobber removed the visit (or it was already gone)
  | "already_gone" // The visit no longer exists in Jobber — treat as success
  | "failed"; // Could not verify removal — must FAIL CLOSED

export interface CancelInterpretation {
  outcome: CancelOutcome;
  /** Technical reason, for server-side logging only — never shown to customers. */
  reason?: string;
}

/**
 * A userError message indicating the visit is already deleted / not found.
 * Deleting a non-existent visit is a safe, idempotent no-op success.
 */
export function isAlreadyGoneMessage(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("couldn't find") ||
    m.includes("could not find") ||
    m.includes("does not exist") ||
    m.includes("doesn't exist") ||
    m.includes("no longer exists") ||
    m.includes("already deleted") ||
    m.includes("already been deleted") ||
    m.includes("has been deleted")
  );
}

/**
 * Decide the true outcome of a `visitDelete` call. Fails CLOSED: anything we
 * cannot positively confirm as a removal is reported as `failed`.
 */
export function interpretVisitDelete(result: VisitDeleteResult | null | undefined): CancelInterpretation {
  if (!result) {
    return { outcome: "failed", reason: "No response from Jobber" };
  }

  // Rate limited after retries — we do not know if it was applied.
  if (result.throttled) {
    return { outcome: "failed", reason: "Jobber rate limited (throttled)" };
  }

  // Top-level transport / GraphQL errors.
  if (result.errors && result.errors.length > 0) {
    return { outcome: "failed", reason: result.errors.map((e) => e.message).join("; ") };
  }

  const payload = result.data?.visitDelete;

  // Missing payload => malformed response. Do NOT assume success.
  if (!payload || typeof payload !== "object") {
    return { outcome: "failed", reason: "Malformed Jobber response: missing visitDelete payload" };
  }

  const userErrors = payload.userErrors ?? [];

  if (userErrors.length > 0) {
    const combined = userErrors.map((e) => e.message).filter(Boolean).join("; ");
    // If every error just says the visit is already gone, treat as idempotent success.
    const allGone = userErrors.every((e) => isAlreadyGoneMessage(e.message || ""));
    if (allGone) {
      return { outcome: "already_gone", reason: combined || "Visit already removed in Jobber" };
    }
    return { outcome: "failed", reason: combined || "Jobber returned userErrors" };
  }

  // No errors and userErrors is an (empty) array => Jobber accepted the deletion.
  return { outcome: "confirmed" };
}
