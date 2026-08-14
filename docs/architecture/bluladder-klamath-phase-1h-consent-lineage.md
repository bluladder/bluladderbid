# BluLadder Klamath Phase 1H consent lineage preflight

Status: **read-only hosted preflight prepared; no migration or runtime change**.
Klamath remains provisioning and may not send customer traffic.

## Problem boundary

`communication_consent` currently keys SMS and email decisions globally by
recipient identity and consent type. Its audit events inherit only a consent ID.
That shape cannot safely authorize a second organization: a Klamath decision
must not read, overwrite, or satisfy DFW consent, and DFW must not become a
fallback when Klamath organization authority is missing.

Platform-wide legal safety suppression remains separate and continues to take
precedence. Phase 1H concerns organization-owned affirmative consent and its
audit lineage; it does not weaken global STOP, opt-out, or test-identity gates.

## Preflight contract

The exact read-only SQL file is
`supabase/preflight/bluladder_klamath_phase_1h_consent_lineage.sql`. It runs in
a read-only transaction with bounded statement and lock timeouts and rolls back.
The reviewed artifact is 10,235 bytes with SHA-256
`36af87ed6805086b671c9ede90e09554f4f2dff408b6c0fae4cfd0a157fb8100`.
It returns only aggregate, non-PII evidence:

- six prerequisite tables and the current absence of target lineage columns;
- legacy and future organization-aware function presence;
- exact DFW default and provisioning Klamath organization state;
- consent/event counts, parent coverage, orphan and cross-parent conflicts;
- non-DFW parent count and projected organization-scoped identity collisions;
- zero Klamath customer, conversation, booking, and projected-consent state;
- existing RLS and policy counts for both consent tables.

The preflight never reads secret values, emits recipient identities, or changes
the migration ledger. A future migration may be designed only after hosted
results prove that parent derivation and bounded DFW compatibility are exact.

## Fail-closed next step

The later migration must add organization lineage to consent and audit rows,
replace global identity uniqueness with organization-scoped uniqueness, and
introduce organization-aware record/read functions. Every runtime caller must
pass persisted server-derived organization authority. Missing, ambiguous,
or conflicting authority must fail before a consent write or provider action.

No migration, connector, credential, sender, deployment, call, email, SMS,
customer traffic, or activation is authorized by this preparation.
