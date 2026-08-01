# Voice customer journey hardening plan

## Completion update — 2026-08-01

Branch `codex/voice-journey-completion` implements the remaining deterministic contract without changing production rollout flags:

- the quote session is the authoritative journey context and invalidates stale dependent state;
- all controller/draft pricing uses one canonical session adapter;
- the controller owns sticky intent, question parsing, assumption recap, pricing disposition, and price language;
- delivery preserves queued, provider-accepted, delivered, retry, uncertain, and terminal states;
- address recovery is component-specific and bounded;
- reachable legacy voice availability/booking verifies canonical readiness and full quote identity;
- secure organization/customer-scoped existing-record, appointment-mutation, and memo contracts are available;
- booking/reschedule/cancel truth requires provider and local persistence evidence;
- forty end-to-end scenarios are executable without provider calls.

Provider-specific live reschedule/cancel wiring and the final provider verification remain behind existing authorization/live gates. They must follow `docs/voice/voice-provider-verification-checklist.md`; this branch does not enable or test them live.

## Objective
Make voice calls deterministic, brief, and truthful for four customer intents:

1. Create a new quote.
2. Retrieve and schedule an existing quote.
3. Reschedule an existing appointment.
4. Cancel an existing appointment.

This plan is derived from production call `019fb423-7a5b-7990-98fe-6e7db8062f50` and the prior silent-call incident.

The canonical quote intake, pricing, readiness, tax, duration, provenance,
default, question-sequencing, and service-area contracts merged through PR #62
are authoritative. This plan may add voice normalization and orchestration
safeguards, but it must not redefine or duplicate those contracts.

## Current architecture finding
At the baseline, the rollout controller owned caller-ID confirmation and returning-customer lookup, then delegated pricing, quote delivery, availability, and booking back to the legacy orchestrator. This branch moves intake, recap, pricing, disposition, and offer identity into deterministic code. The provider mutation lane remains rollout-gated and is now a compatibility adapter into canonical readiness rather than a competing quote contract.

## Phase 1 — Transcript-derived parsing and state fixes

### Acceptance rules
- `one`, `1`, `one story`, `single story`, and `ranch` all capture `stories = 1`.
- `two`, `2`, and `two story` capture `stories = 2`.
- Spoken digit sequences such as `two five zero zero` normalize to `2500` when answering the square-footage question.
- Street numbers are never inferred as square footage.
- Explicitly captured window sides are sticky. `outside_only` cannot silently become `inside_and_outside`; residential scope remains whole-home by default and becomes partial only after an explicit customer request.
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
Follow the canonical voice sequence: service intent, callback phone, pricing
inputs, spoken price, then remaining contact/address facts before booking. At
the applicable stage, collect and persist:
- full name;
- confirmed phone;
- email;
- complete service address;
- selected service and canonical window sides; partial scope only when explicitly requested;
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
