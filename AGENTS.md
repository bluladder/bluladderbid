# BluLadder Bid — Agent Operating Rules

This repository is the source of truth. Every coding agent must work through GitHub branches, commits, and draft pull requests so work remains visible from desktop or mobile.

## Operating model

- The primary agent acts as lead engineer and remains responsible for planning, delegation, integration, testing, and the final report.
- Specialized workers may be used for isolated backend, frontend, database, integration, security, documentation, or test tasks.
- Workers must not make independent architectural decisions that conflict with an active issue, accepted design, or another worker's contract.
- Parallel work is allowed only when file ownership and dependency boundaries are explicit.

## Mandatory startup checks

Before editing, report and verify:

1. `pwd`
2. `git status --short --branch`
3. `git remote -v`
4. `git fetch origin --prune`
5. the intended base branch and current HEAD
6. the relevant GitHub issue and any dependent issues or pull requests

Stop if GitHub access is unavailable, the repository is only a detached snapshot, the expected branch cannot be fetched, or another worktree contains conflicting uncommitted changes.

## Branch and PR rules

- One issue or cohesive workstream per branch.
- Branch naming: `codex/<short-kebab-description>`.
- Never implement substantial work directly on `main`.
- Push every meaningful completed workstream to GitHub.
- Open an actual draft PR; preparing PR metadata locally is not completion.
- Keep draft PRs open until required checks and dependency contracts pass.
- Do not merge, enable auto-merge, force-push, rewrite shared history, or close the issue unless explicitly authorized.
- A task is not considered handed off until the agent reports the GitHub branch, commit SHA, PR number, and PR URL.

## Safety boundaries

Ask before any action that is destructive, irreversible, credential-related, migration-applying, billing-related, or production-facing.

Without explicit approval, do not:

- deploy
- apply database migrations
- modify production data
- rotate or expose secrets
- change live integrations or webhooks
- alter production pricing or booking rules
- merge a pull request

Migration files and deployment plans may be prepared for review, but not applied.

## Architecture invariants

- Preserve existing DFW behavior unless the issue explicitly changes it.
- Resolve organization identity server-side; do not trust model- or client-supplied organization IDs for authoritative operations.
- Scope tenant-owned data, integrations, learning, recommendations, and outcomes by organization.
- Fail closed on tenant or connector ambiguity.
- Never train or infer across organizations.
- Keep AI recommendations advisory, bounded, explainable, versioned, auditable, and owner-activated.
- Do not silently modify business rules.
- Archived Jobber clients must remain excluded wherever the governing issue requires exclusion.
- Preserve idempotency, overlap protection, auditability, and manual-review escalation in booking and integration workflows.

## Parallel-worker protocol

Before delegation, the lead engineer must define for each worker:

- exact scope
- owned files or directories
- inputs and dependency contracts
- prohibited areas
- required tests
- expected deliverable

Workers must commit to isolated branches or worktrees. The lead engineer must review each worker's diff, resolve integration conflicts, and run the aggregate quality gate before reporting completion.

Do not run parallel workers against the same files or an unresolved shared schema contract.

## Quality gate

Run the checks relevant to the change, normally:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
deno test
```

Use repository-specific test commands where available. Clearly separate:

- newly introduced failures
- inherited failures
- unavailable tooling or network-blocked checks

Never describe a check as passing if it was skipped, blocked, or unavailable.

## Completion report

Every implementation report must include:

- issue addressed
- branch name
- commit SHA
- actual draft PR number and URL
- files changed
- behavior added or changed
- safeguards preserved
- tests run and exact results
- inherited failures or blockers
- dependency status
- production or migration actions not taken

The lead engineer remains responsible for ensuring the GitHub handoff is real and independently verifiable.

## BluLadder Product Design Director

For customer-facing visual design, UX, conversion, accessibility, mobile, or design QA work:

1. Use the custom agent `BluLadder Product Design Director`.
2. Invoke `$bluladder-product-design-review`.
3. Read `docs/design-system/product-profile.md`.
4. State exactly one mode: Audit, Design Director, Implementation, or Verification.

Audit and Design Director modes are read-only. Implementation requires explicit approved scope and must preserve all pricing, eligibility, scheduling, booking, authentication, authorization, organization, Jobber, Supabase, provider, analytics, and server-side business behavior. Verification does not edit product code.

Treat BluLadder BID as the guided quoting and booking product. Maintain shared brand language with the public website without importing website page structures or creating a shared runtime dependency.

Run `npm run check:design-governance` for changes to the agent, Skill, design governance, or product profile.
