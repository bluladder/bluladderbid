# Tenant-sensitive inventory (Stage 7A)

Status: contract-only baseline at `ebfeae98e7e90dba66d5a0463ca5555790ee51a1`.
At that baseline, no hosted state was inspected or changed. The machine-readable classification is
[`tenant-inventory.json`](./tenant-inventory.json), and
`npm run check:tenant-inventory` detects unclassified generated-schema or edge
function additions.

The Stage 8A hosted-compatibility application later added four generated table
definitions: `organization_settings`, `organization_contacts`,
`organization_territories`, and `organization_services`. They are classified as
organization-scoped configuration in the machine-readable inventory. The
inactive Phase 1C hosted foundation later added generated definitions for
`organization_customer_sites` and `organization_pricing_profiles`. Phase 1G
later added `organization_messaging_connectors`. Phase 1I added
`organization_crm_connectors` as organization-scoped configuration plus
`organization_connector_operation_attempts` and
`organization_connector_webhook_receipts` as organization-owned audit tables.
Every connector remains runtime-disabled. The counts
below remain the immutable Stage 7A baseline rather than a statement of current
generated-schema totals.

## Scope and method

The inventory reconciles generated Supabase types, all 152 repository migrations,
62 edge-function entrypoints, shared runtime modules, frontend Supabase consumers,
scheduled SQL, and provider/environment references. It classifies each table as
global/system-owned, organization-owned, organization-scoped configuration,
derived/cache/audit, or ambiguous/manual-review. Views and routines inherit the
strictest scope of their base data.

Baseline results:

| Surface | Result | Tenant finding |
|---|---:|---|
| Generated tables | 96 | All classified exactly once in the JSON inventory |
| Tables created in repository SQL | 93 unique / 96 definitions | Three provenance gaps; duplicate reconciliation migrations exist |
| Views | 4 unique / 5 definitions | All expose organization-sensitive base data |
| Generated database functions | 56 | 41 organization-sensitive; 15 system/test/auth |
| Migration DDL | 65 triggers; 190 policies | No organization predicate exists |
| Edge functions | 62 | No internal tenant resolution exists |
| Runtime table references | 90 distinct tables | Writes currently operate in a global namespace |
| Runtime mutation chains | 411 | Includes service-role bypass paths |
| Frontend mutation files | 41 | UI filters cannot be the security boundary |
| Repository-declared storage | 0 buckets/objects/path policies | Hosted drift check remains required |
| Scheduled jobs | 1 | `process-sms-queue`, every minute |
| Tenant-key occurrences in migrations | 0 | No `organization_id` or `tenant_id` |

`eligibility_rules` is present in generated types and views but has no repository
`CREATE TABLE` origin. The other generated/migration count differences must be
reconciled against the hosted migration ledger in Stage 7B preflight. Repository
SQL also creates some tables more than once with `IF NOT EXISTS` and repeatedly
redefines concurrency functions; later work must use the final applied definition,
not the first textual occurrence.

## Runtime and integration inventory

Every production edge function and non-test shared module is tenant-sensitive
unless it is explicitly a platform test/diagnostic surface. Test fixtures are
still pinned to a dedicated test organization. The 62 entrypoints are the
directories under `supabase/functions` containing `index.ts`; the automated check
guards that count.

Public ingress requiring an authoritative site/session/territory resolution:
`ai-chat`, `chat-quote`, `calculate-plan-options`, `calculate-quote`,
`save-quote`, `quote-resume`, `quote-decline`, `contact-request`,
`attribution-ingest`, customer verification/lookup/portal endpoints, booking
management and creation, confirmation, discount validation, and SMS opt-out.

Provider ingress requiring a unique provider-resource mapping:

| Provider | Routing key candidates | Current issue |
|---|---|---|
| Jobber | account ID + app ID + connector | One global OAuth connection; callback replaces all tokens |
| CallRail | account/company + destination/tracking number | One deployment-global sender and webhook secret |
| Resend/email | receiving domain/address, reply token, provider account | Inbound rows are persisted before tenant resolution; two outbound paths exist |
| Vapi | assistant ID + phone-number/DID | Shared secret and caller ID do not identify an organization |

Deployment-global credentials (Supabase service access, AI gateway, maps, webhook
authentication, cron authentication) are system secrets. Provider account
linkage, sender identity, phone/DID, owner recipients, transfer target, public
site identity, timezone, and branding are organization-scoped configuration.
Whether connector credentials remain platform-owned or become per-organization is
an unresolved security decision; business routing must be per-organization in
either design.

The sole repository-declared cron migration embeds a credential literal. This is
a security-remediation finding: do not reproduce it in tickets or logs. Rotation
and provider/configuration changes are explicitly outside Stage 7A.

## Authoritative write paths

| Authority boundary | Required tenant lineage |
|---|---|
| Quote/booking creation | Resolve organization before pricing; validate technician, property, customer, reservation, Jobber connector, booking, and attribution against it |
| Reschedule/cancel | Derive organization from authenticated account/membership and booking; retain Jobber-first, optimistic-concurrency, fail-closed behavior |
| Slot/SMS booking RPCs | Carry organization through claims, holds, confirmation, commit/failure, idempotency, and unique constraints |
| SMS outbox | Claim and finalize inside one organization; sender comes from its resolved connector |
| Jobber sync/webhooks | Resolve provider account before processing; use per-org locks, runs, tokens, and receipts |
| CallRail inbound/outbound | Resolve destination/provider mapping before canonical processing; tenant-key messages and conversations |
| Email inbound/outbound | Reply token or receiving address yields exactly one organization; sender and suppressions cannot cross it |
| Voice | Resolve DID/assistant before creating/loading a conversation; caller ID is not tenant identity |
| Consent | Customer and conversation lineage determines organization for current state and history |
| Pricing/config publication | Version activation and singleton uniqueness become organization-keyed |
| Knowledge/content | Revision, feedback, gaps, audit, retrieval, and learning stay in one organization |
| Attribution/property lifecycle | Copy organization from the authoritative booking/customer/property parent |
| Frontend admin writes | Active organization comes from verified membership; inserts carry it and updates/deletes predicate it; RLS independently enforces it |

Service-role functions, trigger functions, queue claimers, and webhook persistence
are not exempt. They must assert organization lineage internally because service
credentials bypass RLS.

## Ambiguous/manual-review inventory

- `contact_requests`: pre-identity public ingress requires deterministic site or
  territory resolution.
- `saved_scenarios`: decide user-private versus organization-shared ownership.
- `campaign_launch_controls`, `system_test_config`, `system_issues`, test runs and
  identities: decide whether platform-global and organization-scoped variants
  coexist.
- `email_suppressions`: separate provider/platform safety suppression from
  organization-specific communication consent if both are required.
- `embed_presets`, `lead_source_definitions`, `analytics_config`, `phone_numbers`:
  distinguish platform templates/infrastructure from organization instances.
- Legacy naming/provenance: verify the canonical SMS opt-out table and reconcile
  generated schema with the hosted migration ledger.

Rows that resolve to zero or multiple organizations are quarantined for review.
They are never silently assigned to DFW except for the explicitly approved,
bounded legacy backfill described in the migration plan.
