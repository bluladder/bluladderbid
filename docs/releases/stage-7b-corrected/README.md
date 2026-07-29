# Stage 7B corrected release candidate

Decision: **NO-GO for hosted execution** until the migration-version policy is
approved. The database security candidate is ready for disposable rehearsal;
no mechanism currently provides exact payload selection, a caller-selected
canonical ledger version, and proven atomic schema-plus-ledger behavior.

## Atomic candidate

The release candidate is deterministic composition, not a modification of the
merged immutable migration:

1. Read the immutable `20260728060000_tenant_foundation_stage_7b.sql`.
2. Remove its terminal `COMMIT`.
3. Append the reviewed forward security correction.
4. Append one terminal `COMMIT`.

This keeps creation, DFW backfill, RLS replacement, grants, and helper hardening
inside one transaction. The vulnerable intermediate policies are never
committed.

| Component | SHA-256 | Bytes |
|---|---|---:|
| Immutable Stage 7B | `b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca` | 12,135 |
| Security correction | `abcc90c9044b32fc02fce5f7c3fd445f91fe4f186c5c8a2ee93007809f3a69d0` | 7,154 |
| Assembled candidate | `8c472bfdaeb0c3952f1d31c300673c365a770f628f646fb4c1133c2bf22ff9a3` | 19,291 |

## Security correction

- Moves authorization helpers into non-exposed `tenant_security`.
- Derives actor identity only from `auth.uid()`.
- Uses `SECURITY DEFINER`, owner `postgres`, fully qualified relations, and
  `search_path=pg_catalog`.
- Revokes schema/function access from `PUBLIC`, `anon`, and `service_role`;
  grants only the authenticated policy path.
- Replaces recursive membership subqueries with hardened helper calls.
- Separates membership INSERT, UPDATE, and DELETE policy intent.
- Restricts tenant admins from granting their own or higher administrative
  role.
- Preserves explicit platform-admin control-plane behavior.
- Grants authenticated membership and resolution-key DML only behind RLS.
- Removes the two-argument caller-selectable helper.
- Changes first-wave RLS from nullable compatibility to fail-closed visibility
  without making the columns `NOT NULL`.

Stage 8A remains excluded. Its migration still references the removed public
helper and must be revised before any later hosted adoption.

## Rehearsal

The CI PostgreSQL 17.6 job assembles the exact candidate, validates its hash,
executes it against a disposable fixture, repeats the complete atomic bundle,
and runs hostile authorization tests. A separate fresh database injects an
error immediately before the sole `COMMIT` and must contain no Stage 7B objects
after failure.

## Execution mechanism decision

`apply_migration` and the Management API are rejected for this candidate:

- neither accepts canonical ledger version `20260728060000`;
- MCP does not expose the API idempotency key or rollback field;
- embedded transaction behavior relative to history recording is undocumented;
- hosted history cannot recover the original payload bytes or SHA-256;
- Management migration endpoints may be restricted to selected partners.

CLI `db push` remains rejected because historical reconciliation selects a
pending set rather than this explicit candidate. Direct `psql` is exact and
atomic but untracked.

The remaining business decision is one of:

1. Approve exact direct execution plus a forward-only provenance record.
2. Continue delaying Stage 7B.
3. Establish a clean future migration baseline and apply tenant foundation
   through that baseline.

No option permits rewriting the hosted ledger.

## Protected commands awaiting a future authorization

These are documentation only and are not authorized:

```bash
node scripts/assemble-stage-7b-release-candidate.mjs \
  /tmp/stage7b-release-candidate.sql

sha256sum /tmp/stage7b-release-candidate.sql

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f /tmp/stage7b-release-candidate.sql
```

The hash must be exactly
`8c472bfdaeb0c3952f1d31c300673c365a770f628f646fb4c1133c2bf22ff9a3`.
Direct execution remains prohibited until its missing ledger provenance is
explicitly accepted and the cron/preflight window receives separate approval.
