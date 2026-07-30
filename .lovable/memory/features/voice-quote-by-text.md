---
name: Voice quote-by-text delivery
description: How voice "text me the quote" delivers for real — canonical save-quote + send-sms, NOT booking-gated, deterministic email resolution, cross-turn pending state
type: feature
---
# Voice quote-by-text delivery

Voice never calls a provider directly. `_shared/voice/quoteByTextDelivery.ts` composes
two canonical paths: `save-quote` with `action:"save"` (authoritative recompute, org
resolution, resume token, `quote_calculated` event, NEVER an email), then `send-sms`
with `eventType:"quote_created"` + `customerInitiated:true` (outbox, opt-out, pause,
test-identity suppression). The assistant may claim a send ONLY when send-sms returns
`transactionalSent: true` AND `deliveryStatus: "accepted"`.

Rules:
- Quote-by-text is a QUOTE feature and is deliberately NOT gated on the live-booking
  flag or the caller allowlist: it writes no appointment. Its own guards are a FIRM
  current quote (`isQuoteFirm`), a confirmed E.164 phone, an `eligible` service address,
  no promotion (unmappable price), and a resolvable email.
- `customers.email` is NOT NULL. Email resolves deterministically: spoken email >
  `quote_sessions.email_normalized` > `chat_conversations.confirmed_email` >
  `prospect_email` > the exact linked `customers.id`. There is NO phone-based search
  (multiple customers share a phone with different emails). Unresolved => "not sent".
- Missing data does not end the request: `facts.quoteByText.pending` persists, the rail
  auto-resumes next turn, and `classifyQuoteByTextCancellation` ("never mind", "don't
  text it") clears it. Truthful replies are reason-aware and ask for the one missing
  field (phone / name / address / email).
- Facts → engine input goes through the exported canonical `buildQuoteRequest` in
  `aiTools.ts`; `facts.quote.total` is sent only for tamper detection.
- Idempotency: `sourceSessionId` = quote-session id, falling back to the conversation id
  (never null), so repeated asks update ONE quote row;
  outbound key `quote_delivery:sms:{quoteId}:{digits}`.
- `claim_quote_sms_delivery` is absent in production; the `smsOutbox.ts` fallback to
  `claim_sms_outbox_send` + conflict-safe quote-lineage bind is the live path. No migration.
- Importers of `aiOrchestrator.ts` (`ai-chat`, `voice-llm-adapter`) are the only
  functions that need deployment for changes to this rail.
- The public web flow's "Text me this bid" is live (`BID_BY_TEXT_ENABLED = true` in
  `OneTimeSummary.tsx`) and uses the same save-quote -> send-sms sequence.