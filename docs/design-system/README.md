# BluLadder product design governance

Version: 1.0.0

This directory governs customer-facing product design across the public BluLadder website and BluLadder BID. It creates one design language without coupling the products' runtime code or forcing identical page structures.

## Products

| Product | Customer job | Repository |
| --- | --- | --- |
| Public website | Discover, learn, establish trust, confirm local relevance, and enter a quote journey | `bluladder/bluladder` |
| BluLadder BID | Make guided service decisions, understand price and plan options, and complete booking | `bluladder/bluladderbid` |

Read `product-profile.md` in the active repository before inspecting routes or proposing changes.

## Codex entry points

- Named agent: `.codex/agents/bluladder-product-design-director.toml`
- Reusable workflow: `.agents/skills/bluladder-product-design-review/SKILL.md`
- Explicit invocation: `$bluladder-product-design-review`
- Governance validation: `npm run check:design-governance`

The named agent supports four strict modes:

1. **Audit** — read-only evidence and prioritized findings
2. **Design Director** — planning-only implementation specifications
3. **Implementation** — explicitly approved, bounded frontend changes
4. **Verification** — read-only browser and journey QA

Audit and Design Director modes never modify product code. Implementation mode never changes business rules.

## Source-of-truth map

| Topic | Source |
| --- | --- |
| Design philosophy and brand character | Skill `references/design-philosophy.md` |
| Review journeys, states, categories, and evidence | Skill `references/review-methodology.md` |
| Product identities and authority limits | Skill `references/product-boundaries.md` |
| Audit report format | Skill `assets/audit-report-template.md` |
| Shared colors, type, spacing, motion, accessibility, copy | `shared-system.md` |
| Approved and rejected patterns | `approved-patterns.md` |
| Product-specific architecture and behavior | `product-profile.md` |
| Design decisions and reversals | `decision-log.md` |
| Audit evidence and reports | `audits/` |
| Shared version and integrity hash | `governance.json` |

## Change governance

### Shared changes

A change to the agent, Skill, philosophy, review method, shared foundations, or common patterns is a coordinated change:

1. update both repositories with the same shared file contents;
2. bump `system_version` when behavior or policy changes;
3. regenerate the shared-contract SHA-256;
4. run `npm run check:design-governance` in both repositories;
5. open coordinated PRs and document any temporary version skew.

### Product-specific changes

Product route maps, implementation notes, and approved local exceptions live in `product-profile.md` and may change independently. A local exception must include its customer reason, scope, owner, verification, and reconsideration condition.

### Design decisions

Record decisions that affect more than one route, introduce a new pattern, reject a plausible alternative, or create an intentional cross-product difference in `decision-log.md`.

### Audit records

Create immutable, dated audit reports under `audits/YYYY-MM-DD-<product>-<scope>.md`. Store screenshots outside the source tree when they contain transient or sensitive evidence; link a sanitized artifact location.

## Implementation gate

No broad redesign begins from this infrastructure alone. Implementation requires:

- an approved audit finding or explicit scope;
- a Design Director specification;
- clear business-logic boundaries;
- a small reversible change set;
- objective acceptance criteria;
- appropriate focused and repository-wide validation.

Anything requiring pricing, eligibility, scheduling, booking, identity, authorization, CRM, Supabase schema, RLS, Edge Functions, webhooks, payments, secrets, analytics definitions, or server-side behavior is an engineering dependency.
