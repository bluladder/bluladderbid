# PR #80 Release Preflight — Read-Only Report

No source, secret, environment, deployment, SQL, data, or provider state was changed. All findings come from the linked repository checkout, `supabase/config.toml`, the project's native backend metadata, and unauthenticated `OPTIONS` probes (no function logic invoked).

## 1. Linked commit

CONFIRMED. Linked repository HEAD is exactly:

```text
3ece0ec373a17d671cbb7ba6a44774c49affb35e   (2026-08-06 08:43:03 -0500)
```

Working tree is clean on the active edit branch.

## 2. Backend identity

CONFIRMED as the BluLadder Bid production backend, by exact non-secret identifiers:

- Project reference: `gyndziiuizpgwhqwyrvn`
- Backend URL: `https://gyndziiuizpgwhqwyrvn.supabase.co`
- Managed by Lovable: true; Paused: false
- Same reference is pinned in `supabase/config.toml` (`project_id`) and in the deployment smoke test's production constant.

No keys, tokens, passwords, or connection credentials are reproduced here.

## 3. Function existence

All four exist in source and answer on the deployed edge runtime (no `NOT_FOUND_FUNCTION_BLOB`):

| Function | Source present | Deployed probe |
| --- | --- | --- |
| validate-discount-code | yes | 200 |
| send-sms | yes | 200 |
| voice-vapi-events | yes | 200 |
| voice-llm-adapter | yes | 200 |

## 4. Version marker and verify_jwt

| Function | Build/version marker | verify_jwt |
| --- | --- | --- |
| validate-discount-code | none (no build marker emitted; version = commit only) | false (explicit in config.toml) |
| send-sms | none (no build marker emitted; version = commit only) | false (explicit in config.toml) |
| voice-vapi-events | shared `BUILD_ID` = `voice-adapter-4C-b.6.8-address-gate-enforcement` | false (explicit in config.toml) |
| voice-llm-adapter | shared `BUILD_ID` = `voice-adapter-4C-b.6.8-address-gate-enforcement` | false (explicit in config.toml) |

Note: `BUILD_ID` is a shared constant, so the two voice functions cannot be distinguished from each other by marker alone; the authoritative per-deploy identity is the commit SHA above. The marker string is unchanged from the previously deployed value, so a post-deploy read-back of the marker will NOT by itself prove the new bundle landed.

## 5. Flag presence (state only, no values)

| Variable | State |
| --- | --- |
| VOICE_LIVE_BOOKING_ENABLED | present |
| VOICE_PROVIDER_DEBUG | absent |
| VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE | absent |
| VOICE_LATENCY_METRICS | absent |
| VOICE_WORKFLOW_CONTROLLER_ENABLED | absent |

Code defaults for the absent flags: provider debug fails closed (off, and additionally suppressed in production without the override), latency metrics off, workflow controller defaults to enabled-with-allowlist per `rolloutRoute.ts` — so its behavior is governed by the separately present allowlist/test-secret secrets rather than by an explicit enable flag.

## 6. Blockers to deploying the four bundles in order

No hard blocker found for the deployment sequence itself:

1. validate-discount-code
2. send-sms
3. voice-vapi-events
4. voice-llm-adapter

Conditions and cautions to record before proceeding:

- Deployment must be authorized separately; this preflight performed none.
- CI (lint, typecheck, unit, build, deno tests) and the SQL/migration gate must be green at `3ece0ec…` — not verified in this read-only pass, since running them was outside the requested scope.
- `send-sms` and `voice-llm-adapter` sit on live customer-facing delivery paths; deploy them only after the two lower-risk bundles read back healthy.
- Verification caveat: because `BUILD_ID` is unchanged, confirm the deploy by the platform's reported deployment/revision result plus a `GET /diagnostics` 200 on `voice-llm-adapter`, not by marker comparison.
- `verify_jwt = false` is declared for all four in the single `config.toml`; do not add per-function overrides during deploy.
- Voice live-booking and public-booking flags are owner-controlled secrets; nothing in this sequence should change them.

Redaction: no tokens, keys, phone numbers, customer data, transcripts, or provider identifiers are included above.
