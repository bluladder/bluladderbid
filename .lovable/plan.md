# Attribution & Revenue Tracking — Facebook Pilot

Preserve campaign attribution from bluladder.com landing page → quote → booking, and fire deduplicated Meta Pixel events using server-authoritative revenue. No changes to pricing, scheduling, Jobber mutations, AI orchestration, availability, discount rules, cancellation, authorization, or the newly completed upsell UI.

## 1. Attribution capture & session store

**New:** `src/lib/attribution/attribution.ts`

Extends the existing `useUtmTracking` model (currently sessionStorage-only, keys `bluladder_utm_params`). Adds:
- `fbclid`, `landing_page_slug`, `referrer`, `source_session_id`
- `first_touch` block (frozen after first meta/paid source seen) and `last_touch` block
- Rule: a valid Meta first-touch (`utm_source ∈ {facebook, fb, meta, instagram, ig}` OR `fbclid` present) is never overwritten by later direct traffic. Non-meta first touches also freeze after first write.

**Storage:** `localStorage` for first-touch (survives refresh), `sessionStorage` for last-touch. Anonymous `source_session_id` = `crypto.randomUUID()` minted once per browser.

**Hook:** replace/augment `useUtmTracking` — same file to keep call sites — capturing new params in `Index.tsx`, `ServiceLanding.tsx`, `PlanBuilder.tsx` on mount.

## 2. Cross-domain handoff (bluladder.com → bluladderbid.lovable.app)

**Method:** Query-string handoff only (smallest secure surface). Landing page appends the whitelisted params to the "Get Instant Quote" link. No PII, no prices, no discounts, no secrets in URL.

