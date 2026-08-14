# BluLadder Klamath JobTread business mappings

Status: **dormant repository contract prepared**. The exact non-sensitive
custom-field names are created, but no Grant Key, protected binding, webhook,
connector row, provider identifier, provider request, deployment, customer
record, job, task, activation, or traffic is created or authorized by this
stage.

## Authority boundary

Every plan takes two separate sources:

- BluLadder organization identity and customer/booking facts supplied by the
  trusted tenant runtime; and
- provider organization identity plus custom-field bindings supplied only by
  protected server-owned connector configuration.

The mapping rejects cross-organization requests, extra caller fields, missing
provider bindings, invalid provider-reference shapes, duplicate/unapproved
service keys, malformed contact values, invalid schedule ranges, and impossible
provider state before a Pave query can be produced. The returned status is
sanitized manual review; it never includes a credential, provider response,
customer payload, or unrestricted error text.

The query planner does not accept a Grant Key and never executes a request. The
existing protected transport remains the only component allowed to inject a
Grant Key into a Pave request body. Mutation queries are single-step plans and
must use the Phase 1I hashed operation-attempt ledger. Transport interruption,
server error, or malformed mutation response is outcome-uncertain and must be
reconciled before another write.

## Approved first-wave mappings

| Connector capability | Exact JobTread mapping | Safety contract |
|---|---|---|
| `health` | Read API `version` and the current grant's organization memberships | Read-only; runtime must verify exactly one expected provider organization before enabling any write |
| `customer_sync` | Resolve an account by the BluLadder customer-reference custom field; create/update a `customer` account, contact, and service location in that order | Exact custom-field bindings are mandatory; contact phone is E.164; contact email is normalized; at least one contact channel is required; more than one matching account/contact/location is manual review |
| `availability_read` | Read organization job tasks bounded by local start/end dates, `targetType = job`, and `isToDo = false` | Read-only and paginated; only approved Klamath service keys are accepted; returned tasks are busy evidence, not independently bookable capacity |
| `booking_create` | Create one unpublished JobTread job for the resolved service location, then one non-notifying scheduled job task | The internal booking reference is written through one configured custom field; customer/location reconciliation must complete first; each mutation is independently idempotent and reconciled |
| `booking_update` | Update only the already-resolved scheduled task's dates/times and canonical service summary | No job reassignment, recurrence expansion, dependent-task update, or notification |

The mapping uses only operation and field names verified in the intended
account's official API explorer: `currentGrant`, `organization.accounts`,
`createAccount`, `updateAccount`, `createContact`, `updateContact`,
`createLocation`, `updateLocation`, `organization.tasks`, `createJob`,
`createTask`, and `updateTask`.

## Explicitly blocked mappings

- `quote_sync`: the JobTread document type, status, line-item, tax, signature,
  recipient, and send lifecycle is not approved.
- `booking_cancel`: deleting a task destroys useful history, while marking it
  complete would misstate cancellation. Cancellation remains manual review
  until an exact provider lifecycle is approved.
- `invoice_handoff`: accounting ownership, document/payment lifecycle, and
  QuickBooks effects remain unapproved.
- `communications_handoff`: JobTread comments and document sends are not a
  substitute for the tenant-scoped BluLadder outbox.
- daily logs, case-study notes, file/photo uploads, and downloads remain
  read-only capability evidence. Retention, consent, storage, and download
  rules require a separate contract.

There is no Jobber or DFW fallback for any blocked or failed Klamath mapping.

## Remaining activation gates

This repository contract does not make the adapter reachable. Before any
provider setup or traffic, a separately reviewed stage must:

1. record the created JobTread fields' exact protected bindings;
2. create one organization-scoped Grant Key with least privilege and keep the
   first-wave webhook absent;
3. insert one inactive Klamath connector row with hashed provider authority;
4. adopt the now-prepared dormant operation-attempt runner only after concrete
   stores, the server-initiated ingress policy, and reconciliation reads pass
   separate review;
5. prove availability/capacity semantics and a cancellation lifecycle;
6. deploy only the exact runtime functions and run owner-controlled acceptance;
7. activate the connector and customer traffic only after every other Klamath
   pricing, contact, messaging, site, and provider gate passes.
