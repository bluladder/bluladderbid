// ============================================================================
// customerResolver.ts — idempotent find-or-create for customers/properties.
//
// Called only when the workflow reaches a step that needs a persisted
// customer (booking). Matches by verified phone/email first, then by exact
// address; never creates duplicates on retry. Ambiguous multi-match returns
// a handoff signal instead of silently picking one.
// ============================================================================

// deno-lint-ignore no-explicit-any
type SB = any;

export type ResolveResult =
  | { kind: "resolved"; customerId: string; propertyId?: string | null }
  | { kind: "ambiguous"; matches: string[] }
  | { kind: "not_found" };

export async function resolveCustomer(
  _supabase: SB,
  _args: { phoneE164?: string | null; email?: string | null; address?: string | null },
): Promise<ResolveResult> {
  // TODO(workflow-router-v1 turn C): implement idempotent lookup against
  // customers/properties. Kept as a stub so booking-path tests can inject a
  // resolver mock without pulling in DB.
  return { kind: "not_found" };
}
