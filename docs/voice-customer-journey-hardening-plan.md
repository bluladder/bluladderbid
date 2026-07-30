# Voice customer journey hardening plan

## Objective
Make voice calls deterministic, brief, and truthful for four customer intents:

1. Create a new quote.
2. Retrieve and schedule an existing quote.
3. Reschedule an existing appointment.
4. Cancel an existing appointment.

This plan is derived from production call `019fb423-7a5b-7990-98fe-6e7db8062f50` and the prior silent-call incident.

## Current architecture finding
The rollout controller owns caller-ID confirmation and returning-customer lookup, then delegates pricing, quote delivery, availability, and booking back to the legacy orchestrator. That split is the main source of repeated questions, mutable facts, price drift, and promises that are not backed by durable tool results.

## Phase 1 — Transcript-derived parsing and state fixes

### Acceptance rules
- `one`, `1`, `one story`, `single story`, and `ranch` all capture `stories = 1`.
- `two`, `2`, and `two story` capture `stories = 2`.
- Spoken digit sequences such as `two five zero zero` normalize to `2500` when answering the square-footage question.
- Street numbers are never inferred as square footage.
- Confirmed service scope is sticky. `exterior_only` cannot silently become `inside_and_outside`.
- A quote is recalculated only after an explicit customer correction to a pricing input.
- The assistant speaks one authoritative quote total per quote version.
- Address validation errors name the missing or ambiguous component instead of asking for the entire address repeatedly.

### Regression fixtures
Add a fixture based on call `019fb423-7a5b-7990-98fe-6e7db8062f50` covering:
- answer `one` to the story question;
- spoken square footage;
- exterior-only service persistence;
- stable quote price;
- address normalization;
- availability failure;
- quote-by-text request with truthful delivery outcome.

## Phase 2 — Deterministic customer/profile intake
Before quote delivery or booking, collect and persist:
- full name;
- confirmed phone;
- email;
- complete service address;
- selected service and scope;
- property facts required by the pricing engine.

Ask one missing question at a time and never ask again when the field status is captured or verified.

## Phase 3 — Durable quote lifecycle
Voice must use the same durable quote record as web:
- customer and property relationship;
- immutable quote version and line items;
- quote link generation;
- SMS/email outbox delivery;
- follow-up sequence enrollment.

The assistant may say a quote was sent only after provider acceptance. On failure it must report that delivery did not complete.

## Phase 4 — Existing quote retrieval
Resolve by caller ID, then disambiguate only when necessary. Support:
- read latest open quote;
- resend quote;
- accept and schedule quote;
- update quote by creating a new version;
- decline quote.

Never ask the customer to repeat property facts already stored on a valid quote.

## Phase 5 — Live scheduling
- Retrieve authoritative Jobber availability.
- Offer at most three slots.
- Require explicit slot selection and final confirmation.
- Use idempotent booking keys and truthful provider errors.
- Never claim calendar access or appointment creation without a successful tool result.

## Phase 6 — Reschedule and cancellation
Implement deterministic workflows for:
- locating upcoming appointments;
- selecting the relevant appointment;
- retrieving replacement availability;
- confirming and applying a reschedule;
- confirming and applying a cancellation;
- sending updated confirmation.

## Delivery sequence
1. Parser/state regression PR.
2. Durable quote-delivery PR.
3. Existing-quote retrieval PR.
4. Calendar/booking hardening PR.
5. Reschedule/cancel PR.
6. GitHub Actions workflow for approved Supabase Edge Function deployments.

Each PR must include transcript-derived tests and must not require a paid phone call for basic validation.
