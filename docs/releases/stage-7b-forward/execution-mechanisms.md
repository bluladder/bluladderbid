# Stage 7B execution mechanism decision

Decision: **NO-GO**. No reviewed mechanism can currently guarantee the immutable
payload, acceptable history, and atomic failure behavior together.

| Mechanism | History | Transaction and rollback | Exact payload | Decision |
|---|---|---|---|---|
| Direct `psql -X -v ON_ERROR_STOP=1 -f` | Does not record Supabase history | The file's own transaction rolls back an SQL error; `--single-transaction` is incompatible with embedded transaction commands | Strong file/hash control | Reject: untracked schema application and direct credential/DSN exposure |
| Supabase raw SQL / SQL editor | Does not record Supabase history | One request, but cancellation and client timeout evidence are weaker | One supplied query | Reject: official DDL path is a migration operation; history remains absent |
| Temporary one-file migrations directory | CLI still compares hosted history | CLI batch semantics and history insert must be rehearsed | Directory can contain one file, but remote versions are missing locally | Reject: no supported single-file selector; legacy reconciliation blocks it |
| Linked `db push` / `migration up` | Records selected migrations | Batch behavior is managed by CLI | Selects a pending set, not an explicit file | Reject: cannot bypass legacy comparison safely |
| Supabase `apply_migration` / Management migration endpoint | Records a platform migration | Officially intended to roll back DDL on failure | Accepts one name/query request | Conditional candidate only |

## Conditional candidate

`apply_migration` is the closest supported mechanism because it accepts one SQL
query and records a migration. It is not approved because:

- it does not accept canonical version `20260728060000`;
- the generated ledger version/name/statements are not rehearsed;
- the endpoint may be restricted by account/platform availability;
- it has no dry-run;
- interaction with the payload's embedded `BEGIN`/`COMMIT` is unproven;
- the immutable payload has unresolved RLS and grant defects.

Proposed future invocation shape, not authorized:

```text
apply_migration(
  project_id = "gyndziiuizpgwhqwyrvn",
  name = "tenant_foundation_stage_7b",
  query = <exact reviewed payload>
)
```

Before selection, a disposable Supabase branch must prove one schema payload,
one expected ledger row, atomic schema-plus-history rollback after an injected
failure, and the generated version/name/statement fingerprint. If the platform
assigns an unacceptable version or separates schema commit from history
recording, reject it.

## Recovery limits

No mechanism makes a partially committed migration safely retryable. If schema
objects exist without the approved history result, stop. Do not insert or delete
ledger rows, rerun the payload, or use a cleanup rollback. Capture evidence and
prepare a forward corrective migration.
