# Organization connector contract — Stage 9A

Status: repository-only contract. No deployed entry point uses this abstraction,
no connector configuration migration is included, and no provider or credential
state was read or changed.

## Authority and selection

Connector selection consumes a server-resolved organization ID. Client or model
payloads are never an organization authority. Configuration is filtered by
organization before capability, status, credential-reference, or priority
evaluation.

Selection fails closed with one of:

- `connector_missing`
- `connector_inactive`
- `capability_unsupported`
- `credential_reference_missing`
- `connector_ambiguous`

There is no DFW fallback and no fallback to another organization's connector.
Equal-priority candidates are ambiguous. A credential reference is opaque
metadata such as a vault key; raw credentials must not appear in organization
settings, audit rows, client responses, or this repository.

## Typed operations

`OrganizationConnector` defines:

- customer sync
- quote sync
- availability read
- booking create, update, and cancel
- invoice handoff
- communications handoff
- health/status

Every write requires an idempotency key and organization-lineage match before
the adapter is invoked. Provider failures become explicit recoverable
manual-review results. A later persistence layer must record attempt number,
operation, connector, organization, idempotency key, sanitized outcome, and
dead-letter/manual-review disposition.

The payment contract resolves an opaque organization-specific destination
reference only. Stage 9A does not implement Stripe Connect, fee splitting,
account creation, or payment-provider configuration.

## DFW Jobber compatibility

Jobber remains authoritative for DFW. `jobberConnectorAdapter.ts` wraps injected
legacy operations and passes request payloads and successful values through
unchanged after lineage/idempotency guards. Existing Jobber Edge Functions are
not rewired in Stage 9A, so deployed DFW behavior is unchanged.

Runtime cutover requires:

1. hosted tenant migration and verification evidence;
2. generated types from the verified hosted schema;
3. organization-scoped connector configuration and credential references;
4. tenant lineage on customers, quotes, bookings, schedule mirrors, webhook
   events, idempotency/audit rows, and child records;
5. parity tests around each existing Jobber entry point;
6. a separately reviewed DFW-first adoption plan.

## Capability matrix

This matrix records only repository evidence and conservative plans. It is not
a claim that a provider account or API version supports an operation.

| Capability | Jobber current repository evidence | JobTread provider evidence | Klamath runtime position | Google Calendar fallback |
|---|---|---|---|---|
| Customer sync | Existing GraphQL client and booking flow perform customer lookup/create | Official explorer exposes organization-scoped account/customer query, create, update, and delete plus contact/location operations | Dormant exact mapping and single-attempt response-validating runner prepared; custom fields, grant, concrete stores, runtime, and acceptance remain blocked | Unsupported |
| Quote sync | Existing Jobber identifiers and service-request/booking flows; exact mutation parity requires entry-point audit | Document query/create/update/delete and document-recipient operations are exposed | Document-type and lifecycle mapping remain unapproved; fail closed | Unsupported |
| Availability read | Existing `jobber-availability` and schedule mirror | Job/task/event queries and dated task fields are exposed | Dormant bounded busy-evidence plan and response-validating runner prepared; capacity, crew, route, and blackout interpretation still fail closed | Free/busy/event reads require capability validation |
| Booking create | Existing `jobber-create-booking` | Customer → location → job creation and task creation are exposed | Dormant one-job/one-task mapping and single-attempt runner prepared; provider setup, concrete stores, capacity proof, and runtime remain blocked | Calendar event creation only; not CRM/job/invoice creation |
| Booking update | Existing management/recovery paths require parity inventory | Job and task update operations are exposed | Dormant task-only schedule update and lineage-validating runner prepared; provider setup, concrete stores, and runtime remain blocked | Event update only after calendar/account validation |
| Booking cancel | Existing cancellation module and provider flow | Task deletion and job/task update operations are exposed | Cancellation semantics remain unapproved; fail closed | Event cancellation only after calendar/account validation |
| Invoice handoff | No generalized connector contract currently adopted | Document and payment query/write primitives are exposed | Accounting lifecycle mapping remains unapproved; fail closed | Unsupported; separate invoicing required |
| Communications | Existing repository channels are separate from Jobber | Comment and document-send primitives are exposed | Provider communications remain separate from the approved BluLadder outbox | Unsupported |
| Health | Existing connection/test functions | API version and current-grant queries are documented | Safe read-only health plan verified; credential/runtime remain absent | Requires OAuth/account and calendar access validation |

The provider surface above was verified read-only against the official API
explorer and the intended authorized account on 2026-08-14. It is evidence of
available primitives, not approval of a BluLadder business mapping. The dormant
JobTread adapter therefore requires an explicit per-operation allow-list and
returns manual review without a provider call for every unapproved capability.
Google Calendar is only a potential scheduling fallback; it cannot be treated
as a CRM or invoicing system.

## JobTread authentication and webhook evidence

- Grants may be restricted to one organization. A grant key is shown once and
  expires after three months of inactivity. The future runtime must load it
  from protected server-side secret storage; it must never appear in connector
  configuration, audit output, logs, errors, fixtures, or client responses.
- Pave requests use `POST https://api.jobtread.com/pave` with the grant injected
  into the root query arguments. The repository transport performs no automatic
  mutation retry and returns only sanitized status codes.
- Custom webhooks can be restricted to selected lifecycle events. Relevant
  verified categories are account, contact, job, task, document and recipient,
  daily log, file, location, form submission, payment, and time entry.
- A future webhook must authenticate its source, derive organization authority
  from the server-owned connector record, persist event idempotency, and reject
  events whose provider organization does not match that record.
- No grant, webhook, provider call, hosted connector row, secret, deployment, or
  customer traffic was created by this repository stage.

## Retry and dead-letter contract

- Retry only transient provider unavailability using bounded attempts and
  stable idempotency keys.
- Provider rejection, unsupported capability, lineage mismatch, ambiguity, and
  missing configuration go directly to manual review.
- Exhausted retries produce `retry_exhausted`; never switch providers or
  organizations silently.
- Dead-letter payloads must be sanitized references, not raw credentials or
  unrestricted customer payloads.
- Replays must select the same organization and connector contract version.

## Deferred decisions and gates

- Exact connector configuration/audit schema belongs to an additive migration
  after the hosted provenance review.
- The first dormant JobTread mapping wave is reviewed operation by operation in
  `bluladder-klamath-jobtread-business-mappings.md`. Quote, cancellation,
  invoice, communications, case-study, file, and photo lifecycles remain
  unapproved and fail closed.
- The dormant execution/reconciliation seam is reviewed in
  `bluladder-klamath-jobtread-execution-runner.md`. It has only injected
  storage, secret, plan, and transport ports and is not imported by a runtime
  entry point.
- Credential storage and rotation are provider/security decisions outside this
  repository-only stage.
- Existing Jobber runtime functions need a surface-by-surface parity and
  authoritative-write adoption stage.
- Oregon connector configuration and traffic remain inactive.