**Whitelist enforced client-side:** `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `landing_page_slug`, `referrer`, `source_session_id`. Unknown params dropped. All values length-capped (≤200 chars) and sanitized.

**Landing-page snippet** (documented in final report, one-line change on bluladder.com side): append current UTMs + `fbclid` + `landing_page_slug=fb-window-cleaning-offer-bid` + generated `source_session_id` to the CTA link href.

## 3. Server persistence

**New table** `attribution_events` — one row per anonymous session:
```
id uuid pk, source_session_id text unique, first_touch jsonb,
last_touch jsonb, landing_page_slug text, fbclid text, referrer text,
customer_id uuid null, quote_id uuid null, booking_id uuid null,
jobber_client_id text null, jobber_job_id text null, created_at, updated_at
```
Grants: `authenticated`/`service_role` write; anon insert allowed via edge function only (not direct). RLS: only service role reads/writes.

**Extend existing tables** (columns only, no logic change):
- `quotes`: `attribution jsonb`, `source_session_id text`, `quote_completion_seconds int`, `estimated_quote_revenue numeric`, `pricing_version text`, `quote_created_at timestamptz`
- `bookings`: `attribution jsonb`, `source_session_id text`, `quote_to_booking_seconds int`, `booked_revenue numeric`, `booked_subtotal numeric`, `booked_discount_amount numeric`, `booked_bundle_savings numeric`, `booked_service_count int`, `booked_services jsonb`, `booking_completed_at timestamptz`, `meta_events_fired jsonb` (dedupe registry)

All revenue fields are written **server-side only** — the edge functions `calculate-quote` (already canonical) and `jobber-create-booking` (already canonical) populate them from their own results. Client never supplies revenue.

**New edge function** `attribution-ingest`: accepts `{ source_session_id, first_touch, last_touch, landing_page_slug, fbclid, referrer }`, upserts into `attribution_events`. Rate-limited via existing `_shared/rateLimit.ts`. No PII accepted.

**Modify `jobber-create-booking`** (persistence only, no behavior change): after successful Jobber write, populate the new `bookings` columns from the already-computed canonical totals + link `attribution_events.booking_id/jobber_job_id`. Idempotent by existing booking idempotency key.

## 4. Meta Pixel events

**New:** `src/lib/attribution/metaPixel.ts` — thin wrapper around `window.fbq` with:
- `fireLead(quote)` — event_id = `lead_${quote.id}`, params `{ value: quote.quoted_total, currency: 'USD', content_name: 'Instant Quote', content_category: 'Home Services', service_count, services_selected, city, zip_code, lead_source: 'fb_window_cleaning_offer_bid' }`
- `fireSchedule(booking)` — event_id = `schedule_${booking.id}`, requires `jobber_visit_id`
- `fireCompleteRegistration(booking)` — event_id = `complete_${booking.id}_completeregistration`

**Firing sites** (client only, gated by server data):
- **Lead:** `useServerQuoteCalculation` success handler in `OneTimeSummary` / `PricingSummary` when a *firm* canonical response arrives (`firm: true`, has `quoted_total`).
- **Schedule:** `BookingConfirmation` mount, only when `booking.jobber_visit_id` is present on the server response.
- **CompleteRegistration:** `BookingConfirmation` mount, same gate as Schedule.

**Dedup:** localStorage set `meta_events_fired` keyed by event_id, plus `bookings.meta_events_fired` jsonb registry updated via a small edge function `meta-event-log` (best-effort; localStorage handles the common cases). Meta itself dedupes by event_id across browser/server.

**PII scrub:** helper strips name/email/phone/street before fbq call. Only `city` + `zip_code` allowed as location.

## 5. Admin dashboard data source

Extend the existing admin marketing view (small SQL view addition, no new dashboard UI in this pass):
- Add `admin_marketing_funnel` SQL view joining `attribution_events`, `quotes`, `bookings` exposing the metrics in requirement §8.
- If the admin already has a marketing panel, add a data hook `useMarketingFunnel` reading from the view. Otherwise, defer visual work — data is queryable.

## 6. Tests

**New:**
- `src/lib/attribution/attribution.test.ts` — handoff survival, first-touch freeze, Meta source not overwritten by direct, PII rejection, session id stability.
- `src/lib/attribution/metaPixel.test.ts` — Lead value = canonical `quoted_total`; no fire without firm quote; Schedule requires `jobber_visit_id`; failed booking → no Schedule; dedupe on rerender + refresh + idempotent replay; PII scrub; browser cannot inject revenue.
- `supabase/functions/attribution-ingest/*_test.ts` — rate limit, whitelist, rejects unknown fields.

Regression: full existing suite (pricing 256, booking, campaign) must stay green — verified.

## 7. Privacy

- Meta payloads restricted to `city`, `zip_code`, service metadata, canonical revenue.
- Server logs redact `attribution.first_touch.referrer` beyond hostname.
- No Meta credentials or service-role keys in client code. Pixel ID stays in existing pixel snippet in `index.html`.

## 8. What does NOT change

Pricing engine (client + server), discount validation, availability, `jobber-create-booking` business logic, AI orchestrator, authorization, cancellation, upsell UI (`CompleteYourRefresh`, `LiveQuoteBar`, `IntentFirstServiceSelector`).

## Technical details

```text
bluladder.com landing
  └─ CTA href += ?utm_*&fbclid&landing_page_slug&source_session_id
       │
       ▼
BluLadder Bid (React)
  ├─ attribution.ts captures + stores (localStorage first-touch, sessionStorage last-touch)
  ├─ attribution-ingest edge fn ← upsert attribution_events
  ├─ calculate-quote (unchanged logic) → server writes quotes.attribution + revenue cols
  │   └─ Lead pixel fires (event_id=lead_<quote_id>) with server value
  ├─ jobber-create-booking (unchanged logic) → server writes bookings.* + attribution join
  │   └─ Schedule pixel fires (event_id=schedule_<booking_id>) with server value + visit_id
  │   └─ CompleteRegistration pixel fires once (event_id=complete_<booking_id>_cr)
  └─ admin_marketing_funnel view exposes revenue metrics
```

**Migration:** one SQL migration adding `attribution_events` table (+ GRANTs + RLS), extending `quotes`/`bookings` with new columns, adding `admin_marketing_funnel` view.

**Small bluladder.com change (documented in final report):** add UTM+fbclid+landing_page_slug+session_id passthrough to the "Get Instant Quote" link. One-line JS snippet provided in report.

**No live event fired during implementation** — tests stub `window.fbq`; no live Jobber writes, no live customer messages, no live pixel events.
