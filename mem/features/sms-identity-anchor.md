---
name: SMS identity anchoring
description: Ambiguous phone resolution never gets promoted to a customer anchor by quote/booking enrichment; only a confirmed email or verified account can anchor.
type: feature
---
When `resolveInboundContext` returns `ambiguous` (multiple customers share the inbound phone), the thread MUST persist with `customer_id = NULL` and `awaiting_email_disambiguation = true`. The latest-quote / latest-booking enrichment step may only anchor a customer when resolution is `unresolved` (no phone match at all). Durable anchors: `customers.phone` unique, `customer_accounts.phone` verified, or `chat_conversations.confirmed_email_customer_id` (set after the customer replies with the email on file that matches exactly one candidate). The AI draft prompt must ask ONCE for the email — never name/address/SSN — and must not quote prices or times until anchored.