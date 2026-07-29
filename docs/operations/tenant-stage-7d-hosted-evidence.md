# Stage 7D hosted evidence register

Captured 2026-07-28 against production project
`gyndziiuizpgwhqwyrvn` using `BEGIN TRANSACTION READ ONLY` and `ROLLBACK`.
No customer rows, secrets, credential-bearing URLs, or complete cron commands
are retained.

## Identity and counts

- PostgreSQL 17.6, primary database, `transaction_read_only=on`.
- 145 hosted migration-ledger rows; last version `20260726194719`.
- Independent version/name fingerprint:
  `73ed8522db78e51049a421e1f72b18c3`.
- First-wave counts: 16 customers, 10 properties, 2 quotes, 2 bookings.
- All first-wave `organization_id` columns are absent.
- One platform role (`admin`) maps deterministically to DFW `admin`.
- Zero storage buckets and zero storage policies.

## Evidence fingerprints

- Stage 7C core SQL SHA-256:
  `520f5de9b16920c04840cd9f7c1334e890fafb2899989e623946801b61d29a23`
- Stage 7C optional SQL SHA-256:
  `692f7743bc378f30c309b7123bf715d20c026b1ca3efed7a1b754625e65d870a`
- Stage 7B migration SHA-256:
  `b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca`
- Cron job 3 command MD5: `1a1b5b332626f37867e3521d2052f56b`
- Cron job 5 command MD5: `88e143e3876903e839e7551f68dd179b`
- Cron job 6 command MD5: `ad8c290523e2659a608e7fcb7d57bcb7`
- Hosted-only `20260128005316` statement MD5:
  `caac83d911c70e3f539cc2230dd8586b`; its single statement mentions
  `big_job_settings`, `eligibility_rules`, and `schedule_blocks`.

MD5 cron fingerprints are change detectors, not security hashes.

## Evidence handling

The machine reconciliation records repository SQL MD5 and SHA-256 values.
Hosted SQL hashes were compared without retaining complete hosted statements.
Function definitions were retained only for the three named security-review
targets. Cron evidence is reduced to schedule, destination function,
authentication class, boolean credential/tenant markers, and command
fingerprint.

Any rerun must:

1. Verify project ref independently.
2. Assert `transaction_read_only=on`.
3. Use only the reviewed Stage 7C/7D SELECT queries.
4. Redact credential-bearing values in SQL before results leave the database.
5. Stop on a changed fingerprint or unrecognized migration.
