# CI/CD (§10)

BluLadder Bid is developed in Lovable and synced to GitHub. This document
describes the automated checks that gate every push and pull request, and
how deployment reaches production.

## Pipeline overview

GitHub Actions workflow: `.github/workflows/ci.yml`. Triggered on push to
`main`, on every pull request targeting `main`, and via manual dispatch.
Concurrency is scoped per ref so a new push cancels the previous run.

### Job: `frontend`

Runs on Bun (matches the local toolchain). Steps:

1. `bun install --frozen-lockfile` — reproducible install from `bun.lockb`.
2. `bun run lint` — ESLint over the whole tree.
3. `bunx tsc --noEmit` — full TypeScript typecheck.
4. `bun run test` — Vitest unit and component tests (React, engines,
   PostMessage bridge, calendar status, plan upsell fail-closed, ops
   aggregators, etc.).
5. `bun run build` — production Vite build; catches route/import
   regressions that only surface at bundle time.

### Job: `edge-functions`

Runs on Deno v1.x against `supabase/functions/`.

- `deno fmt --check` and `deno lint` run in advisory mode
  (`continue-on-error: true`) so style drift does not block a fix, but the
  signal is still visible on the PR.
- `deno test --allow-all --no-check supabase/functions/_shared` runs the
  ~29 shared test files that cover: booking cancellation, campaign engine
  and sweep, campaign transition replay, escalation, follow-up completion,
  Jobber cancellation, knowledge sync, lifecycle booking checks, pricing
  engine plan booking, phone config, email suppression, email reply
  tokens, conversation state, rate limit fail-open, AI orchestrator hooks,
  booking intent classifier, and more.

### Job: `campaigns-inactive-guard`

Grep-based safety net that fails the build if any migration under
`supabase/migrations/` sets `campaigns.status = 'active'`. Campaign
activation is an operational decision and must happen via the admin UI
(§12), never through a migration. This preserves the "all campaigns
remain in draft" invariant across every branch.

## Deployment

Lovable owns the deployment path — pushing to `main` publishes the
preview and, when the user promotes it, the `bid.bluladder.com`
production site. CI runs on the same commits so a failing pipeline is
visible before promotion. Supabase migrations are approved and executed
through the Lovable migration tool; edge functions are deployed through
the Lovable deploy tool. There is no separate `deploy` job in GitHub
Actions — CI is a verification gate, not the publisher.

## Local parity

The exact commands the pipeline runs are also the commands used locally:

```
bun install
bun run lint
bunx tsc --noEmit
bun run test
bun run build
deno test --allow-all --no-check supabase/functions/_shared
```

Running these before opening a PR reproduces the CI signal.

## Required secrets

CI does not need any application secrets: no runs hit Supabase, Resend,
CallRail, or the connector gateway. Runtime secrets stay in Lovable /
Supabase. If a future job needs credentials (for example an integration
test against a staging database), add them as GitHub Actions secrets and
scope them to the specific job.

## Failure triage

- **Lint / typecheck fails** — fix in-branch; these are hard blockers.
- **Vitest fails** — inspect the failing test; if a fixture drifted with
  a schema change, update the fixture in the same PR.
- **Deno tests fail** — the shared library under `supabase/functions/_shared`
  is the source of truth for engine behavior; do not "fix" a test to
  make it pass without understanding the engine change.
- **Campaigns inactive guard fails** — remove the `status = 'active'`
  write from the migration; do the activation from the admin UI.

## Related documents

- `docs/edge-function-exposure-matrix.md` — auth and rate-limit posture
  per edge function.
- `docs/inbound-email-setup.md` — Resend webhook configuration.
- `docs/future-campaign-channel-extension.md` — how to add a third
  campaign channel without breaking CI invariants.