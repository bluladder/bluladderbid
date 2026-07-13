// ============================================================================
// Canonical test-cleanup logic.
//
// Historically, controlled end-to-end verification runs removed their scratch
// data with broad statements (e.g. "DELETE FROM test_identities"). One such
// broad cleanup wiped the OWNER-APPROVED PERMANENT test identity, silently
// disabling first-class system-test suppression for a real recipient.
//
// This module is the single source of truth for what a cleanup pass is allowed
// to delete. It NEVER returns a protected identity as deletable. Every future
// test-cleanup routine MUST partition rows through here before deleting.
//
// A defense-in-depth DB trigger (trg_protect_test_identity) additionally skips
// deletion of protected rows at the database level, so even a raw broad DELETE
// can no longer remove the approved identity.
// ============================================================================

export interface TestIdentityRow {
  id: string;
  email?: string | null;
  phone?: string | null;
  protected?: boolean | null;
  // Temporary verification rows are typically tagged; anything without a
  // protection flag and matching a temp marker is safe to remove.
  note?: string | null;
}

/** A protected identity is permanent configuration and is NEVER deletable. */
export function isProtectedTestIdentity(row: TestIdentityRow): boolean {
  return row.protected === true;
}

/** Only non-protected (temporary) verification records may be deleted. */
export function isDeletableTestIdentity(row: TestIdentityRow): boolean {
  return !isProtectedTestIdentity(row);
}

/**
 * Partition test-identity rows into the temporary records a cleanup pass may
 * delete and the permanent records it must preserve. Cleanup routines should
 * delete ONLY `deletable` (by id) and never issue an unscoped delete.
 */
export function partitionTestIdentitiesForCleanup(rows: TestIdentityRow[]): {
  deletable: TestIdentityRow[];
  preserved: TestIdentityRow[];
} {
  const deletable: TestIdentityRow[] = [];
  const preserved: TestIdentityRow[] = [];
  for (const row of rows) {
    (isDeletableTestIdentity(row) ? deletable : preserved).push(row);
  }
  return { deletable, preserved };
}
