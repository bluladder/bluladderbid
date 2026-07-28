# BluLadder Bid Engineering Operating System

## Objective

Allow Ben to direct development from one conversation—often from a phone—without manually supervising multiple coding agents. GitHub is the durable coordination layer. The lead engineer owns delegation and integration; specialized agents perform bounded implementation work.

## Roles

### Product owner — Ben

Ben defines business intent, priorities, and approval for destructive, production-facing, credential, billing, migration-application, and merge actions. Routine implementation decisions should not require continuous supervision when they remain within an approved GitHub issue.

### Technical director — primary ChatGPT conversation

The technical director maintains roadmap context, clarifies requirements, sequences issues, checks GitHub state, reviews draft PRs, identifies dependencies, and recommends approval or correction. The technical director may edit GitHub documentation and issue metadata directly when appropriate.

### Lead implementation agent — Codex

The lead implementation agent receives one issue or cohesive workstream. It inspects the repository, creates an execution plan, delegates bounded subtasks where supported, integrates worker output, runs checks, pushes the branch, and opens an actual draft PR.

### Specialized workers

Workers are temporary and narrowly scoped. Typical roles include database, backend, frontend, integration, security, QA, and documentation. Workers do not merge or independently redefine shared contracts.

## Source of truth

GitHub is the shared source of truth for all agents and devices.

A local implementation is not durable handoff until it has:

1. a pushed GitHub branch
2. an identifiable commit SHA
3. an actual draft pull request
4. a test and blocker report in the PR

Local-only commits and locally prepared PR descriptions are incomplete work.

## Standard lifecycle

### 1. Intake

The technical director verifies the issue, dependencies, existing PRs, and current repository state. The issue should contain acceptance criteria, constraints, safety boundaries, and dependency references.

### 2. Assignment

The technical director gives the lead implementation agent one issue and requires it to operate under `AGENTS.md`.

### 3. Reconnaissance

Before editing, the lead agent verifies the repository, remote access, base/head refs, worktree cleanliness, relevant code, active dependencies, and inherited test failures.

### 4. Execution plan

The lead agent creates a file-ownership and dependency plan. Parallel workers are used only for independent scopes. Shared schema, generated types, central contracts, and overlapping files are serialized.

### 5. Implementation

Workers produce small, reviewable commits. The lead agent reviews and integrates them. No worker applies migrations, deploys, changes production data, or handles credentials without approval.

### 6. Aggregate validation

The lead agent runs lint, TypeScript checks, frontend tests, Deno tests, production build, and focused tests required by the issue. Blocked checks are reported as blocked—not passed.

### 7. GitHub handoff

The branch is pushed and an actual draft PR is opened. The PR references the issue, describes architectural decisions, lists tests and inherited failures, and remains draft until dependencies and CI pass.

### 8. Review

The technical director inspects the GitHub diff and CI. It either recommends corrections, approves readiness for human review, or identifies a dependency that should remain unresolved.

### 9. Human gate

Ben authorizes migration application, deployment, credential changes, production-facing actions, and merge. These are never assumed from general implementation authorization.

## Parallelization rules

Parallelize when tasks have independent file ownership and stable contracts, such as:

- documentation and isolated tests
- frontend view against an already-defined API contract
- separate adapters implementing one stable interface
- focused QA against unchanged implementation files

Serialize when tasks share:

- database schema or migrations
- generated Supabase types
- organization-resolution contracts
- pricing or booking authority
- common integration runtime
- the same source files
- unresolved upstream issue requirements

## Mobile-first interaction

Ben should be able to send a compact instruction such as:

> Continue issue #9 under the repository operating rules. Use a lead-agent workflow, push the branch, and open a draft PR. Do not deploy or merge.

The implementation agent should continue without repeated confirmation unless it reaches a protected action or a genuine product ambiguity that cannot be resolved from the issue and repository.

Progress that exists only in a desktop Codex session is not considered visible. GitHub updates are the mechanism that makes work reviewable from Ben's phone and by the technical director.

## Definition of done

An issue implementation is ready for review only when:

- acceptance criteria are implemented or explicitly deferred
- architectural invariants are preserved
- focused and aggregate tests have been run
- failures are accurately classified
- documentation is updated where needed
- the branch is pushed
- a real draft PR exists
- the PR identifies dependencies and protected actions not taken
- no production action occurred without approval

## Lead-agent launch prompt

Use the following compact prompt after the operating-system PR is merged:

```text
Act as the lead implementation engineer for bluladder/bluladderbid.
Read and follow AGENTS.md before doing anything else.

Work on GitHub issue #<NUMBER> as one cohesive workstream. Inspect the issue, repository, related issues, existing branches, and pull requests first. Verify remote GitHub access and stop if the repository is only a local snapshot.

Create a plan and delegate only genuinely independent subtasks with explicit file ownership and stable contracts. You remain responsible for reviewing, integrating, and testing all worker output.

Work on a codex/<description> branch. Push all completed work and open an actual draft PR against main. A local commit or locally prepared PR description is not completion.

Do not deploy, apply migrations, modify production data, change credentials, alter live integrations, force-push, merge, or close the issue without explicit approval.

Run the applicable quality gate and accurately distinguish passing, failing, inherited, unavailable, and network-blocked checks.

Return a concise completion report containing the branch, commit SHA, actual PR number and URL, files changed, tests, blockers, dependencies, and protected actions not taken.
```

## Current rollout

1. Merge this operating-system documentation.
2. Require new Codex workstreams to read `AGENTS.md`.
3. Preserve existing in-progress branches; do not restart useful local work.
4. Require those workers to push and create actual draft PRs.
5. Review current workstreams through GitHub before launching additional parallel implementation.
6. After the tenant foundation and CI baseline stabilize, expand parallelization selectively.