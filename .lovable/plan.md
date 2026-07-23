# Customer Profiles, Multi-Property & Verified Facts (Phase 1)

## 1. Current architecture (inspected)

- `customers`: one row per email. Single `address text`, single `phone`, single `jobber_client_id`, `auth_user_id`.
- `customer_accounts`: verified identity (`verified_phone`, `verified_email`, `auth_user_id`) → `customer_id` (1:1 conceptually; multiple accounts per customer possible).
- `quotes`: address lives inside `home_details_json` and `input_snapshot`; also `customer_email/phone/name` denormalized. No property FK.
- `bookings`: has `jobber_job_id/quote_id/visit_id`; address embedded in booking record (not shown but same pattern), no property FK.
- `quote_sessions`: single `fields jsonb` bag, no property FK.
- `chat_conversations`: has `customer_id`, no property FK.
- Jobber sync: property IDs are not persisted anywhere in `public.*` today — only `jobber_client_id` on `customers` and job/quote/visit IDs on `bookings`.

**Verdict:** there is **no multi-property model today**. Address is a free-text column on `customers` plus embedded JSON on quotes/bookings. This request needs a net-new normalized property + property_facts layer plus a customer↔property join table. Existing customer/account/quote/booking IDs are preserved; nothing gets migrated destructively.

## 2. Scope of this plan

Non-goals (per your constraints): availability tools, booking creation, slot holding, reschedule/cancel, pricing formula changes, Twilio, voice, portal redesign, Jobber history portal.

Goals: shared customer+property model, verified property facts with provenance, resolver + autofill tools for the SMS AI draft flow, idempotent backfill from `customers`/`quotes`/`bookings`, admin visibility, tests.

## 3. Schema (single migration)

New tables (all with GRANTs + RLS):

- `public.properties`
  - `id uuid pk`, `normalized_address text` (unique with city+state+zip), `street`, `city`, `state`, `postal_code`, `latitude`, `longitude`, `property_type` (`residential|commercial`), `jobber_property_id text null`, `active bool`, `created_at`, `updated_at`.

- `public.customer_properties` (join)
  - `id`, `customer_id fk`, `property_id fk`, `relationship_type` (`owner|resident|property_manager|realtor|family|authorized_contact|other`), `label text` ("Primary home", "Mom's house"), `is_primary bool`, `authorization_status` (`self_asserted|verified|revoked`), `active bool`, timestamps.
  - Unique `(customer_id, property_id)`.

- `public.property_facts`
  - `id`, `property_id fk`, `fact_type text` (enum-like string, e.g. `house_sqft`, `stories`, `window_units`, `driveway_sqft`, `roof_pitch_category`, `access_notes`…), `value_numeric numeric null`, `value_text text null`, `unit text null`, `source text` (`prior_quote|booking|jobber|technician|admin|customer_provided|imported|ai_inferred`), `source_record_id uuid null`, `verification_status text` (`verified|customer_provided|inferred|conflicting|stale|needs_review`), `confidence numeric null`, `observed_at timestamptz null`, `last_verified_at timestamptz null`, `created_by_type text`, `created_by_id uuid null`, timestamps.
  - Index on `(property_id, fact_type)`; **no** unique — we keep provenance history.
  - View `property_facts_current`: most-recent non-superseded fact per `(property_id, fact_type)`, respecting a source-rank (technician > admin > jobber > booking > customer_provided > prior_quote > imported > ai_inferred).

- Add columns:
  - `customers`: `customer_type text default 'homeowner'`, `preferred_contact_method text null`, `preferred_phone text null`, `preferred_email text null`, `notes text null`.
  - `quote_sessions`: `property_id uuid null references properties(id)`.
  - `chat_conversations`: `property_id uuid null references properties(id)`.
  - `quotes`: `property_id uuid null references properties(id)`.
  - `bookings`: `property_id uuid null references properties(id)`.

RLS:
- `properties`, `customer_properties`, `property_facts`: admin full access + `service_role` for edge functions. Anon: none. Authenticated: only via `customer_properties` where their linked `customer_accounts.customer_id` matches (SELECT of their own properties + their own facts).

## 4. Service ↔ fact autofill mapping

Server-side constant module `supabase/functions/_shared/profile/serviceFactMap.ts`:

```
gutter_cleaning: reuse [address, house_sqft, stories, gutter_linear_feet?]
window_cleaning: reuse [address, stories, window_units, screen_count]
house_wash:      reuse [house_sqft, stories, siding_material?]
driveway:        reuse [driveway_sqft, driveway_material]
patio:           reuse [front_patio_sqft, back_patio_sqft, surface_material]
roof:            reuse [roof_pitch_category, stories, roof_sqft?]
```

