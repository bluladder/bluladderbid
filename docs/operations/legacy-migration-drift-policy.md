# Legacy migration drift policy

Decision owner: pending production-owner signature.

Decision: production migration history will not be rewritten merely to align
legacy repository filenames and hosted timestamps.

## Policy

1. Hosted state predates reliable repository migration provenance.
2. Hosted ledger rows and repository filenames are not one-to-one identities.
3. Historical ledger insertion, deletion, renaming, or alias remapping is
   prohibited without cryptographic or complete SQL-equivalence evidence.
4. Hosted schema and durable behavior are the operational source of truth for
   legacy objects.
5. Repository reconciliation records are evidence and exceptions, not commands
   to mutate production history.
6. Future changes use forward-dated, repository-controlled migrations.
7. Every future production migration requires an immutable release commit, SQL
   SHA-256, named project, approval record, exact execution transcript, and
   post-migration verification report.
8. `--include-all`, historical replay, and bulk migration repair are prohibited.
9. If schema and history disagree after a future window, stop and use a reviewed
   forward corrective migration; do not rewrite history during an incident.

## Hosted-only provenance baseline

Hosted ledger version `20260128005316` remains intact. Its one unnamed statement
has fingerprint `caac83d911c70e3f539cc2230dd8586b` and mentions:

- `big_job_settings`;
- `eligibility_rules`;
- `schedule_blocks`.

The expected hosted metadata baseline is:

| Table | Columns | Column fingerprint | Indexes | Policies | Triggers | Constraints |
|---|---:|---|---:|---:|---:|---:|
| `big_job_settings` | 14 | `1ce71c3d42a44d3efa8496615cef786e` | 1 | 1 | 1 | 1 |
| `eligibility_rules` | 12 | `bfb32b8456a5bcdd9c190c1505d75f9b` | 3 | 3 | 1 | 3 |
| `schedule_blocks` | 12 | `9b7db2278d1955b058ef0d6da8579668` | 2 | 2 | 1 | 3 |

Index, policy, trigger, and constraint fingerprints are stored in the read-only
verification SQL. This baseline does not create, alter, grant on, comment on,
or otherwise mutate those tables. Drift requires review; it is not
automatically corrected.

## Signature

```text
Decision: ACCEPT / REJECT
Production owner:
Security reviewer:
Engineering reviewer:
UTC timestamp:
Evidence package SHA-256:
Notes:
```
