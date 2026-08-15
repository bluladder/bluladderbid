# BluLadder Klamath JobTread protected read-plan source

Status: **bounded read runtime adopted in the repository; inactive and
undeployed**. The source is imported only by the Klamath admin/service read
boundary and performs no provider request until both runtime gates pass. This
repository change performs no secret resolution, hosted write, deployment,
customer operation, or activation.

## Purpose and authority

The execution runner accepts only a trusted BluLadder organization, an
approved capability, and an opaque internal execution reference. It does not
accept a provider organization, provider query, Grant Key, service list,
schedule range, configuration version, or retry policy from the caller.

The read-plan source resolves exactly one server-owned execution context and
one protected configuration. Both must have exact fields, the same
organization, the same positive configuration version, and valid bounded
identifiers. Each context expires within five minutes of evaluation. Missing,
ambiguous, malformed, cross-organization, stale, excessively long-lived, or
exceptional dependencies return `null` without exposing an error.

## Prepared first-wave reads

- `health` produces only the reviewed API-version/current-Grant membership
  query. The runner later requires exactly one expected provider organization.
- `availability_read` produces only the reviewed 100-task bounded schedule
  query for the trusted date range and approved Klamath service keys. A next
  page is not treated as complete availability; later runtime adoption must
  continue server-side or route to manual review.

Both plans are read-only and carry empty expected mutation lineage. The source
never resolves a credential, executes transport, creates an operation-attempt
row, persists a provider/customer payload, or admits a write capability.

## Remaining gates

The protected context/configuration adapters, Grant Key, field bindings,
inactive connector row, customer and booking write-plan sources, deployment,
owner-controlled acceptance, and activation are separate future work. The
bounded read entry point remains undeployed and disabled.
JobTread remains server initiated with no webhook.
