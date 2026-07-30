# Stage 7B Lovable Cloud control-plane assessment

Status: **NO-GO for Stage 7B execution**. This document authorizes no hosted
action.

## Production ownership

Production backend `gyndziiuizpgwhqwyrvn` is a Lovable Cloud built-in backend.
Lovable Cloud, not a separately administered Supabase organization, is the
authoritative production control plane. The Supabase-compatible project
reference, URL, client library, schemas, and function layout do not imply
Supabase dashboard, CLI, Management API, MCP, database-password, or direct
`psql` administration.

Official Lovable documentation current at 2026-07-30 establishes these supported
Cloud surfaces:

| Need | Supported Lovable Cloud surface | Release limitation |
|---|---|---|
| Read-only inspection | Cloud Database table/view browser, SQL editor, agent `Read database` permission | Do not browse customer records; use aggregate/catalog-only SQL |
| Schema/policy change | Lovable chat applies reviewed SQL migrations; SQL editor can execute SQL with destructive-statement confirmation | Public docs do not specify an API for submitting an exact repository artifact |
| Edge Functions | Lovable chat writes, deploys, and maintains functions; Cloud Edge functions shows status, code, metrics, URL, and logs | Public docs do not specify a three-function batch, commit-to-deployment attestation, or atomic multi-function deployment |
| Secrets | Cloud Secrets securely stores write-only backend values and injects them into functions | Values cannot be read back; evidence must record names/status only |
| Backend logs | Cloud Logs exposes database, function, auth, storage, cron, PostgREST, and pooling logs, with JSON download | This is operational evidence, not artifact identity |
| Security checks | Project Security view and Cloud database/RLS checks | Automated checks are not a complete security audit |
| Scheduled jobs | Cloud Jobs shows schedules and run history and can Enable/Disable jobs | Disable prevents future runs; public docs do not promise cancellation of a running invocation |
| Project identity | Cloud project information plus Advanced settings (region and Postgres version), repository `.env`, and `supabase/config.toml` | Capture the Lovable project ID/environment and require it to agree with `gyndziiuizpgwhqwyrvn` |

Sources:

- <https://docs.lovable.dev/features/cloud>
- <https://docs.lovable.dev/features/database>
- <https://docs.lovable.dev/features/edge-functions>
- <https://docs.lovable.dev/features/secrets>
- <https://docs.lovable.dev/features/jobs>
- <https://docs.lovable.dev/features/logs>
- <https://docs.lovable.dev/features/security>

## Invalidated assumptions

The direct-execution runbook is retained only as a description of the
candidate's original execution contract. It is not a supported production
runbook for this backend. The following are not release prerequisites:

- Supabase organization ownership or invitation;
- Supabase dashboard, CLI, MCP, Management API, database password, connection
  string, or direct `psql` access;
- `supabase migration list --linked`, `supabase db push`, migration repair, or
  direct inspection/modification of `supabase_migrations.schema_migrations`;
- `supabase functions deploy` and `supabase secrets set`.

## Exact-candidate compatibility

The immutable corrected candidate remains internally valid and unchanged:

- SHA-256:
  `1c1da7314771172e7ab07eb826e6ba54d00b01ae3e2e20db9a3798b0456fdb59`;
- 24,721 bytes;
- one explicit `BEGIN` and one terminal `COMMIT`;
- private append-only `tenant_security.release_provenance` row in the same
  transaction;
- failure before `COMMIT` rolls back schema, backfill, correction, and
  provenance together.

It cannot be submitted unchanged through the documented Lovable Cloud
workflow. The provenance component contains `psql` client substitutions such
as `:'candidate_sha256'`. Those are not PostgreSQL SQL and the documented Cloud
SQL editor has no equivalent variable-binding contract. The documented
reviewed-migration workflow also does not promise:

- byte-for-byte execution of a supplied repository file;
- a recorded SHA-256 for the executed SQL;
- an externally supplied set of provenance values;
- a single transaction spanning Lovable-generated migration handling;
- append-only deployment evidence;
- exclusion of every unrelated migration;
- a supported migration-history table, its fields, or its relationship to
  repository migration filenames.

Therefore the current SQL components and hashes remain useful as the reviewed
source baseline, but the **executable artifact cannot remain unchanged** for
Lovable Cloud. Any Lovable-compatible artifact must replace client
substitutions with immutable SQL literals or another documented binding
mechanism. That changes the assembled bytes and SHA-256 and requires a new
release ID, manifest, rehearsal, evidence template, and validator. Do not
represent Lovable logs or chat/version history as database migration history
without a documented contract.

## Smallest protected phase

Before any migration window, request a **Lovable-mediated, read-only capability
proof** for this exact project. It must not query customer rows. Require written
or captured evidence that Lovable can:

1. identify the Live/production Cloud backend as
   `gyndziiuizpgwhqwyrvn`;
2. execute one supplied SQL unit as one transaction without rewriting it or
   combining unrelated changes;
3. show the exact SQL or digest before approval and durable success/failure
   evidence afterward;
4. support aggregate/catalog-only preflight and postflight queries;
5. state what migration-history record is created and expose it read-only;
6. disable and re-enable the three named Jobs and show running-job state;
7. deploy each named function from the reviewed Git commit and expose a
   deployment/version identity.

If Lovable cannot provide those guarantees, Stage 7B remains NO-GO until a new
Lovable-native migration package is reviewed. Raw SQL-editor execution may be
considered only if Lovable documents or support explicitly confirms the exact
transaction, artifact, evidence, and history behavior; UI availability alone
is insufficient.

Cron pause/drain is required only if the aggregate/catalog preflight confirms
that jobs 3, 5, and 6 can write tables affected by Stage 7B during the
transaction. When required, use Cloud Jobs Disable, verify the three job
identities and no Running entries, execute the approved database phase, then
Enable and verify them. Never pause all of Cloud: that also removes database
and function availability and is not the migration control.

## Secrets and functions

Set `PUBLIC_BOOKING_ENABLED=false` and other server-only values in **Cloud →
Secrets**, never `.env`. Record only the secret name, creation/replacement UTC
time, operator, approval, and successful fail-closed probe; Lovable secrets are
write-only. `SUPABASE_*` and `LOVABLE_*` names are reserved and managed by
Lovable.

The three containment functions are:

- `jobber-create-booking`;
- `jobber-create-service-request`;
- `admin-diagnostics`.

Deploy them through Lovable chat/build from the reviewed Git revision, then use
Cloud → Edge functions to verify code/status, last-updated time, metrics, URL,
and logs. The public documentation does not establish an atomic three-function
deployment or a deployment ID that cryptographically maps to a Git SHA.
Consequently deployment evidence must remain blocked unless Lovable exposes a
version identity sufficient for the repository gate, or the gate is redesigned
around evidence Lovable actually records.

## Approval and infrastructure decisions

Repository history provides no product, legal, contractual, or issue evidence
that two-person approval or an external Ed25519 GO key was requested by the
business. They are defense-in-depth controls introduced by the release package.
They may be retained by an owner decision, but must not be described as
pre-existing business requirements. A single authorized owner approval plus
Lovable workspace audit evidence may be a simpler policy; changing that policy
requires an explicit owner decision, not an agent assumption.

Moving to separately owned Supabase is **not necessary for this launch** and is
unjustified solely to satisfy the invalid runbook. Lovable Cloud is a supported
production backend. Migration is optional later if direct database access,
provider separation, or other operational requirements justify its cost and
risk; it is a separate infrastructure project, not a Stage 7B prerequisite.

No database, secret, function, permission, job, or hosted infrastructure change
was made while producing this assessment.
