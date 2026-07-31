# BluLadder design decision log

Record decisions that affect multiple routes, create a new durable pattern, reject a credible alternative, or intentionally differentiate the website and BID.

## BLU-DESIGN-000 — Decision title

- Date:
- Status: Proposed / Approved / Superseded / Rejected
- Products: Shared / Website / BID
- Owner:
- Related audit finding or issue:
- Context:
- Decision:
- Alternatives considered:
- Customer rationale:
- Accessibility impact:
- Conversion impact:
- Engineering dependencies:
- Files or patterns affected:
- Verification evidence:
- Rollback or reconsideration condition:

## BLU-DESIGN-001 — Documentation-first cross-product synchronization

- Date: 2026-07-30
- Status: Approved
- Products: Shared
- Owner: Product design governance
- Context: The public website and BID are separate repositories, Lovable projects, Supabase projects, route systems, component trees, and deployment units. They share brand intent and frontend technology but do not have a shared release cadence.
- Decision: Synchronize shared design philosophy, review method, agent instructions, and governance through mirrored versioned files with a SHA-256 integrity check. Do not introduce a shared runtime component package during infrastructure setup.
- Alternatives considered: shared npm package; single-repository consolidation; unverified manual conventions.
- Customer rationale: Consistency improves without adding a deployment dependency between discovery and booking products.
- Accessibility impact: Shared accessibility requirements become explicit in both products.
- Conversion impact: Cross-product journey expectations become auditable.
- Engineering dependencies: Coordinated PRs when shared files change.
- Verification evidence: `npm run check:design-governance` in each repository.
- Rollback or reconsideration condition: Reconsider a shared package only after stable shared component ownership, independent versioning, and rollback procedures exist.
