# Customer Intelligence Phase 2

## Policy

- GitHub/Codex is the primary engineering path.
- Lovable is not used for routine coding, planning, testing, or UI work.
- No deployment or production migration is performed from this branch.
- Email responses remain Gmail drafts only.
- Approved low-risk SMS automation is handled in later phases.

## Attribution model

Self-reported source and machine attribution are deliberately stored separately. First-touch values are immutable after initial capture; last-touch values update as a prospect returns through another campaign or channel.

Canonical fields:

- `self_reported_source`
- `self_reported_source_detail`
- `normalized_source_key`
- `attribution_source`
- `attribution_medium`
- `attribution_campaign`
- `attribution_content`
- `first_touch`
- `last_touch`
- `first_touch_referrer`
- `last_touch_referrer`
- `callrail_tracking_number`
- `callrail_campaign`

## Jobber mapping policy

The source catalog contains a per-source `jobber_mapping_mode`:

1. `native` when the installed Jobber API version demonstrably exposes a writable native lead-source field.
2. `custom_field` when a configured Jobber custom field is available.
3. `internal_note` as the safe default fallback.
4. `disabled` when downstream synchronization is intentionally suppressed.

Every write must first claim a deterministic `idempotency_key` in `lead_source_sync_events`. A retry may update the existing audit row, but must not create duplicate Jobber notes or custom-field writes.

## Current branch status

Implemented foundation:

- Canonical source catalog and seed values.
- Alias-based normalization.
- `Other` detail validation.
- Additive attribution columns.
- First-touch/last-touch merge utility.
- Deterministic Jobber payload and fallback utility.
- Focused unit tests.

Still required before Phase 2 is complete:

- Wire browser capture into the existing attribution/session service.
- Add the required-before-submit source selector to every final quote and booking path.
- Persist source data to quote, booking, customer, and Jobber sync flows.
- Add admin source management and sync-error views.
- Audit the live Jobber GraphQL schema used by the repository and select the supported mapping mode.
- Regenerate Supabase TypeScript types after applying the migration in the managed backend.
- Run typecheck, build, Vitest, and Deno tests.
