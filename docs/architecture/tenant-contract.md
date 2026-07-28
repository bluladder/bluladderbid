# Tenant contract

This is the Stage 7A contract consumed by issues #8, #9, #10, and #4. It defines
the boundary; it does not implement migrations or change runtime behavior.

## Identity and lifecycle

An organization has an immutable UUID, unique stable slug, display name, status,
and audit timestamps. Status is one of `provisioning`, `active`, `suspended`, or
`archived`. Only `active` organizations accept ordinary business traffic.
Suspension blocks new writes and provider processing while retaining read/audit
access for authorized platform operations.

Membership is the only ordinary human authorization link: `(organization_id,
user_id, role, status)`. A user may have multiple memberships, but exactly one
verified active organization context is used per request. Platform roles remain
separate from organization membership. A global admin role alone does not grant
implicit access to every organization's business data.

## Trusted resolution

The server resolves organization context in this precedence order:

1. A resource capability/session/token already bound to an organization.
2. An authenticated user's requested active organization, verified against an
   active membership.
3. A provider resource mapped uniquely to an active organization (account,
   connector, receiving address, tracking number, DID, assistant).
4. A server-controlled hostname/site/embed identifier mapped uniquely to an
   active organization.
5. A versioned territory resolver for public intake when the contract for that
   endpoint explicitly permits it.

Client-provided organization UUIDs, customer identity, caller ID, email address,
or free-form provider payload fields are selectors only, never authority. Every
selector is checked against a trusted mapping or parent row.

No match, multiple matches, conflicting signals, inactive status, or mismatched
parentage fails closed before a business write. Webhook receipts may be retained
in an unresolved quarantine for audit, but cannot enter business processing.

DFW is the migration default only for the bounded set of existing rows proven to
belong to the current single business. It is not a runtime fallback, not a
database column default, and not used for new ambiguous data.

## Data and database rules

- Every organization-owned, organization-configured, and tenant-derived row has
  a non-null `organization_id` foreign key after enforcement.
- Child, cache, audit, event, and revision rows copy organization from their
  authoritative parent or resolved execution context. Payload values are ignored.
- Cross-row foreign keys and uniqueness/idempotency constraints include
  `organization_id` wherever identifiers are not platform-global.
- Views expose organization identity and preserve tenant predicates.
- RLS permits organization members only at the required role and active status.
  Anonymous access is through deliberately scoped views/functions/tokens.
- `SECURITY DEFINER`, service-role, cron, and background paths validate
  organization and parent lineage in code/SQL and predicate every read/write.
- Queue claims, locks, retries, caches, provider IDs, and sync coverage are
  organization-keyed. Global workers enumerate eligible organizations and process
  one explicit organization context at a time.
- Platform-global tables deny tenant mutation. System test fixtures name an
  explicit test organization when touching business tables.

## Audit contract

Every privileged or automatic organization resolution records organization,
resolution source and version, source identifier (redacted/hashed where needed),
actor type/id, request/correlation ID, decision, and failure reason. Membership,
organization status, connector mapping, provider credential metadata, and
platform override changes are audited. Secrets and raw tokens are never logged.

## Security invariants

1. A request cannot read or mutate organization B while executing in A.
2. An admin UI filter is never the enforcement boundary.
3. Service-role possession never implies tenant authority.
4. Provider signatures authenticate the sender, not the tenant.
5. A tenant resolution conflict produces no business-side effect.
6. Historical audit and idempotency data retain organization lineage.
7. Archived/suspended organizations cannot receive new automatic processing.

## Unresolved decisions

Stage 7B must not pass its migration gate until owners decide:

- canonical DFW organization UUID/slug and dedicated test organization;
- organization role vocabulary and whether any platform role can explicitly
  assume organization context;
- customer identity across organizations and verification-session partitioning;
- canonical provider routing keys and connector credential storage/encryption;
- platform-global versus per-org kill switches, suppressions, templates, presets,
  lead-source taxonomy, analytics configuration, and test configuration;
- public hostname/embed/territory mapping and the ambiguity user experience;
- canonical legacy SMS opt-out schema and generated/hosted schema provenance;
- retention and operator workflow for unresolved webhook/intake quarantine.
