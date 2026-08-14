# BluLadder Klamath Phase 1I CRM connector lineage

Status: **hosted additive schema and least-privilege grants verified**. No
connector, credential, webhook, provider call, deployment, customer traffic,
or activation is authorized.

## Purpose

The verified JobTread provider surface and dormant adapter need a server-owned
persistence boundary before any runtime entry point can select a connector or
accept a webhook. Phase 1I prepares that boundary without deciding how a
BluLadder quote, booking, schedule, cancellation, invoice, or communication
maps to JobTread.

Three organization-owned tables are proposed:

- `organization_crm_connectors` stores provider, state, priority, approved
  capabilities, configuration version, and opaque protected-secret references;
- `organization_connector_operation_attempts` records hashed idempotency and
  request fingerprints plus sanitized terminal outcomes;
- `organization_connector_webhook_receipts` records authenticated provider
  event and payload fingerprints without retaining raw webhook bodies.

The schema has no raw credential, secret, token, header, provider organization
ID, provider event ID, request body, response body, or customer payload column.
Provider and event identities are represented only by lowercase SHA-256
fingerprints. Secret material remains outside the database row in protected
server-side storage and is addressed through an opaque reference.

## Activation and lineage gates

A connector defaults to inactive with runtime and webhook processing disabled.
Non-manual runtime activation requires an active status, at least one explicit
capability, one protected credential reference, and one provider-organization
fingerprint. Webhook activation additionally requires runtime activation and a
separate protected webhook-secret reference. These database constraints do not
authorize activation; they only prevent an incomplete row from becoming
reachable.

Operation attempts and webhook receipts use composite foreign keys
`(organization_id, connector_id)`, so a connector from another organization
cannot be attached. Attempts are unique by connector, operation, hashed
idempotency key, and attempt number. Webhook receipts are unique by connector
and hashed provider event ID. Uncertain provider outcomes are terminal manual
review states and cannot be represented as success.

The migration inserts no rows. Klamath therefore remains provisioning with no
CRM connector, provider identity, customer traffic, operation attempt, or
webhook receipt.

## Access contract

RLS is enabled on all three tables. Anonymous access is revoked. Active tenant
operators may view and manage connector configuration, but may only read the
sanitized operation and webhook ledgers. Only `service_role` may write those
ledgers. Membership predicates use indexed organization/user lineage and cache
`auth.uid()` through a scalar subquery.

## Release artifacts

- read-only preflight:
  `supabase/preflight/bluladder_klamath_phase_1i_crm_connector_lineage.sql`;
- additive migration candidate:
  `supabase/migrations/20260814113000_bluladder_klamath_phase_1i_crm_connector_lineage.sql`;
- read-only postflight:
  `supabase/verification/bluladder_klamath_phase_1i_crm_connector_lineage.sql`;
- disposable PostgreSQL rehearsal:
  `scripts/rehearse-bluladder-klamath-phase-1i-crm-connector-postgres.sh`.

The preflight required the exact active DFW default, one provisioning Klamath
organization, zero Klamath customer traffic and provider identities, all six
prerequisite tables, and complete absence of the three target tables. The
postflight reports exact RLS, policy, grant, index, empty-table, DFW, and
inactive Klamath state so every hosted difference is explicit. Both SQL
inspections are bounded read-only transactions that roll back.

## Hosted application and grant repair

The exact preflight passed against the Lovable-hosted database from merged main
`e57401240c6661b0aba82859a9793a14e3e6ec42`. Lovable applied the canonical
migration once as hosted execution version `20260814113042`; its one stored
statement is the 13,540-byte canonical payload without the terminal line feed.
Adding that byte reproduces the reviewed 13,541-byte SHA-256 exactly. The
migration ledger advanced from 162 to 163 rows.

Independent postflight proved three empty RLS-enabled tables, exact policy and
index counts, anonymous denial, complete service-role access, unchanged DFW
authority, and provisioning Klamath with zero memberships, customers,
conversations, bookings, provider identities, connectors, operation attempts,
or webhook receipts.

Lovable's table-creation defaults also hydrated `REFERENCES`, `TRIGGER`, and
`TRUNCATE` for `authenticated` on all three tables. RLS still denies audit
writes because the audit tables have only SELECT policies, but the direct grant
surface is broader than the reviewed least-privilege contract. The separate
forward-only grant repair accepts only that exact state, narrows connector
configuration to CRUD and both audit tables to SELECT, and otherwise changes
nothing. It was applied once as execution version `20260814120308`; independent
postflight proved the exact grant contract and unchanged empty/inactive state.

## Separately gated work

The additive migration and authenticated-grant repair are applied and verified.
All of the following remain blocked:

1. creating or reading a JobTread Grant Key;
2. creating a JobTread webhook or protected secret;
3. inserting or activating a Klamath connector row;
4. approving operation-specific business mappings;
5. adopting the adapter in a runtime entry point;
6. deploying a function or accepting provider/customer traffic;
7. publishing the site, purchasing provider resources, sending messages, or
   placing calls.

There is no Jobber or DFW fallback for Klamath.
