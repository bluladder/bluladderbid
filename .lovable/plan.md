## Assessment (read-only; no edits, deploys, secrets, schema, or sends)

Verified against synced main. Findings below are backed by reads; the one open item is flagged as such.

### 1. Exact reason voice quote-by-text is disabled

`_shared/aiOrchestrator.ts:1158-1180` runs the truthful rail on every voice turn where `classifyQuoteByTextRequest` matches, and passes `deliver: null` (line 1169) with an inline comment stating no canonical voice-initiated quote-link delivery exists. `quoteByText.ts:85-96` therefore always returns `not_sent_delivery_unavailable`. It is a deliberate hardcoded null, not a config flag — nothing else blocks it.

### 2. Is email truly required?

Partly real, partly an artifact.

- Artifact: `save-quote/index.ts:126-129` hard-400s on a missing/invalid email, and the quote row itself does not need it — `quotes.customer_email` and `quotes.customer_phone` are both nullable (verified via schema query).
- Real constraint: `public.customers.email` is `NOT NULL` (verified), and save-quote resolves/creates the customer by email (`:234-276`). So a phone-only voice caller cannot create a customer through the canonical path today.
- SMS delivery itself does not need email: `send-sms` quote path reads `quotes.customer_phone`, mints its own resume URL (`:394-402`), and only uses email for the pause lookup (`:413`).

Smallest safe resolution: do not relax the email column. Instead accept a voice-initiated save only when either (a) an existing customer is matched by normalized phone (reuse their email), or (b) the caller gives an email. If neither, the rail keeps telling the truth ("I can't text it — want a teammate to follow up?"). No migration required.

### 3. Files/functions to change (all reuse, no parallel provider call)

- `_shared/voice/quoteByText.ts` — unchanged contract; it already only claims success when `deliver()` returns `{ok:true}`.
- New `_shared/voice/quoteByTextDelivery.ts` — builds the `deliver` closure:
  1. read canonical `quote_sessions` fields + orchestrator `facts` (services, address, sqft, stories, window type, name, phone, total/lineItems);
  2. resolve customer by `normalizePhone(phone)` to obtain an email, else use `fields.email`; bail (return `{ok:false}`) if neither;
  3. call `save-quote` server-side with `action:"save"` (never `"email"`) through the existing service-role sibling-invoke helper already used by `aiTools.ts` (`callFunction`, same pattern as `calculate-quote` at `aiTools.ts:266`), passing `homeDetails`/`additionalServices` from session fields plus the voice engine total as `clientDisplay`;
  4. on 200, call `send-sms` with `{eventType:"quote_created", quoteId, customerInitiated:true}` as a service caller (`send-sms/index.ts:281-319, 441-443` already permits exactly this) and return `{ok: transactionalSent}`.
- `_shared/aiOrchestrator.ts:1169` — replace `deliver: null` with that closure, gated by an allowlist/flag consistent with the existing voice gating (`voiceLiveBookingEnabled` / `VOICE_WORKFLOW_CONTROLLER_ALLOWLIST` in `aiTools.ts:41-45`) so rollout matches live-booking containment.

Reused as-is (no changes): `save-quote` authoritative recompute, organization resolution (`resolvePublicBookingOrganization`, server-side only — voice never supplies an org id), resume-token minting, `quote_calculated` campaign emission and supersession/abandonment logic; `send-sms` outbox key `quote_delivery:sms:{quoteId}:{digits}`, `sendOutboxSms`, `claim_quote_sms_delivery` (present in `supabase/migrations/20260730152500_repair_claim_quote_sms_delivery.sql`, with the `claim_sms_outbox_send` fallback in `_shared/smsOutbox.ts:118-186`), opt-out/pause/test-suppression gates (`send-sms/index.ts:417-450`).

**Migration: none.**

### 4. Deployment scope (not part of this pass)

Only `voice-llm-adapter` needs deployment, since the change is confined to `_shared` files it bundles plus the orchestrator. `save-quote` and `send-sms` are unchanged; they must simply already be deployed at current main (verify hashes before any future deploy). If the gating flag route is used, no new secret is required unless you choose a dedicated one.

### 5. Test plan (all offline)

- Unit: `quoteByTextDelivery` — no email and no phone-matched customer → `{ok:false}` and rail says "not sent"; save-quote non-200 → not sent; save-quote 200 + `transactionalSent:false` → not sent; both success → `sent` reply with the total.
- Unit: idempotency — two rapid requests in one call produce one `save-quote` (same `sourceSessionId` = quote session id, so the row is updated not duplicated) and one outbox claim (same semantic key → replay, no second CallRail dispatch).
- Existing suites that must stay green: `_shared/voice/voiceRemediation_test.ts`, `_shared/smsOutbox_test.ts`, `src/test/authoritativeQuoteDelivery.pathCoverage.test.ts`, `src/test/quoteSmsOutboxFallback.test.ts`, `src/test/unbookedQuoteFollowUp.*`, full `deno test`.
- No live call, no live SMS, no Jobber write in this phase.

### 6. Remaining production risk

- **Pricing mismatch (medium):** save-quote re-derives from `pricing_config` and 409s on tamper detection; if the voice rough-quote inputs are looser than the web payload, the caller could be told "not sent". Mitigation: treat 409/422 as truthful failure (already the default) and log the status.
- **ASR-derived data (medium):** a mis-heard address/sqft would persist a real quote row and fire `quote_calculated` (follow-up automation). Mitigation: require confirmed E.164 phone (already enforced) and only proceed when the session's quote is firm/estimated.
- **Consent (needs confirmation before build):** the `quote_created` path enforces opt-out, per-lead pause, and test-identity suppression, but I did not see `consent_allows` invoked there — for a verbally-given number we should confirm whether a transactional quote SMS requires a `communication_consent` row and, if so, record it via the existing `record_consent` tool at the moment the caller asks for the text. This is the one item to settle first.
- **Rollout blast radius (low):** gate to the owner allowlist for the first live test, exactly as live voice booking is gated.
