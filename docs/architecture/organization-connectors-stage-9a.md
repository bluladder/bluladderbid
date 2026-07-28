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

| Capability | Jobber current repository evidence | JobTread Stage 9A position | Google Calendar fallback |
|---|---|---|---|
| Customer sync | Existing GraphQL client and booking flow perform customer lookup/create | Unknown until official API/account validation | Unsupported |
| Quote sync | Existing Jobber identifiers and service-request/booking flows; exact mutation parity requires entry-point audit | Unknown until official API/account validation | Unsupported |
| Availability read | Existing `jobber-availability` and schedule mirror | Unknown until official API/account validation | Free/busy/event reads require capability validation |
| Booking create | Existing `jobber-create-booking` | Unknown until official API/account validation | Calendar event creation only; not CRM/job/invoice creation |
| Booking update | Existing management/recovery paths require parity inventory | Unknown until official API/account validation | Event update only after calendar/account validation |
| Booking cancel | Existing cancellation module and provider flow | Unknown until official API/account validation | Event cancellation only after calendar/account validation |
| Invoice handoff | No generalized connector contract currently adopted | Unknown until official API/account validation | Unsupported; separate invoicing required |
| Communications | Existing repository channels are separate from Jobber | Unknown until official API/account validation | Unsupported |
| Health | Existing connection/test functions | Requires documented API health strategy | Requires OAuth/account and calendar access validation |

JobTread operations remain `unsupported/unknown` until verified against official
documentation and the actual authorized account. Google Calendar is only a
potential scheduling fallback; it cannot be treated as a CRM or invoicing
system.

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
- JobTread and Google capability claims require official documentation and
  account-level validation.
- Credential storage and rotation are provider/security decisions outside this
  repository-only stage.
- Existing Jobber runtime functions need a surface-by-surface parity and
  authoritative-write adoption stage.
- Oregon connector configuration and traffic remain inactive.