Never substitutes `house_sqft` for driveway/patio. Never reuses prior price — always re-runs canonical `pricingEngine`.

## 5. New shared modules

- `_shared/profile/customerResolver.ts` — thin wrapper reusing existing `conversationContext.ts` + `workflow/customerResolver.ts`; returns `{customerId, confidence}` only.
- `_shared/profile/propertyResolver.ts` — resolves the property for a conversation: primary → recent quote/booking property → deterministic single match → ambiguous list.
- `_shared/profile/propertyFacts.ts` — read current facts, `proposeFact`, `confirmFact` (conflict-safe, records provenance, never overwrites `technician`/`admin` sources silently; flags conflicts to admin queue).
- `_shared/profile/quoteAutofill.ts` — given `(property_id, service)` returns `{reusable, stale, missing, confirmRequired}` using the map + facts view.

## 6. AI tool allowlist (added to `draftTools.ts`)

All tools resolve customer/property server-side from the conversation; the model cannot pass an arbitrary `customer_id` or `property_id`.

- `get_resolved_customer_profile()`
- `get_customer_properties()`
- `select_conversation_property({property_id})` — must belong to resolved customer
- `get_property_profile()` — facts for currently-selected property only
- `get_reusable_quote_inputs({service})`
- `propose_property_fact({fact_type, value})` — stages; never overwrites
- `confirm_property_fact({fact_type, value})` — controlled write via conflict rules

No availability, no booking, no arbitrary search. Existing `calculate_quote` tool remains authoritative for pricing.

## 7. Quote-session autofill flow (SMS draft)

When the AI drafts a reply for a quote intent:
1. Resolve customer via existing context.
2. Resolve/select property (auto if 1, ask if >1, collect if 0).
3. Load reusable facts via autofill map.
4. Fill `quote_sessions.fields` only for permitted inputs, mark `field_status` = `autofilled_from_profile`.
5. Ask only next missing required input.
6. On complete, call existing `calculate_quote` — never reuse historical price.

## 8. Backfill

New edge function `backfill-property-profiles` (admin-only, idempotent, dry-run flag):
- Walk `customers` with non-null `address`; upsert into `properties` via normalized address key; create `customer_properties(is_primary=true, relationship_type='owner')`.
- Walk last 180 days of `quotes` + all `bookings`; upsert their addresses as properties, link to `customer_properties`, and extract deterministic facts from `home_details_json` (sqft, stories, window_units, driveway_sqft, patio_sqft, roof pitch) with `source='prior_quote'|'booking'`, `verification_status='customer_provided'`.
- Skip ambiguous customers, skip when address is empty, never infer from price.
- Report `{created, linked, conflicted, ambiguous, skipped, failed}`.

## 9. Admin UI

Extend the existing `QuoteContextPanel` in `ConversationsTabContent.tsx` (no redesign):
- Resolved customer chip.
- Selected property + list of other associated properties.
- Facts table: value • source • verification badge • last verified.
- Highlights for conflicting/stale/missing.
- Read-only in this phase; edits deferred.

## 10. Security

- All resolver + tool calls are server-side and scoped to the current conversation.
- Model inputs `property_id` are validated against `customer_properties` for the resolved customer.
- Anon has no access to new tables.
- Authenticated portal users see only their own `customer_properties`.
- No service-role or Jobber tokens exposed.
- Tool-call logs strip full addresses in favor of `{propertyId, factType}`.

## 11. Tests

Vitest + Deno tests covering the 20 cases you listed, including: single-property auto-load, multi-property must-select, unresolved cannot see properties, duplicate-address prevention, prior-quote backfill provenance, gutter reuses `house_sqft`, driveway does NOT reuse `house_sqft`, technician outranks AI, current pricing recalculated, RLS isolates customers.

## 12. What ships / what doesn't

Files added:
- 1 migration
- `_shared/profile/*.ts` (4 modules + tests)
- `backfill-property-profiles/index.ts`
- Extensions to `draftTools.ts`, `draftReply.ts`, `conversationContext.ts`
- `QuoteContextPanel` extension in admin conversations
- Vitest + Deno tests

Explicitly NOT in this phase: availability, booking, hold/cancel/reschedule, pricing changes, portal redesign, Jobber history sync, voice.

## 13. Next smallest phase (after approval of this one)

"Availability lookup + explicitly confirmed booking against the selected property" — reusing `jobber_busy_blocks` mirror, lead-anchored crew, 44px UI, and a single new `book_selected_slot` tool that requires explicit customer confirmation and writes through the existing `jobber-create-booking` path — no new pricing, no autonomous booking.

---

Approve and I'll implement the migration + shared modules + tools + backfill + admin panel + tests in one pass. If you want me to split it (e.g. migration + resolver first, backfill + AI tools second), say the word.
