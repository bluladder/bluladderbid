# BluLadder Klamath Phase 1G messaging/outbox lineage

Status: **hosted additive schema and least-privilege repair verified; runtime
writer adoption blocked**. This phase defines the organization-owned sender boundary
required before Klamath can send SMS or email. It does not add a credential,
sender, provider resource, message, customer traffic, or deployment.

## Authority contract

Every outbound attempt must carry server-derived organization authority before
an outbox claim. Recipient identity, caller ID, browser input, message content,
and model output are never tenant authority. Selection requires exactly one
active connector for the organization and channel, with a non-secret credential
reference and sender-identity reference. Missing, inactive, tied, incomplete,
or cross-organization configuration fails closed before provider dispatch.

The durable outbox identity is ultimately scoped by organization, connector,
channel, and idempotency key. A worker must re-read the persisted organization
and connector binding and run the same guard immediately before dispatch.
Provider retries and callbacks must preserve that lineage; they may not infer a
tenant from a destination or provider response.

## Provider boundary

DFW remains on its reviewed CallRail path. Klamath is expected to use Twilio,
but no Twilio resource or credential exists in this contract. A connector
record stores only references, never a token or secret. Runtime adapters must
resolve an allowlisted server-side credential reference and an independently
verified sender identity. Failure never falls back to DFW or another active
connector.

## Consent and suppression decision

Platform/legal safety suppressions remain global and take precedence across
all senders. Organization-owned consent, channel preferences, pauses, and
message history require organization lineage. This separates a universal
do-not-contact safety decision from an organization's permission to contact a
customer; neither can weaken the other.

## Planned additive rollout

1. Reconcile hosted counts and parent-lineage evidence for `sms_messages`,
   `communication_consent`, consent events, and email attempts.
2. Add nullable organization/connector lineage and backfill only bounded DFW
   history under collision stop gates.
3. Deploy writers that persist server-derived organization and connector IDs.
4. Verify zero new lineage gaps, then require lineage and replace global
   uniqueness/RLS with organization-aware constraints.
5. Add Twilio only after its business registration, sender, credential, and
   callback identities are independently verified.

No schema application may create an active Klamath connector or enable a
sender. No runtime may dispatch a Klamath message until all five steps and the
separate activation gates are complete.

## Hosted evidence and additive migration candidate

The read-only hosted preflight observed seven prerequisite tables, one exact
active DFW legacy default, one provisioning Klamath organization, zero Klamath
customers, zero Klamath provider identities, and no target table or lineage
column. Of 134 historical messaging-ledger rows, 28 have a server-owned parent,
106 are legacy unparented rows, and none has conflicting or non-DFW parent
authority.

`20260814070000_bluladder_klamath_phase_1g_additive_messaging_lineage.sql`
therefore uses bounded stop gates to create the inactive connector registry,
add nullable organization and connector lineage to `sms_messages`, and backfill
only the reviewed historical rows to DFW. The migration creates no connector
row and changes no provider or queue behavior. A trigger derives organization
authority from server-owned customer, quote, or booking parents and rejects
parent, connector-organization, and connector-channel mismatches.

Nullable columns are intentional only for the short staged writer-adoption
window. They do not authorize an unscoped send. The separately reviewed writer
wave must persist server-derived organization and connector authority, prove
zero new gaps, and run the dispatch guard before either lineage column can be
made required or any Klamath provider can be configured.

## Hosted execution and grant-repair verification

The exact canonical payload was applied once by Lovable as provider execution
version `20260814071137`. The provider receipt is the 12,047-byte canonical
payload without its terminal line feed; adding that one byte reproduces the
reviewed 12,048-byte SHA-256 exactly. The ledger advanced from 157 to 158 rows.
Postflight found 134 DFW rows with complete organization lineage, zero connector
bindings, zero connector rows, unchanged DFW fingerprints, and Klamath still
provisioning with zero customers or provider identities.

Lovable's table-creation defaults hydrated three structural privileges for the
`authenticated` role: `REFERENCES`, `TRIGGER`, and `TRUNCATE`. This is not the
reviewed CRUD-only contract and keeps the schema gate blocked even though RLS,
both policies, anonymous denial, service-role access, and trigger-function
execute denial are intact.

`20260814071600_bluladder_klamath_phase_1g_authenticated_grants.sql` was
applied once as provider execution version `20260814072713`. The single stored
statement is the 7,531-byte canonical payload without its terminal line feed;
adding that one byte reproduces the reviewed 7,532-byte SHA-256 exactly. The
ledger advanced from 158 to 159 rows with ordered fingerprint
`b98e6fcb7ce47a544f22410d1b62a7fbdab90dc99af59518f06302299c24eac2`.

Postflight proves that `authenticated` now has only `SELECT`, `INSERT`,
`UPDATE`, and `DELETE`; anonymous access remains absent and
`service_role` retains the expected seven privileges. The operation changed
no row, policy, function, provider, sender, credential, runtime, or activation
setting. The hosted schema gate is ready; writer adoption, connector
configuration, dispatch, and activation remain separately blocked.

## Scoped transactional-outbox writer candidate

`20260814074000_bluladder_klamath_phase_1g_scoped_sms_outbox.sql`
adds a new claim function without changing the deployed legacy claim
functions. The new boundary requires a server-resolved organization and one
active SMS connector before it atomically records organization, connector,
optional quote, and idempotency lineage. A replay whose organization,
connector, or quote differs fails closed before provider dispatch.

The runtime candidate resolves exactly one active organization-owned SMS
connector, checks the pure dispatch guard, and uses only the scoped claim.
The approved organization comes from the persisted quote or booking, the
already-resolved voice webhook authority, or the resolved SMS conversation;
the recipient never selects a tenant. Unsupported providers finalize as
failed without an outbound request. This code is not deployable until the
scoped migration is separately applied and the reviewed DFW/Klamath connector
and adapter gates are satisfied.
