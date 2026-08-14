# BluLadder Klamath Stage 8A hosted-compatibility repair

Status: **applied and verified**. Hosted execution version `20260814035656` is
recorded by a provider-generated receipt that differs from the canonical
migration only by its removed terminal line feed. Nothing in this record
authorizes deployment, provider setup, credentials, purchases, calls, messages,
traffic activation, or additional Lovable credit use.

## Root cause

The historical Stage 8A migration depends on
`public.is_organization_member(uuid, uuid)`. The hardened hosted tenant schema
intentionally removed that public `SECURITY DEFINER` helper, so the exact
historical payload correctly failed its prerequisite gate before any write.

Recreating the helper would undo the hardening. Replaying all historical
migration aliases would also be unsafe and is not part of this repair.

## Repair

The forward compatibility migration:

- requires the retired public helper to remain absent;
- accepts only an all-missing hosted state or an all-present compatible state;
- creates the four missing Stage 8A tables when required;
- preserves the exact DFW tenant and settings baseline;
- creates only the inactive Oregon schema/test fixture;
- enables RLS and installs direct active-membership predicates;
- grants authenticated access through RLS and explicitly keeps `anon` out;
- aborts on partial state, identity collision, DFW drift, or unsafe fixture
  state; and
- remains atomic with short lock and statement timeouts.

The then-unapplied Phase 1C migration was repaired in the same PR to use the
same direct membership policy. It no longer requires or recreates the retired
helper. Historical Stage 8A source remains byte-for-byte unchanged for ledger
reconciliation.

## Verification and future execution

Read-only preflight and postflight SQL expose only schema and non-PII counts.
The machine gate pins the historical Stage 8A SHA-256, rejects obsolete helper
policy calls, and proves every live action remains unauthorized. Disposable
PostgreSQL rehearsal covers hosted-missing application, compatible convergence,
RLS isolation, collision/partial-state stops, DFW preservation, and atomic
rollback.

The exact hosted preflight, application, receipt comparison, and postflight all
passed. The separately reviewed Phase 1C payload was later applied and verified.
Historical Stage 8A source remains byte-for-byte unchanged. Phase 1C remains
inactive, and all provider, runtime, publication, and traffic gates remain off.
