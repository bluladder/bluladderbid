# Stage 7B Lovable Cloud owner-operator runbook

Status: protected instructions only. The repository does not authorize these
actions.

## Exact protected sequence

1. **Request the first authorization.** Use the exact request at the end of this
   runbook. Stop until the owner authorization ID is recorded.
2. **Confirm Live identity.** Open BluLadder Bid → More → Cloud → Overview and
   confirm Live/production. In Code, confirm `.env`
   `VITE_SUPABASE_PROJECT_ID=gyndziiuizpgwhqwyrvn` and
   `supabase/config.toml` has the same project ID. Ask Lovable to read project
   configuration only and confirm the attached built-in backend ref. Stop on
   ambiguity.
3. **Set containment.** More → Cloud → Secrets. Add or replace
   `PUBLIC_BOOKING_ENABLED` with exact value `false`. Never retain the value in
   evidence. Confirm the secret-name metadata and UTC time.
4. **Run read-only preflight.** Through MCP `query_database`, submit each query
   from `supabase/preflight/tenant_stage_7b_lovable_mcp.json` separately and in
   order. Each call must contain exactly one `SELECT`; do not submit the legacy
   transaction batch through MCP. It must return the pinned ledger, 16/10/2/2 first-wave
   counts, absent Stage 7B objects/columns, one platform role, exact job
   fingerprints, and zero Running job 3/5/6 executions. Stop on any mismatch.
5. **Identify jobs.** More → Cloud → Jobs. Open jobs 3, 5, and 6. Match IDs,
   schedules, enabled state, and command fingerprints from preflight. Do not
   expose command text.
6. **Disable jobs sequentially.** Disable 3, then 5, then 6. Refresh each job
   and its run history. Require Disabled and no `Running` entry for all three.
   If any run is active, wait within the authorized window; do not cancel it.
7. **Review the complete candidate.** In Lovable chat attach only
   `supabase/release-candidates/20260730061000_tenant_foundation_stage_7b_lovable.sql`.
   Ask Lovable to prepare one database migration and show the complete SQL
   approval card without executing. Compare it visually with the Git artifact;
   require one `BEGIN`, one `COMMIT`, the release/project/operator constants,
   no `psql` substitutions, and no unrelated migration. Retain the chat
   approval history.
8. **Approve once.** Confirm the approval card targets Live backend
   `gyndziiuizpgwhqwyrvn`, then approve exactly once. Do not retry an error or
   disconnect. Retain start/finish UTC, status, and database-log export.
9. **Run read-only postflight.** Ask Lovable to execute only
   `supabase/verification/tenant_stage_7b_lovable_postflight.sql`. Require
   unchanged legacy ledger, zero nulls/mismatches, four validated FKs, one
   active canonical DFW organization, zero active Oregon, exact provenance,
   private ACLs, corrected RLS/helpers/triggers, and unchanged job fingerprints.
10. **Restore jobs sequentially.** Enable 3, then 5, then 6. Refresh. Require
    each Enabled with its original schedule and no unexpected backlog/error.
11. **Validate evidence.** Populate `evidence-template.json`, hash the retained
    files, and run
    `node scripts/validate-stage-7b-lovable-evidence.mjs <evidence.json>`.
12. **Deploy functions sequentially under a separate deployment
    authorization.** Keep public booking false. Ask Lovable to deploy from the
    reviewed Git state in this order:
    `jobber-create-booking`, `jobber-create-service-request`,
    `admin-diagnostics`. After each deployment, open More → Cloud → Edge
    functions, verify status and last-updated time, use View code to compare the
    named function with Git, and retain function/log screenshots. Run only
    non-customer, non-mutating disabled probes. Stop before the next function on
    any mismatch.

## Abort and rollback

- Before approval: make no database change; restore any disabled jobs.
- SQL error before commit: PostgreSQL rolls back the entire candidate. Confirm
  by read-only postflight before restoring jobs.
- Ambiguous result: do not retry. Keep public booking false and jobs disabled
  until read-only catalog/provenance inspection determines the outcome.
- Postflight failure after commit: keep public booking false, restore jobs only
  when safe, open an incident, and prepare a separately reviewed forward repair.
- Never delete the provenance row, erase backfill, drop additive Stage 7B
  objects, or repair/rewrite migration history ad hoc.

## Exact first authorization request

> Authorize one owner-operated protected capability window for BluLadder Bid
> Stage 7B on Lovable Cloud Live backend `gyndziiuizpgwhqwyrvn`, operated by
> `benjamin-millen`, using release
> `tenant-foundation-stage-7b-lovable-v1` from source commit
> `e8000543d015dec7b6ab16110e4798f596398681` and canonical artifact SHA-256
> `8bb4c57a031831740397339c8023c2da3521473d984de976b5c98836e26b1f9e`.
> Scope: confirm Live identity; set `PUBLIC_BOOKING_ENABLED=false`; run the
> pinned read-only preflight; disable and drain only jobs 3, 5, and 6; review
> the complete SQL approval card; approve the migration exactly once; run the
> pinned read-only postflight; restore those jobs; and retain Lovable approval
> history, Git artifact history, database logs, catalog outputs, and atomic
> provenance evidence. This authorization does not enable public booking,
> deploy Edge Functions, activate Oregon, query customer rows, rewrite
> migration history, or authorize any unrelated migration. Record the owner
> authorization ID and UTC window before any protected action.
