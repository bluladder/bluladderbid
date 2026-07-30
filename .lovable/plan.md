## Conclusions (read-only, verified on current main)

**1. Is email truly required?**
Yes — but only as an input to `save-quote`, not as a business requirement of the quote itself.
- `supabase/functions/save-quote/index.ts:126-128` hard-rejects any request without a syntactically valid email ("A valid email is required to save this bid."), and uses email as the customer identity key (`:234-262` find-or-create by `email`).
- The `quotes` table columns are nullable, so the database does **not** require it. The constraint is purely the edge function's contract.
- Practical consequence for voice: to reuse the canonical persistence path unchanged, an email must be supplied. Precedence: caller-spoken email → single unambiguous email resolved from the caller's phone digits → otherwise the quote-by-text ask must fail truthfully (no fabricated placeholder addresses).

**2. Which helpers/RPCs to reuse (no new parallel paths)**
- Persistence + link minting: existing `save-quote` edge function with `action: "save"` (server-side authoritative recompute, resume-token minting). No new quote writer.
- SMS dispatch: existing `send-sms` transactional path, which goes through `_shared/smsOutbox.ts`.
- Claim/idempotency RPC: `claim_sms_outbox_send` — the production-provisioned one. `claim_quote_sms_delivery` is referenced at `_shared/smsOutbox.ts:104` but is **not** provisioned in production; the fallback at `:119-129` already routes to `claim_sms_outbox_send`. **No migration is needed.**
- Bridge: the already-written `_shared/voice/quoteByTextDelivery.ts` (calls `save-quote` then `send-sms`), wired into `_shared/aiOrchestrator.ts` in place of the old hardcoded `deliver: null`.
- Email resolution: hardened `resolveQuoteRecipientEmail` (`quoteByTextDelivery.ts:82`) — exact last-10-digit match, returns `null` when the phone maps to more than one distinct email.

## Implementation plan

1. **Gate** — keep the live `deliver` closure behind `resolveVoiceBookingLane` (caller allowlist). Non-allowlisted callers keep the truthful "I can't text that yet" response.
2. **Email resolution order** — spoken email > unambiguous phone→email lookup > fail truthfully. Never synthesize an address.
3. **Persistence** — call `save-quote` with `action: "save"`, passing `sourceSessionId` so repeated asks in one call dedupe onto the same quote instead of creating duplicates.
4. **Dispatch** — send the returned resume link via `send-sms` with `customerInitiated: true`, E.164 destination, honoring opt-out/pause/suppression checks already in the outbox.
5. **Failure semantics** — if `save-quote` fails, or the total is zero/invalid, or email is unresolvable, return `deliver: null` with a spoken reason. Never claim a text was sent that wasn't.
6. **Tests** — success path, SMS failure, zero-total block, ambiguous email → zero upstream calls, partial-digit phone ignored, spoken email precedence, replay reuses `sourceSessionId`, allowlist gating.
7. **Gates** — Deno edge tests, frontend contract check, `tsgo`, build. No migration.

## Not in scope / deliberately not done
- No deployment. When authorized, the only functions needing deploy are the two importers of `aiOrchestrator.ts`: `ai-chat` and `voice-llm-adapter`.
- No new database migration, no new RPC, no secret changes; `PUBLIC_BOOKING_ENABLED=false` containment preserved.
- Open policy question for you: confirm verbal SMS consent is satisfied by E.164 + not-opted-out + not-paused + `customerInitiated`.
