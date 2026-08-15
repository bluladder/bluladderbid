# BluLadder Klamath / DFW Routing Acceptance Matrix

Issue #162 is represented by the machine-readable matrix at
`docs/operations/bluladder-klamath-dfw-routing-acceptance-matrix.json`.
The matrix is repository-only evidence: it makes no provider call, performs no
hosted mutation, and does not authorize Klamath activation.

## Authority rules

- A normalized service address is authoritative for organization routing.
- Missing or conflicting address authority fails closed and never falls back to the DFW legacy default.
- DFW is bound to Jobber. Klamath is bound to JobTread. Any provider/organization mismatch blocks before provider execution.
- A corrected address discards stale tenant and provider context, resolves
  authority again, and starts a new organization-scoped idempotency namespace.
- Idempotency is scoped by organization, capability/operation, semantic key,
  and canonical request fingerprint. A key cannot be reused across tenants.
- Klamath remains provisioning and customer traffic remains disabled. Future
  acceptance rows describe the required result only after a separate activation
  decision and every runtime/provider gate passes.

## Owner-approved Klamath operating subset

Automated scheduling is limited to Monday through Friday. Only window cleaning,
gutter cleaning, house washing, and pressure washing/flatwork belong to the
planned automated subset. Solar-panel cleaning, Christmas-light installation,
commercial exterior cleaning, and storefront window cleaning remain manual
review and may not enter automated pricing, booking, or provider-write paths.
Every unapproved service therefore remains manual review until a separate
owner-approved release changes that contract.

## Scenario matrix

| Scenario | Expected routing result | Safety proof |
|---|---|---|
| DFW address | DFW / Jobber | Explicit address authority; no fallback decision |
| Klamath address while provisioning | Blocked | No DFW fallback and no provider selection |
| Klamath address after separate activation | Klamath / JobTread | Contract-only future acceptance row |
| Missing address | Blocked | No organization, provider, or sensitive action |
| Address conflicts with prior tenant | Blocked pending fresh resolution | Stale context is not trusted |
| Corrected DFW-to-Klamath address | Re-resolve to Klamath / JobTread after activation | Old tenant, provider, and idempotency context discarded |
| Klamath with Jobber or DFW with JobTread | Blocked | Provider isolation is organization-scoped |
| Same-tenant semantic replay | One idempotent result after activation | Organization/capability/operation/fingerprint scope |
| Same external key across tenants | Independent tenant scope | No cross-tenant idempotency claim |
| Manual-review service | Manual review only | No automated price, booking, or provider write |

## Pass criteria

- The contract checker and focused Vitest suite pass.
- Every required category is represented by at least one scenario.
- The checked weekdays and service sets exactly match the authoritative Klamath
  tenant configuration.
- Every row forbids provider execution by this repository-only contract.
- No scenario permits DFW fallback for Klamath, preserves stale authority, or
  treats manual-review work as automated.
