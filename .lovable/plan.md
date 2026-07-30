## Goal

Make voice "text me the quote" genuinely deliver a real customer quote link via the existing canonical paths — no parallel provider call, no new SMS pathway, no migration.

## Verified current state (read-only, this turn)

- Synced tree already contains the wiring built in the previous turn: `supabase/functions/_shared/voice/quoteByTextDelivery.ts` (new), `quoteByTextDelivery_test.ts` (new, 5 tests), plus `aiOrchestrator.ts` and `aiTools.ts` edits. So the remaining work is hardening + verification + authorized deploy, not new plumbing.
- `save-quote` (`index.ts:126-136`) hard-requires a valid `email`, at least one service, and `total > 0`. With `action:"save"` no email is ever sent (`emailStatus` stays `skipped`). It resolves/creates the customer by email (`:234-276`), reuses an existing open quote for the same `source_session_id` (`:301-320`), recomputes every dollar figure server-side (`:161-195`, client total used only for tamper detection), mints the resume token (`:444`), and emits `quote_calculated` with idempotency key `quote_calculated:{quoteId}:v{...}` (`:543`).
- Production RPC inventory: `claim_sms_outbox_send` and `finalize_sms_outbox_send` exist; **`claim_quote_sms_delivery` does not exist in production.** The `smsOutbox.ts` fallback (base claim + conflict-safe `quote_id` bind) is therefore the live path. No migration needed.
- `test_identities` has `+14692150144 / blmillen@gmail.com` with `active = false` → real transactional sends are permitted for the owner.
- Two `customers` rows share phone digits `4692150144` with different emails (`blmillen@gmail.com`, `ben@bluladder.com`). Phone→email resolution is therefore ambiguous and must be deterministic (see safety).
- `properties` / `property_facts` persistence lives in `_shared/profile/propertyRepo.ts` and is **not** touched by `save-quote`; the current voice delivery path does not write property rows.

## Answers to the seven questions

**1. Paths reused.** Customer + quote persistence, org resolution, authoritative recompute, resume-token minting, and campaign emission: `save-quote` (`action:"save"`). Customer-facing SMS: `send-sms` with `eventType:"quote_created"`, which mints a fresh opaque resume URL and dispatches through `sendOutboxSms`. Property/profile persistence stays out of scope for this slice.

**2. Internal invoke vs extraction.** Keep the internal service-role invoke of `save-quote` (already implemented via the exported `callFunction`). Tradeoffs: invoking keeps one authoritative implementation, inherits `resolvePublicBookingOrganization`, tamper detection, supersede logic, and resume-token behavior for free, and needs zero refactor of a launch-critical function; costs one extra in-region HTTP hop (~100-200ms, acceptable off the speech path) and couples voice to save-quote's request contract. Extraction into a shared core would remove the hop but touches the public web booking path — unjustified risk right now.

**3. Facts → authoritative input.** `ConversationFacts.services` + `facts.property.{squareFootage, stories, windowCleaningType, condition, roofType, roofSeverity, drivewaySqft, drivewaySurface, pressureWashSqft, pressureWashSurface}` + `facts.discountCode` are mapped through the **exported canonical** `buildQuoteRequest` from `aiTools.ts` (same mapper the pricing tool uses), so voice cannot introduce a divergent mapping. `facts.quote.total` is sent only as `total`/`subtotal` for tamper detection — save-quote recomputes. Missing fields voice must supply: **phone** (confirmed E.164, already gated), **name** (already gated), **email** (not collectable reliably by voice → resolved from the customer already on file for that phone, else the rail truthfully reports "not sent"), **address** (passed into `homeDetails.address` when known; not required by save-quote).

**4. Idempotency / replay.** Persistence: `sourceSessionId` = canonical quote-session id → repeated asks in one call update the same quote row instead of creating duplicates. Resume token: minted per save inside `save-quote`, prior tokens revoked on supersede. SMS: semantic outbound key `quote_delivery:sms:{quoteId}:{digits}` claimed via `claim_sms_outbox_send` (production fallback), so a replay returns the existing evidence and never re-dispatches; `finalize_sms_outbox_send` is claim-token guarded. Campaign event: `quote_calculated:{quoteId}:v{...}`.

**5. Migration.** None required. Optional follow-up (not in this slice): apply `20260730152500_repair_claim_quote_sms_delivery.sql` so the quote-lineage wrapper exists natively; until then the tested fallback covers it.

**6. Files, tests, gates, deploy.**
- Already in tree: `_shared/voice/quoteByTextDelivery.ts`, `_shared/aiOrchestrator.ts` (deliver closure, allowlist-gated), `_shared/aiTools.ts` (export `buildQuoteRequest`, `callFunction`), `_shared/voice/quoteByTextDelivery_test.ts`.
- To add in this slice: deterministic email resolution (below) + tests covering ambiguous phone→email, the `email_unavailable` truthful reply, replay of a second "text it to me" in the same call reusing one quote, and an `aiOrchestrator` test asserting the non-allowlisted lane still passes `deliver: null`.
- Gates: `deno test --allow-all supabase/functions/`, `node scripts/check-voice-booking-contract.mjs`, `bunx vitest run`, `tsgo`/`bun run build`.
- Deploy: **`ai-chat` and `voice-llm-adapter` only** (the two importers of `aiOrchestrator.ts`). `save-quote` and `send-sms` are unchanged and must not be redeployed.

**7. Safety issues to resolve before production.**
- **Ambiguous phone→email** (two live rows on the owner's digits). Fix: prefer an exact `phone`-digit match that also has a `customer_accounts`/auth linkage or the most recent *quote*, and if more than one distinct email matches, resolve to "not sent" rather than guessing — a wrong email would attach a real quote to the wrong customer record.
- Verbal SMS consent is enforced only as valid E.164 + not opted out + not paused + `customerInitiated:true`; there is no explicit voice consent ledger. Confirm that is acceptable policy.
- Voice ASR address/sqft error means the persisted quote can differ from what was spoken; the resume link lets the customer correct it, and save-quote's recompute prevents price tampering.
- Containment preserved: `PUBLIC_BOOKING_ENABLED=false`, Oregon inactive, existing voice allowlist and `VOICE_LIVE_BOOKING_ENABLED` untouched. The live delivery lane requires **both** the existing flag and the caller-phone allowlist, so no arbitrary inbound caller can trigger a send. No Jobber call, no message/call sent, no secret/provider change, no production writes during analysis.

## Technical steps

1. Harden `resolveQuoteRecipientEmail` in `_shared/voice/quoteByTextDelivery.ts`: exact last-10-digit match, collapse candidates, return `null` when distinct emails conflict.
2. Add the four tests listed above.
3. Run all gates and report exact counts.
4. On explicit owner authorization only: deploy `ai-chat` + `voice-llm-adapter`, then verify diagnostics read-only. No live call or SMS in that step unless separately authorized.
