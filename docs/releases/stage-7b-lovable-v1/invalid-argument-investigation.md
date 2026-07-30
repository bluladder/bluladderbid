# Lovable `INVALID_ARGUMENT` preflight investigation

No SQL was retried during this investigation.

## Assessment

The rejected payload was 3,902 bytes and the MCP call used the documented
`project_id` and `sql` argument names. Its PostgreSQL syntax is valid, but it is
a 15-statement batch containing `BEGIN TRANSACTION READ ONLY`, comments,
multiple `SELECT` statements, and `ROLLBACK`.

Lovable documents `query_database` as executing an SQL query. The tool contract
accepts one `sql` string and returns rows. It does not document transaction
batches or multiple result sets. `INVALID_ARGUMENT`, with no row result or
database error detail, is therefore most consistent with request validation
rejecting a multi-statement payload before database dispatch.

There is no evidence that comments, PostgreSQL syntax, the 3,902-byte size, an
attachment, or incorrect argument names caused the rejection:

- no attachment was used;
- the call contained exactly `project_id` and `sql`;
- comments and transaction syntax are valid PostgreSQL;
- the payload is small;
- a database parser/runtime error would normally identify SQLSTATE, position,
  or statement context rather than only the MCP argument error.

This remains a high-confidence inference, not platform attestation. The
original result supplies no execution ID or backend log correlation.

## Corrected MCP format

Use `supabase/preflight/tenant_stage_7b_lovable_mcp.json`. Submit exactly one
listed `SELECT` as the complete `sql` value in each `query_database` call, in
order. Do not concatenate calls, add `BEGIN`/`ROLLBACK`, or use the migration
approval path. Each statement is independently read-only.

The first query is the smallest capability test. It reads only database/session
metadata and immutable expected identity literals. It does not access customer
tables. Stop unless it returns one row and the already-confirmed Lovable project
mapping remains project `b6e0d823-59c4-4b5a-afbe-182485e5458b` → backend
`gyndziiuizpgwhqwyrvn` → `Live/production`.

The SQL editor is supported for manually supplied SQL, including data
migrations that Lovable does not apply automatically. It is not required for
read-only verification: Lovable's documented MCP `query_database` tool is
explicitly intended to inspect the database. The reviewed-migration approval
path is reserved for the eventual protected migration, not read-only preflight.

## Evidence classification

- **Rejected before execution:** MCP validation error, no result rows, and no
  matching database log/query identifier. `INVALID_ARGUMENT` strongly supports
  this class but is not conclusive without the log check.
- **Executed successfully:** the tool returns the expected row set and the
  retained response includes project, query ID, UTC start/finish, and success.
  A matching backend log entry makes the evidence stronger.
- **Partially executed:** applicable only to a batch. Logs or returned result
  sets show some statements began before a later failure. The corrected format
  eliminates intra-call partial execution because every call is one `SELECT`.
- **Ambiguous:** timeout, disconnect, or generic error after accepted
  submission, with neither result rows nor a correlatable database log. Stop
  and investigate; do not retry automatically.

The original payload could not mutate hosted state even if PostgreSQL received
it: it began a read-only transaction and ended with `ROLLBACK`. Its execution
status nevertheless remains unproven.

## Ledger fingerprint correction

The historical baseline was produced with:

`md5(string_agg(version || ':' || coalesce(name, ''), E'\n' ORDER BY version))`

The first MCP-compatible query accidentally used raw `name` and a pipe
separator. A read-only comparison over the same 145 rows produced the committed
historical fingerprint `73ed8522db78e51049a421e1f72b18c3` with the historical
recipe and `bd10491f2fcfe2579cd1bfbf9c9c534e` with the erroneous recipe. There
were zero null names. The MCP query and transaction-form preflight now use the
historical newline/coalesce recipe; the hosted baseline is unchanged.
