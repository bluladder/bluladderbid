# BluLadder Klamath Phase 1G messaging/outbox lineage

Status: **additive schema candidate; hosted application and runtime changes
blocked**. This phase defines the organization-owned sender boundary required
before Klamath can send SMS or email. It adds a reviewed migration candidate,
but it does not add a credential, sender, provider resource, message, customer
traffic, or deployment.

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
