# BluLadder Klamath Stage 8A authenticated-grant repair

Status: **applied and verified**. Hosted execution version `20260814045913` is
recorded by a provider-generated receipt that differs from the canonical repair
only by its removed terminal line feed. No deployment, provider action, secret
access, call, message, purchase, or activation is authorized by this record.

## Observed hosted state

The Stage 8A compatibility migration was applied through Lovable as execution
version `20260814035656`. Lovable committed two generated repository artifacts:

- the execution receipt at
  `supabase/migrations/20260814035656_f333948e-a5c5-4e5a-9958-b4ed1ee77dc2.sql`;
  it is byte-identical to the canonical migration after removal of the
  canonical file's terminal line feed; and
- regenerated Supabase TypeScript definitions containing exactly the four new
  Stage 8A table contracts.

Those generated artifacts are authoritative evidence and must not be reverted
or replayed. The canonical applied migration also remains immutable.

## Root cause and repair

The hosted project applies broad default table privileges at creation time.
The Stage 8A migration revoked anonymous access, then granted the intended CRUD
set to `authenticated`; PostgreSQL grants are additive, so the pre-existing
`REFERENCES`, `TRIGGER`, and `TRUNCATE` privileges remained.

The forward repair accepts only the exact observed seven-privilege state on all
four Stage 8A tables. It revokes authenticated access and restores only
`SELECT`, `INSERT`, `UPDATE`, and `DELETE`. It preserves the exact anonymous,
service-role, RLS, policy, DFW, Oregon-test, and pre-Phase-1C state.

Phase 1C was still unapplied when its canonical migration was hardened before
first execution: both anonymous and authenticated defaults are revoked before
the exact role grants are installed. Its atomic postflight and read-only
verification require the same least-privilege result.

## Execution evidence

The exact read-only preflight passed, the forward repair applied once, and the
exact postflight confirmed CRUD-only authenticated grants on all four tables.
Anonymous access remained absent, service-role access remained complete, RLS
and policy counts stayed exact, and DFW/Oregon fingerprints were unchanged.
The Phase 1C preflight then passed and its inactive foundation was applied in a
separate migration-aware action.

Do not replay or rewrite these immutable migrations or their execution receipts.
