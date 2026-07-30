# Stage 7B Lovable-native release candidate

Decision: **GO for a separately authorized controlled Stage 7B database
execution through Lovable Cloud** after every preflight and containment
condition in `operator-runbook.md` passes. Repository material never authorizes
a hosted action.

The owner-operated standard requires one named owner/operator,
`benjamin-millen`. It does not require a second human, an external Ed25519 key,
platform-attested SQL bytes, a platform-generated digest, Git-attested function
deployment identity, or atomic deployment of three functions.

Database security, one-transaction execution, project/environment identity,
read-only preflight and postflight, job containment, fail-forward recovery, and
retained evidence remain mandatory.

## Immutable artifact

- Release ID: `tenant-foundation-stage-7b-lovable-v1`
- Backend: `gyndziiuizpgwhqwyrvn`
- Environment: `Live/production`
- Release source commit: `e8000543d015dec7b6ab16110e4798f596398681`
- Operator: `benjamin-millen`
- Canonical artifact SHA-256:
  `8bb4c57a031831740397339c8023c2da3521473d984de976b5c98836e26b1f9e`
- Transport/file SHA-256:
  `9fe8054a768c2f92ed4f3c9ddbd95eaf0b8d60868cacca1b293f3d84ec4f18e3`
- Bytes: 24,334
- Transaction boundary: one explicit `BEGIN`, one terminal `COMMIT`
- `psql` substitutions: zero

The canonical digest uses one documented normalization: replace the embedded
canonical digest with the assembler token before hashing. A raw file digest
cannot be embedded in the same file without an impossible cryptographic
self-reference, so the manifest also records the ordinary file digest.

The database uses `transaction_timestamp()` for the actual execution timestamp.
All operator, release, project, environment, source, and artifact identities are
immutable SQL constants.

## Failure behavior

Schema changes, 30-row DFW backfill, security correction, and provenance insert
are inside the same transaction. Any error before `COMMIT` rolls them all back.
An ambiguous outcome must be resolved by read-only postflight; never rerun until
the provenance/catalog state is known. Recovery is forward-only. Do not drop
additive objects, erase the backfill, or rewrite migration history.

## Evidence retained

- Git history for the exact artifact and manifest;
- Lovable chat approval history showing the complete reviewed SQL;
- Lovable database logs for the execution window;
- hashed read-only preflight and postflight catalog output;
- the private append-only atomic provenance row.

No hosted action was performed while preparing this package.
