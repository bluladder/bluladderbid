---
name: Voice quote-by-text delivery
description: How voice "text me the quote" delivers for real — canonical save-quote + send-sms, allowlist-gated, email-resolution rules
type: feature
---
# Voice quote-by-text delivery

Voice never calls a provider directly. `_shared/voice/quoteByTextDelivery.ts` composes
two canonical paths: `save-quote` with `action:"save"` (authoritative recompute, org
resolution, resume token, `quote_calculated` event, NEVER an email), then `send-sms`
with `eventType:"quote_created"` + `customerInitiated:true` (outbox, opt-out, pause,
test-identity suppression). The assistant may claim a send ONLY when send-sms returns
`transactionalSent: true`.

Rules:
- Live lane requires BOTH `VOICE_LIVE_BOOKING_ENABLED` and the caller phone on
  `VOICE_WORKFLOW_CONTROLLER_ALLOWLIST`; otherwise `deliver` stays null and the caller
  hears the truthful "not sent" reply.
- `customers.email` is NOT NULL, so email comes from the caller or from the single
  on-file customer for that exact last-10 phone digits. If the phone maps to more than
  one distinct email, resolve to "not sent" — never guess, never fabricate a placeholder.
- Facts → engine input goes through the exported canonical `buildQuoteRequest` in
  `aiTools.ts`; `facts.quote.total` is sent only for tamper detection.
- Idempotency: `sourceSessionId` = quote-session id (one quote row per call),
  outbound key `quote_delivery:sms:{quoteId}:{digits}`.
- `claim_quote_sms_delivery` is absent in production; the `smsOutbox.ts` fallback to
  `claim_sms_outbox_send` + conflict-safe quote-lineage bind is the live path. No migration.
- Importers of `aiOrchestrator.ts` (`ai-chat`, `voice-llm-adapter`) are the only
  functions that need deployment for changes to this rail.