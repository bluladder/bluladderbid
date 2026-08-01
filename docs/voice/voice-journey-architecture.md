# Deterministic Voice Journey Architecture

Status: branch implementation contract; rollout flags and production configuration are unchanged.
Baseline: `4e1cafa78166a510b216cb063537fbe094c83f24`.

## Ownership map

| State or decision | Authority | Compatibility adapter | Invariant |
|---|---|---|---|
| Service scope, answers, provenance, recap | `quote_sessions.fields` through `quoteSession.ts` and the Sales Engine contract | `chat_conversations.facts` | Legacy facts may be hydrated into the session, but may not overwrite current canonical facts or create verified provenance. |
| Price inputs | `quoteSessionPricingAdapter.ts` | `draftTools` and controller call the adapter | No default story, surface, area, count, promotion, or side is inserted by an adapter. |
| Price and tax | canonical pricing engine | byte-identical frontend/Edge mirror | The model never performs arithmetic. |
| Product-policy disposition | intake evaluation plus `quoteDisposition.ts` | legacy `firm` is diagnostic only | Mathematical firmness does not override manual review or an unresolved owner decision. |
| Quote identity | session id, quote id, canonical input key, rule/engine/tax/duration versions | legacy availability offer stores the complete identity | Delivery, availability, and booking reject an identity mismatch. |
| Duration | pricing result plus `durationContract.ts` | none | Null, zero, stale, or guessed duration blocks scheduling. |
| Service area | `serviceArea.ts` plus explicit voice address confirmation | `ConversationFacts.addressCandidate` holds recovery state | Availability cannot use a geocode until the caller confirms the normalized address. |
| Delivery | existing quote email claim/finalization and SMS outbox | voice maps provider states without collapsing them | Provider acceptance may be described only as “accepted for delivery”; “delivered” requires an actual delivery event. |
| Availability | `bookingReadiness.ts` then `availabilityLookup.ts` | the legacy voice tool now delegates to this path | Identity, property ownership, quote freshness, duration, area, schedule freshness, and action gate must all pass. |
| Booking | current offer plus live booking adapter/creator and local reconciliation | rollout/live gates remain unchanged | Provider acceptance without local persistence is uncertain and non-retryable by the caller. |
| Existing records | identity and organization-scoping helpers exist as contract-level building blocks | not wired into the production controller in this tranche | The controller fails closed with `tenant_authority_required`; caller ID never unlocks stored records. |
| Reschedule/cancel | appointment-recovery helpers model confirmation and provider/local evidence | not wired into the production controller in this tranche | The controller fails closed with `tenant_authority_required`; no appointment mutation is attempted. |
| Field-team memo | bounded memo helper exists as a contract-level building block | not wired into the production controller in this tranche | The controller fails closed with `tenant_authority_required`; no note is written. |

## Canonical journey state

The journey extension lives in the existing `quote_sessions.fields.voiceJourney` JSONB object. No new table or migration is required.

- `intent` is established first and remains sticky.
- `quoteContext` stores the canonical fingerprint, quote identity, pricing/tax/duration versions, disposition, totals, and authoritative duration evidence.
- `delivery` preserves channel, attempt/provider identifiers, and a truthful state.
- `availability` binds offered slots to the booking-context key and expiry.
- `booking` preserves submission/recovery state and the idempotency key.
- `existingRecord` may be set only after identity and ownership verification.

Price-changing corrections clear the cached quote, acceptance, delivery, availability, and booking. Contact or address corrections preserve a current price but clear availability and booking. A default or customer estimate remains distinct from a captured or verified answer and must be confirmed in the final recap.

## Deterministic turn sequence

1. Classify the reason for the call with the approved opening.
2. Confirm or collect a callback number without treating caller ID as identity proof.
3. Parse only the field asked on the prior turn.
4. Ask the next field from the canonical service contract.
5. Recap applicable price inputs and assumptions; require explicit confirmation.
6. Calculate through the canonical adapter and engine.
7. Resolve engine status, product policy, and channel eligibility into the final quote disposition.
8. Speak a firm price only when the final disposition is firm, using the approved assurance.
9. Collect delivery/booking facts after price as required.
10. Validate and explicitly confirm the normalized service address.
11. Run canonical booking readiness and fetch a small current slot set.
12. Bind the selected slot to the exact quote and offer; revalidate immediately before mutation.
13. Claim booking success only after authoritative provider and local persistence evidence. Existing-quote, appointment-change, and memo intents stop at the tenant-authority boundary until that production integration is separately completed.

## Address recovery

The address candidate retains street number, street name, optional unit, city, state, ZIP, normalized address, partial/exact confidence, ambiguity, and service-area status. Recovery asks only the missing component. A component gets two attempts; exhaustion preserves the request for follow-up rather than looping or guessing. Full normalized-address confirmation is still required before scheduling.

## Provider boundary taxonomy

| Boundary | Success that may be claimed | Retry/pending | Uncertain | Confirmed failure |
|---|---|---|---|---|
| SMS/email | provider accepted for delivery; delivered only after a delivery event | queued/retry pending | provider outcome or finalization unknown | permanent rejection/validation failure |
| Availability | fresh, versioned slots from the authoritative engine | refresh required/rate limited | timeout/malformed provider outcome | readiness or policy blocker |
| Booking | provider accepted and local record persisted/reconciled | slot may be refreshed only after a confirmed rejection | accepted-local-unconfirmed or provider outcome unknown | slot lost, rejected, or disabled |
| Reschedule/cancel | provider mutation and local versioned persistence confirmed | only an idempotent replay of a known request | outcome unknown; never auto-repeat | confirmed rejection; old appointment remains |

Raw provider responses, credentials, internal row identifiers, and full PII are never customer-facing. Provider-specific execution stays behind the current live gates; this branch does not change those gates.

## Legacy alignment

The pre-routing transcript normalizer still runs before both routes. The controller and draft calculator use the one canonical session-to-engine adapter. The reachable legacy voice availability tool now calls canonical readiness/availability and stores the complete quote identity with the offer. Its booking tool re-resolves readiness and rejects stale offer identity before reaching the existing live gate and idempotent booking creator.

`ConversationFacts` remains a compatibility rendering/state adapter. Its older fingerprint must not authorize voice delivery, availability, or booking. New critical authorization is based on the quote session.

The existing-record, reschedule/cancel, and field-team memo modules currently prove isolated contracts only. They are not production controller integrations. Until server-derived tenant authority and identity ownership are wired through those actions, the production controller returns `tenant_authority_required` and performs no read or mutation.

## Security and operations

- Organization authority is server-derived; no controller/model/client organization id is trusted.
- Service-role reads are organization- and customer-scoped before record mapping.
- Identity is resolved before stored prices, addresses, or appointments are disclosed.
- The production controller performs no phone-only customer lookup or returning-customer greeting until organization authority is server-derived.
- Existing RLS, provider authentication, action gates, suppression, and rollout configuration remain unchanged.
- Durable work uses existing outboxes/claims. `waitUntil` is not treated as durable delivery.
- Edge-to-Edge compatibility calls remain only where already deployed; no new chain was added. The canonical availability adapter adds a bounded timeout to its existing call.
- Logs and customer language use reason codes, not secrets or raw provider payloads.

## Rollback

No schema rollback is necessary. The branch can be reverted as code and documentation. Existing JSONB readers ignore unknown `voiceJourney` keys. Rollout flags can keep the controller disabled without removing stored canonical quote data.
