# Edge Function Exposure Matrix

Snapshot of every edge function's public surface: who can call it, how the
caller is authenticated, and what defensive limits apply. Keep this file in
lockstep with `supabase/config.toml` and the function source — it is the
authoritative reference for launch reviews.

Legend:

- **Auth**
  - `public` — no JWT required (`verify_jwt = false` in `config.toml`)
  - `jwt`    — Supabase JWT required (`verify_jwt = true`, default)
  - `secret` — shared secret / HMAC / signed token verified in code
  - `admin`  — additionally checks `has_role(auth.uid(), 'admin')`
  - `service`— service-role bearer required (internal-only)
- **Rate limit**
  - `mem`    — in-memory (`rateLimit`) per instance
  - `shared` — DB-backed (`sharedRateLimit`) via `check_and_increment_rate_limit`
  - `identity`— endpoint-owned throttle (e.g. per-phone challenge table)
  - `—`      — none (justified in Notes)

## Public / customer-facing

| Function | Auth | Rate limit | Notes |
|----------|------|------------|-------|
| `customer-lookup` | public | mem (12/min) + shared (30/min) | Always returns generic response; no existence signal. |
| `manage-sms-optout` | public + portal cookie | mem (6/min) + shared (20/min) | Portal session required for state changes; unauth callers get generic 200. |
| `customer-verification-request` | public | identity (per-phone + per-IP challenge table) | Silent throttle in `customer_verification_challenges`; response is always generic. |
| `customer-verification-confirm` | public | identity (per-challenge attempts) | Fixed max-attempts on the challenge row itself. |
| `customer-verification-email-confirm` | public | identity (token single-use) | Token consumed on redemption. |
| `customer-verification-logout` | portal cookie | — | Idempotent; no PII path. |
| `attribution-ingest` | public | mem (30/min) + shared (120/min) | Whitelisted fields only; PII regex blocks emails/phones. |
| `calculate-quote` | public | mem (60/min) | Read-only calc; no PII. |
| `calculate-plan-options` | public | mem (40/min) | Read-only calc; no PII. |
| `validate-discount-code` | public | mem (10/min) | Discount validation only. |
| `chat-quote` | public | mem (30/min) | AI-gateway spend guarded by mem limiter. |
| `ai-chat` | public | mem (20/min) | AI-gateway spend guarded by mem limiter. |
| `save-quote` | public | — | Guarded by session token; supersedes older versions. |
| `handle-confirmation` | secret (token) | — | Single-use booking-management token. |
| `booking-management` | secret (token) | — | Single-use bootstrap redemption issues short-lived portal session. |
| `quote-decline` | secret (token) | — | Same-token model as booking-management. |
| `send-notification` | public | — | Rendered templates; recipients server-derived. |
| `send-sms` | jwt or service | mem (5/min per non-service caller) | Service role bypasses limiter for queue processor. |

## Webhooks (secret-authenticated)

| Function | Auth | Rate limit | Notes |
|----------|------|------------|-------|
| `inbound-email` | secret (`RESEND_INBOUND_WEBHOOK_SECRET`, constant-time) | shared (300/min) | Volume cap defends against leaked secret. |
| `resend-webhook` | secret (Svix-HMAC + 5-minute skew window) | — | Signature + replay window is the primary defense; add shared cap if abuse observed. |
| `callrail-inbound-sms` | secret (`CALLRAIL_WEBHOOK_SECRET`) | shared (300/min) | Downstream fans out to AI orchestrator. |
| `jobber-webhook` | secret (Jobber signature) | — | Idempotent by event id. |
| `jobber-oauth-callback` | secret (state token, CSRF-checked) | — | Single-use `jobber_oauth_states` row consumed on redemption. |

## Authenticated (Supabase JWT)

| Function | Auth | Rate limit | Notes |
|----------|------|------------|-------|
| `jobber-create-booking` | jwt or service | mem (6/min for non-service) | Service role bypasses limiter for internal flow. |
| `jobber-availability` | jwt | — | Read-only mirror lookup. |
| `jobber-connection-status` | admin | — | |
| `jobber-test-connection` | admin | — | |
| `jobber-oauth-url` | admin | — | |
| `jobber-autosync` | service | — | Pg_cron trigger. |
| `jobber-sync-schedule` | service | — | Pg_cron trigger. |
| `jobber-sync-users` | admin | — | |
| `jobber-reconcile-schedule` | admin | — | |
| `jobber-create-service-request` | jwt | — | |
| `customer-portal-data` | portal cookie | — | Session validated in code. |
| `customer-appointment-actions` | portal cookie | — | 48-hour lockout enforced. |
| `run-booking-test` | admin | — | Guarded by protected test identity. |
| `verify-schedule-mirror` | admin | — | |
| `staff-reply` | admin | — | |
| `knowledge-sync` | admin | — | |
| `campaign-transition-replay` | admin | — | |
| `email-diagnostics` | admin | — | |
| `escalation-test-notify` | admin | — | |
| `admin-conversation-action` | admin | — | Manages human takeover flag. |
| `customer-access-live-test` | admin | — | Single-use `customer_access_test_authorizations` row consumed. |
| `mcp` | jwt | — | MCP server surface. |

## Service-role only (internal)

| Function | Auth | Rate limit | Notes |
|----------|------|------------|-------|
| `process-sms-queue` | service | — | Pg_cron trigger. |
| `ops-alerts` | secret (`OPS_ALERTS_CRON_SECRET`) or admin | — | Cron + admin manual runs. |
| `campaign-event` | service | — | Called from other edge functions and pg_cron. |

## Shared rate limiter internals

Table: `public.rate_limit_buckets` (service-role only). Function:
`public.check_and_increment_rate_limit(_key text, _limit int, _window_ms int)`
returns `(allowed, current_count, reset_at)`. The bucket key is
`"<function-name>:<identifier>"` where the identifier defaults to the caller
IP (`x-forwarded-for` / `x-real-ip`) and can be overridden per-call — pass a
phone hash for OTP-style flows or an admin user id for admin actions. The RPC
is `SECURITY DEFINER`; `EXECUTE` is granted to `anon`, `authenticated`, and
`service_role` because public endpoints need to self-limit before doing work.
The table itself is not readable by any non-service role.

`sharedRateLimit()` **fails open**: when the DB round-trip errors or the
service env is missing, it logs `[sharedRateLimit] degraded` and allows the
request. The in-memory `rateLimit()` layer is therefore mandatory on every
public endpoint as a first-line burst brake.

## Change process

When adding a new edge function:

1. Add the row to the appropriate table above BEFORE merging.
2. If public, add `rateLimit()` and — for identity/PII/webhook paths —
   `sharedRateLimit()` with a namespaced key.
3. If it deviates from the `verify_jwt` default, add a stanza to
   `supabase/config.toml`.
4. If it consumes a shared secret, add the secret name to this document and
   confirm the secret exists via `fetch_secrets`.