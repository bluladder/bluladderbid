# BluLadder Klamath Stage 8A hosted-compatibility repair

Status: **repository-only repair candidate**. Nothing in this repair authorizes
merge, migration application, deployment, hosted mutation, provider setup,
credentials, purchases, calls, messages, or Lovable credit use.

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

The still-unapplied Phase 1C migration is repaired in the same PR to use the
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

Any hosted application requires a new exact authorization after this draft PR
passes review and CI. The forward Stage 8A compatibility payload must be
verified before the separately reviewed Phase 1C payload. Klamath remains
absent until Phase 1C and remains fully inactive afterward.
