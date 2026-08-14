# BluLadder Klamath Stage 8A authenticated-grant repair

Status: **repository-only repair candidate**. No migration application,
deployment, provider action, secret access, call, message, purchase, activation,
or Lovable credit use is authorized by this artifact.

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

Phase 1C is still unapplied, so its canonical migration is hardened before
first execution: both anonymous and authenticated defaults are revoked before
the exact role grants are installed. Its atomic postflight and read-only
verification require the same least-privilege result.

## Future execution order

1. Review and merge the GitHub-only repair PR under separate authorization.
2. Run the exact read-only hosted preflight for the Stage 8A grant repair.
3. Apply only the forward grant repair under a new exact authorization.
4. Run its read-only postflight and verify the new ledger receipt.
5. Re-run the Phase 1C preflight. Phase 1C remains separately gated.

Do not combine, reorder, replay, or apply these migrations without the matching
authorization and clean hosted evidence.
