# CallRail-Delivered Passwordless Verification — Architecture Report

Per your instruction *"Report the chosen session architecture before schema changes"*, this is the pre-schema report. Nothing has been written yet.

## 1. Existing CallRail integration (findings)

- **Reused, not duplicated.** All outbound SMS already flows through `supabase/functions/_shared/sms.ts` → `sendCallRailSms()` and the `send-sms` / `process-sms-queue` functions. This is the only client we will use.
- **Sender number** is read from `CALLRAIL_SENDER_NUMBER` (Edge Function secret). The number **(469) 747-2877** is the tracking number configured in that secret and is already actively sending transactional SMS in production (booking/quote events). The number does not appear in code — never has, never will.
- **Secrets used, never exposed:** `CALLRAIL_API_KEY`, `CALLRAIL_ACCOUNT_ID`, `CALLRAIL_COMPANY_ID`, `CALLRAIL_SENDER_NUMBER`. Sent as `Authorization: Token token="..."` header from Edge Functions only. Never logged, never returned to browser.
- **Idempotency + delivery tracking:** every send writes a row to `sms_messages` with `status` (pending/sent/failed/cancelled), `callrail_message_id`, `attempts`, `next_retry_at`. Suitable for our OTP audit trail.
- **Test-identity suppression:** `checkSuppression()` + `test_identities` table + `trg_protect_test_identity` DB trigger are respected by every send path — we will keep this and add the operations-admin single-message override you specified.
- **10DLC / texting registration status:** *cannot be confirmed from code.* It is a CallRail dashboard property. Your existing production traffic through this number implies it is registered, but I will flag this in the final report as "operator-confirmed, not code-verified".

**Conclusion:** the existing integration can send transactional OTP SMS from (469) 747-2877 with no new CallRail client, no new secret, no second integration.

## 2. Session architecture decision — RECOMMENDED

Two options were evaluated:

**A. Supabase Auth phone bridge.** Requires a native SMS provider registered with Supabase Auth (Twilio/MessageBird/Vonage). CallRail is *not* a supported Supabase Auth provider, so making Supabase mint the session from a CallRail OTP would require us to (a) call `auth.admin.createUser` / `generateLink` from a trusted Edge Function after we verify the OTP ourselves, and (b) return a session to the browser. This works but relies on admin APIs on every login and produces `auth.users` rows for every verified phone.

**B. Server-managed customer portal session** (RECOMMENDED). We verify the OTP server-side, then issue an opaque random token (256-bit), store only its SHA-256 hash in a `customer_portal_sessions` table linked to a `customer_accounts` row, and set it as an httpOnly cookie via Edge Function response. All customer portal data is fetched through Edge Functions that validate the session hash and return only rows for the linked `customer_id`. RLS on `customers`/`quotes`/`bookings` stays locked to `service_role` + admin — the browser never queries those tables directly.

**Why B:**
- CallRail is a delivery-only integration; we don't need Supabase Auth to know about it.
- Avoids provisioning an `auth.users` row per verified phone (cleaner customer/staff separation).
- Keeps the RLS surface tiny: we don't need per-table policies at all for portal data — the Edge Function is the sole reader.
- Fully revocable, absolute + inactivity expiration, explicit logout, audit-friendly.
- Trivially compatible with the existing Lovable/Supabase deployment.

**Trade-off acknowledged:** no `auth.uid()` on portal reads. Mitigated by making the *only* code path for portal data server-side Edge Functions that validate the session cookie.

I will proceed with **Option B** unless you say otherwise.

## 3. Build plan (after approval)

### Schema (single migration)
1. `customer_accounts` — `id`, `customer_id` FK, `verified_phone` (E.164, unique), `created_at`, `last_verified_at`. Service-role only.
2. `customer_verification_challenges` — `id`, `phone_hash` (sha256), `otp_hash` (sha256), `status` (pending/verified/expired/locked/cancelled), `attempts`, `max_attempts` (default 5), `expires_at`, `ip_hash`, `callrail_message_id`, `correlation_id`, timestamps. Service-role only.
3. `customer_portal_sessions` — `id`, `session_token_hash`, `customer_account_id` FK, `created_at`, `last_seen_at`, `absolute_expires_at`, `revoked_at`. Service-role only.
4. `booking_management_tokens` — `id`, `token_hash`, `booking_id` FK, `expires_at`, `consumed_at`, `revoked_at`. Service-role only.
5. `customer_account_match_issues` — admin review queue for ambiguous phone matches.
6. `verification_rate_limits` — per-phone-hash and per-ip-hash counters (or reuse `rateLimit` in-memory; DB version chosen for durability across function cold starts).
7. Admin-only config table `customer_verification_config` for cooldown / max-per-hour / max-attempts / TTL (all values centralized here; defaults match your spec: 60s cooldown, 5/hour/phone, 10/hour/ip, 5 attempts, 10-min TTL).
8. GRANTs: service_role only on all new tables. Admin SELECT via `is_admin()` for the admin diagnostics view.
9. Remove insecure email-JWT policies on `customers`, `quotes`, `bookings` — replace with admin/service_role only. (Anonymous quote/booking flow already uses service-role Edge Functions for writes, so no regression.)

### Edge Functions
- `customer-verification-request` — normalize E.164, rate-limit, generate 6-digit code, hash+store, enqueue CallRail send through existing `sendCallRailSms`, return generic response.
- `customer-verification-confirm` — validate hash, check attempts/expiry, resolve unambiguous customer match (create `customer_account` if new), issue portal session cookie, return generic customer summary.
- `customer-verification-logout` — revoke session.
- `customer-portal-data` — one endpoint returning `{ recentQuotes(30d), previousWork, appointments, servicePlan }` for the session's customer.
- `booking-management-request` / `booking-management-view` / `booking-management-action` — token-scoped booking operations.
- Ops-admin single-message override toggle wired through `authorize_staff_test_reply` / `consume_staff_test_reply_auth` pattern.

### Frontend
- Replace `/my-appointments` placeholder with the new phone-OTP entry screen.
- Portal shell: Recent Quotes / Previous Work / Appointments / Plan.
- Email OTP fallback via Supabase email OTP on the same entry screen.
- Booking-confirmation SMS/email gets a `?t=<opaque>` management link.

### Tests
All 21 test requirements you listed, added as `_test.ts` for Deno functions + Vitest for UI. No live SMS/email/Jobber/Meta calls (CallRail client mocked; `checkSuppression` and rate-limits verified).

## 4. Preserved from Stage A (untouched)
- Anonymous `customer-lookup` still returns no PII / no existence signal.
- Anonymous `CustomerLookup` prefill stays removed.
- `/my-appointments` remains disabled until this ships and passes the protected live test.
- `big_job_settings` admin-only.
- Crew/staffing internals admin-only.
- Public MCP allowlist unchanged.

## 5. Live tests deferred (operator-run, not automated)
- One CallRail OTP delivery test to the approved test identity (single-message admin override).
- One booking-management-link SMS test to the approved test identity.

## Questions before I start writing the migration
1. **Confirm Option B** (server-managed portal session, no `auth.users` rows for customers). If you want the Supabase Auth phone bridge instead, say so.
2. **Portal session lifetimes:** default proposal — 30-minute inactivity, 12-hour absolute. OK?
3. **Booking-management link TTL:** default proposal — valid until 48h after appointment end, single-use for cancel/reschedule actions but reusable for view. OK?

Once you confirm, I will land the migration, functions, UI, and tests in one pass.
