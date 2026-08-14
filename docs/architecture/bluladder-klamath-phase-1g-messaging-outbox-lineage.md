# BluLadder Klamath Phase 1G messaging/outbox lineage

Status: **hosted additive schema, least-privilege repair, and scoped outbox
claim verified; fail-closed Twilio adapter prepared; remaining runtime writer
adoption blocked**. This phase defines the organization-owned sender boundary
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
failed without an outbound request. The scoped migration is now applied and
independently verified. This runtime code remains undeployed until the reviewed
DFW/Klamath connector, adapter, and remaining writer-adoption gates are
satisfied.

## Hosted scoped-outbox verification

`20260814074000_bluladder_klamath_phase_1g_scoped_sms_outbox.sql` was applied
once as provider execution version `20260814081254`. The single stored statement
is the 8,964-byte canonical payload without its terminal line feed; adding that
one byte reproduces the reviewed 8,965-byte SHA-256 exactly. The ledger advanced
from 159 to 160 rows with ordered fingerprint
`db0c52f8e729931bc6f60270bae6e3050d4e7a33c6abcc0ecf55cb05e8b3c069`.

Postflight proves the scoped claim exists, only `service_role` may execute it,
and anonymous/authenticated execution remains denied. The operation changed no
connector or SMS row: all 134 historical rows remain DFW-owned with zero
connector bindings, and Klamath remains provisioning with no active connector.
The hosted transactional boundary is ready; remaining writer adoption, provider
configuration, runtime deployment, controlled messaging, and activation remain
separately blocked.

## Fail-closed Twilio adapter candidate

The prepared adapter accepts only the compiled non-secret credential reference
`bluladder-klamath-twilio-production-v1` and a syntactically valid Twilio
Messaging Service identity. Runtime authentication requires a dedicated API key
SID and secret from server-side environment storage; it never uses a database
credential value or a model-supplied sender. Requests pass
`MessagingServiceSid` instead of a raw `From` number so the future registered
sender pool remains the sole sender authority.

The adapter normalizes the recipient, reuses the existing Markdown scrub and
SMS length bound, and returns content-free error categories. It never persists
or logs a provider response body. A valid provider message SID is required for
acceptance; unreadable success responses and transport failures become
`delivery_unknown`, which forbids automatic redispatch. HTTP rejection becomes
`send_failed`. The organization-scoped outbox selects the Twilio adapter only
for an exact reviewed connector and preserves the DFW CallRail path for an exact
DFW connector.

This adapter is repository-only. No Twilio resource, API key, Messaging Service,
phone number, sender, connector row, secret, deployment, or message was created.
It must not be deployed until the DFW connector compatibility row and the
separately reviewed inactive Klamath connector/provider prerequisites exist.

## DFW connector compatibility candidate

Before the tenant-aware outbox can be deployed, the already-live DFW CallRail
boundary must be represented by exactly one organization-owned connector. The
prepared compatibility migration stops unless the connector table is empty,
all existing SMS ledger rows remain DFW-owned and unbound, the exact active DFW
legacy default is present, and Klamath remains provisioning with no active
organization state.

The migration inserts one deterministic active DFW SMS connector using only the
two compiled non-secret CallRail references and backfills only existing
DFW-owned rows whose channel is exactly `sms`. Existing non-SMS rows remain
unbound. It creates no Klamath connector and changes no secret, provider
resource, sender, runtime, queue, customer traffic, or message. The runtime
separately refuses any CallRail connector whose two references differ from
those exact compiled values, before making a provider request.

The first hosted application attempt rolled back completely when the original
blanket backfill encountered 12 legacy email-channel rows and the connector
lineage trigger correctly rejected an SMS-connector mismatch. The corrected
artifact scopes both backfill and completeness checks to the 122 SMS-channel
rows, separately requires every non-SMS row to remain unbound, and reproduces
the mixed-channel hosted shape in disposable PostgreSQL CI.

## Hosted DFW connector verification

The corrected artifact was applied once as provider execution version
`20260814090619`. The single stored statement is the 5,998-byte canonical
payload without its terminal line feed; adding that one byte reproduces the
reviewed 5,999-byte SHA-256 exactly. The ledger advanced from 160 to 161 rows
with ordered fingerprint
`4ee6082deeaeb43f4e8fd200052a8f992391a50969d40ef0c41bf3f95ef4cfe7`.

Independent postflight proves that exactly one reviewed DFW CallRail SMS
connector exists, all 122 historical SMS-channel rows are bound to it, all 12
email-channel rows remain unbound, no other connector exists, and the Klamath
organization remains provisioning with no connector or active state. The
operation created no provider resource, secret, sender, customer traffic, or
message. Writer adoption and runtime deployment remain separately blocked.

## Portal verification writer candidate

The customer-portal verification SMS path is the first launch-critical writer
to adopt the scoped outbox. It keeps the existing exact-origin, server-side
organization resolver as its authority, uses the durable challenge identifier
as its idempotency key, and records the connector-selected provider outcome on
the challenge. It no longer calls CallRail directly or inserts a second SMS
ledger row after dispatch. The existing email verification path remains
separate but now records the resolved organization on its audit-ledger row.

This change is repository-only. Klamath still has no connector, provider
credential, sender, or active customer-site authority, so it continues to fail
closed. DFW dispatch remains on the reviewed CallRail connector. No function is
deployed and no message is sent by this writer-adoption change.

## Queued-SMS connector boundary candidate

The shared queue worker now selects exactly one active SMS connector from the
persisted message organization, persists that connector under the current
durable claim, and rereads the organization/connector/channel/idempotency tuple
through the same dispatch guard before the provider boundary. An already-bound
row must match the selected connector. Missing organization authority, a
missing/inactive/ambiguous connector, a stale claim, or mismatched lineage is a
permanent fail-closed outcome and makes no provider request.

Immediate outbox sends and queued SMS now share one provider adapter. The exact
reviewed DFW references still select CallRail, and only the compiled Klamath
reference plus a valid Messaging Service identity can select Twilio. Transport
uncertainty remains terminal for automatic redispatch; definitive provider
rejections retain the existing bounded queue policy. Email queue behavior is
unchanged.

This worker change is repository-only and undeployed. It creates no connector,
credential, sender, message, customer traffic, or activation state. Klamath has
no connector, so a Klamath queue row still fails before provider submission.
