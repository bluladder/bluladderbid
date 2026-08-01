# BluLadder Bid quote-intake audit

Audit date: 2026-07-30  
Audited repository: `bluladder/bluladderbid`  
Audited commit: `127da891712bf0127e151705dd4fce1afa6a55aa` (`main`)

This is a read-only discovery report. “Required” below means observed runtime behavior, not the presence of a TypeScript property. Prices themselves remain configuration-driven; this report describes inputs and rules, not live monetary configuration.

## 1 — Executive summary

### Supported automated paths

The canonical server engine can calculate firm quotes for whole-home window cleaning (exterior or inside/outside), house washing, gutter cleaning and its three add-ons, roof cleaning, driveway cleaning, four-area flatwork/pressure washing, solar-panel cleaning, screen repair, the explicitly selected window promotion, and multi-service combinations. It also prices recurring/bundle scenarios by reusing ordinary service bases. Evidence: service selection and input types at `supabase/functions/_shared/pricingEngine.ts:174-253`; service branches at `:416-861`; promotion branch at `:955-1155`; plan/bundle paths at `:1174-1377` and `:1393-1777`.

Only the **web one-time flow** is broadly complete and consistent for those services because it owns rich per-service controls and supplies defaults. Even there, defaults can create a firm total without an explicit customer answer. The server conversational/quote-session path is complete only for the narrow whole-home core (service, square footage, stories and window side/type), and is not field-complete for modifiers or per-unit services.

Partial-window cleaning is a separate deterministic automated rule—`count × cleaned sides × $10`—not a branch of the canonical `calculateQuote` engine (`supabase/functions/_shared/partialWindowPricing.ts:1-39`). The conversational orchestrator applies it only for `windowCleaningScope === "partial"` (`supabase/functions/_shared/aiOrchestrator.ts:1529-1544`). Treat it as supported but architecturally separate.

Commercial window cleaning is not automatically priced. It collects locations and preferred contact methods and sets `human_pricing_required` / `commercial_bid_requested` (`quoteSession.ts:202-210`; `aiOrchestrator.ts:1551-1555`).

### Partial implementations and price hazards

- Quote-session `computeRequired` incorrectly requires home square footage for any ordinary selection, including solar panels, screen repair, driveway and pressure washing, although the engine does not (`quoteSession.ts:224-232` versus `pricingEngine.ts:370-391,677-861`).
- Quote-session never requires `solarPanelCount`, `screenRepairCount`, driveway surface, pressure-washing surface/each enabled area, roof type/severity, house-wash stain type, or gutter add-ons. Several are price-changing engine inputs.
- The web initializes explicit-looking choices before the customer answers: stories 1, exterior windows, maintenance condition, concrete surfaces, 400-sq-ft driveway, default flatwork areas, organic stain, asphalt/light roof, 20 panels and 1 screen (`src/types/homeowner.ts:209-265`). A firm price can therefore encode an unconfirmed assumption.
- `condition` is optional to the engine (missing means 0% modifier) but the web displays it and the deterministic residential reducer injects it as required for whole-home windows (`pricingEngine.ts:426-432`; `residentialQuote.ts:77-85`).
- `windowCleaningSides` is the manifest/session vocabulary; `windowCleaningType` is the engine/web vocabulary. No single contract makes their conversion authoritative.
- The engine always returns `estimatedDurationMinutes: null` (`pricingEngine.ts:917-948`), while booking readiness rejects a cached quote without a positive duration (`bookingReadiness.ts:265-286,384-393`). A separate duration map exists (`bookingDuration.ts:1-21`), creating a competing authority and a possible scheduling block.
- Product policy text says solar panels and mobile screen repair require manual quotes (`aiOrchestrator.ts:328`; migration `20260712203034_35f4c81c-ae98-44e6-bb27-bd0b22476e8c.sql:155`), while the canonical engine returns firm per-unit prices (`pricingEngine.ts:779-861`). This is a direct channel conflict.

## 2 — Source-of-truth map

| Concern | Current controller(s) | Authority / conflict |
|---|---|---|
| Customer/contact facts | `conversationState.ts`; `quoteSession.ts:288-310`; web booking customer form | Competing models; quote session normalizes phone but web uses its own form |
| Service selection | Web `IntentFirstServiceSelector.tsx`; conversation facts/session `services`; engine `EngineAdditionalServices` | Slug variants compete (`windowCleaning`, `window_cleaning`, `gutterCleaning`, `gutters`, `driveway`) |
| Progressive answers | `quoteSession.ts:98-140`; workflow controller/orchestrator | Session is persistence authority; extractor/orchestrator supplies patches |
| Required-field calculation | Engine `missing[]`; `quoteSession.computeRequired`; manifest helper; legacy `intakeSchemas` | **Four authorities**; legacy file admits supersession (`intakeSchemas.ts:1-14`) |
| Question wording/order | Web JSX; `residentialQuoteManifest.ts:50-151`; legacy priority in `intakeSchemas.ts:34-45` | **Competing authorities** |
| Pricing | `calculate-quote` → server `pricingEngine.ts` + live `pricing_config` | Canonical for ordinary/promo; partial windows use separate rule |
| Price status | `pricingEngine.finalize` (`pricingEngine.ts:905-948`) | Canonical result; quote session maps `manual_review_required` to `manual_review` |
| Quote persistence | `quotes` rows plus `quote_sessions.fields/lastQuoteResult`; delivery-specific persistence | **Two snapshots**; freshness keyed by `sessionInputsKey` |
| Quote delivery | `quoteDelivery.ts`; `voice/quoteByTextDelivery.ts`; web saved-quote flow | Multiple channels; voice text delivery rejects promotion reconstruction |
| Estimated duration | Engine result field is null; `bookingDuration.ts` maps line-item keys | **Conflict**; booking readiness requires positive cached duration |
| Booking readiness | Simple `quoteSession.isReadyToBook` and strict `bookingReadiness.ts` | **Conflict**: simple check needs status/address/email; strict check additionally needs identity, property authorization, fresh pricing/duration/schedule |
| Availability | strict readiness → availability lookup / Jobber schedule mirror | Server authority; requires fresh schedule mirror |
| Booking | booking flow / `executeSmsBooking.ts` / Jobber booking adapters | Server revalidation and explicit slot confirmation |
| Appointment changes | customer appointment UI plus cancellation/reschedule server modules | Separate post-booking workflows, not quote intake |

## 3 — Exact service-by-service matrix

Legend: A = required by engine to calculate; B = required/presented by current web form before pricing; C = optional price modifier; D = post-price delivery/booking; E = manual-review trigger; F = inconsistent across layers. “Persisted” refers to quote input/snapshot and/or `quote_sessions.fields`.

| Service | Canonical identifier | Field identifier | Current customer-facing question | Example values | A | B | C | D | E | Persisted | Consumed | Source file and line | Consistency | Notes / defect |
|---|---|---|---|---:|:---:|:---:|:---:|:---:|:---:|---|---|---|---|---|
| All | service flags | `services` / booleans | “Which service would you like priced today — window cleaning, house wash, gutters, or something else?” | one or more services | yes | yes | no | no | no | session + quote input | engine selection | manifest `:69-78`; engine `:355-368` | F | Several incompatible slugs |
| Sq-ft services only | n/a | `squareFootage` | “What is the approximate square footage of the home?” / web “Home Square Footage” | 2500 | yes for whole-home windows, interior windows, house, gutter, roof | web shows globally | no | no | >100,000 | session + homeDetails | engine | engine `:370-385`; manifest `:89-96`; web `HomeDetailsForm.tsx:96-120` | F | Session treats it as universal |
| Sq-ft services only | n/a | `stories` | “How many stories does the home have?” / “Number of Stories” | 1,2,3 | yes for same five | web default 1 | modifier for window/house/gutter/roof | no | invalid value becomes missing | session + homeDetails | engine | engine `:388-392`; manifest `:106-111`; web `HomeDetailsForm.tsx:140-151` | F | Default is not an explicit answer |
| Whole-home windows | `window_cleaning` | `windowCleaningScope` | “Is this every window on the home, or a specific count of windows?” | whole_home, partial | no (routing only) | no web equivalent | no | no | commercial routes manual | session | workflow only | manifest `:81-88`; residential workflow `:122-128` | F | Reducer may price without scope |
| Whole-home windows | `window_cleaning` | `windowCleaningType` / `windowCleaningSides` | web “Service Type”; voice “outside only, or inside and outside?” | exterior/both; outside_only/inside_and_outside | inside is priced only when `both`; omission silently means exterior | yes, default exterior | yes | no | no | session/homeDetails | engine uses Type | engine `:423-424`; web selector `IntentFirstServiceSelector.tsx:254-330`; manifest `:98-104` | F | Two vocabularies; missing silently exterior in engine |
| Whole-home windows | `window_cleaning` | `condition` / `windowCleaningCondition` | “Would you say the windows are regularly maintained, or heavily soiled…?” / “Window Condition” | maintenance, heavy | no | yes, default maintenance | yes | no | no | session/homeDetails | engine modifier | engine `:426-432`; manifest `:113-124`; web `:355-394` | F | Engine omission means 0%; reducer requires it |
| Whole-home windows | `window_cleaning` | `showAdvanced` | “Advanced Window Details” disclosure | true/false | no | optional disclosure | gates all following modifiers | no | no | homeDetails/snapshot | engine | engine `:442-462`; web `:396-419` | F | A populated modifier is ignored unless true |
| Whole-home windows | `window_cleaning` | `hardWaterStains` | “Hard Water Stains” | yes/no | no | optional | yes | no | no | homeDetails | engine | engine `:443-447`; web `:421-450` | F | Absent/false = no surcharge |
| Whole-home windows | `window_cleaning` | `hardWaterPercent` | “% of windows affected” | 25/50/75/100 | conditional | conditional | yes | no | no | homeDetails | engine | engine `:443-447`; web `:433-448` | consistent web/engine | Default 25 if toggle enabled |
| Whole-home windows | `window_cleaning` | `frenchPanes`, `frenchPanesPercent` | “French Panes”; “% of windows affected” | no; 25/50/75/100 | no/conditional | optional/conditional | yes | no | no | homeDetails | engine | engine `:448-452`; web `:452-480` | F | Missing from session/manifest |
| Whole-home windows | `window_cleaning` | `solarScreens`, `solarScreensPercent` | “Solar Screens”; “% of windows affected” | yes; 50 | no/conditional | optional/conditional | yes | no | no | homeDetails | engine | engine `:453-457`; web `:483-511` | F | Not solar-panel-cleaning service |
| Whole-home windows | `window_cleaning` | `ladderWork`, `ladderWorkCount` | “2nd Floor Ladder Work”; “How many windows?” | yes; 1-3/4-8/9+ | no/conditional | optional/conditional | yes | no | no | homeDetails | engine/window_addons config | engine `:458-460`; web `:514-543` | F | Missing from session/manifest |
| Whole-home windows | `window_cleaning` | `sunroom` | “Sunroom / Window Walls” | none/small/medium/large | no | optional | yes | no | no | homeDetails | engine/window_addons | engine `:461`; web `:545-565` | F | Missing from session/manifest |
| Partial windows | separate `partial_window_v1` | `windowCount` | scope prompt says “specific count”; no one-time web path | positive integer | yes | no | no | no | zero yields $0, not manual | session | partial rule/orchestrator | partial rule `:14-39`; quote session `:219-222` | F | Separate from canonical calculate-quote |
| Partial windows | separate `partial_window_v1` | `windowCleaningSides` | “outside only, or inside and outside?” | outside_only/inside_and_outside | yes | no | price multiplier | no | no | session | partial rule | partial rule `:17-35`; manifest `:98-104` | consistent within conversational path | Whole-home alias conflict remains |
| $99 promotion | `window_promo_99` | `promotion.id` | web “$99 Special — 10 Exterior Windows” | configured promo id | yes to enter promo branch | explicit selection | selects special price | no | unknown/inactive/out of dates | quote snapshot | promotion engine | engine `:351-353,966-1051`; web `:293-329` | F | Quote-booking resume hardcodes id/count in one path |
| $99 promotion | `window_promo_99` | `promotion.windowCount` | web does not ask; advertises configured maximum | 1..maxWindows | yes | no; caller supplies max | validates cap | no | >cap manual; <=0 missing | promotion snapshot | engine | engine `:1056-1105`; `Index.tsx:77`; `ServiceLanding.tsx:170` | F | Web prices max count, not customer’s actual count |
| House wash | `house_wash` | `squareFootage`, `stories` | global questions | 2500,2 | yes | yes/default | stories changes total | no | sqft >100k | homeDetails | engine | engine `:545-585` | partly consistent | See defaults |
| House wash | `house_wash` | `houseWashDetails.stainType` | “Primary Stain Type” | organic/rust | no | displayed; default organic | rust surcharge | no | no | quote input | engine | engine `:557-560`; `HouseWashDetailsCard.tsx:60-109` | F | Omission silently no surcharge |
| House wash | `house_wash` | `sidingMaterial` | “Siding Material” | brick/hardie/vinyl/stucco/wood | no | yes/default vinyl | no | no | no | UI state only | not mapped to engine | type `:71-78`; mapper `toQuoteInput.ts:49-50` | F | Asked but ignored by price |
| Gutter | `gutter_cleaning` | `squareFootage`, `stories` | global questions | 2500,2 | yes | yes/default | stories changes total | no | sqft >100k | homeDetails | engine | engine `:588-639` | partly consistent | Add-ons absent in conversation |
| Gutter add-on | component of `gutter_cleaning` | `undergroundDrains.enabled`, `.count` | “Underground Drain Cleaning”; “Number of Drains” | false; 1/2/3/4+ | no/conditional | optional/conditional | yes | no | no | quote input | engine | engine `:599-620`; `GutterAddonsCard.tsx:56-99` | F | Only applied if populated; not in session |
| Gutter add-on | component | `minorRepairs` | “Minor Gutter Repairs” | yes/no | no | optional | yes | no | no | quote input | engine | engine `:599-620`; web `:101-144` | F | Not proactively asked in conversation |
| Gutter add-on | component | `gutterGuards.enabled`, `.linearFeet` | “Gutter Guards Installation”; “Linear Feet of Gutters” | yes;150 | no/conditional | optional/conditional | yes | no | no | quote input | engine | engine `:614-620`; web `:146-203` | F | Missing feet becomes zero; web defaults 150 |
| Roof | `roof_cleaning` | `squareFootage`, `stories` | global questions | 2500,2 | yes | yes/default | stories changes total | no | sqft >100k | quote input | engine | engine `:646-671` | partly consistent |  |
| Roof | `roof_cleaning` | `roofType` | web selector | asphalt/tile/metal/flat | no | yes/default asphalt | yes | no | no | session/quote input | engine | engine `:653-654`; types/defaults `:103-105,254-257` | F | Omission = 0% rather than missing |
| Roof | `roof_cleaning` | `roofSeverity` | web selector | light/moderate/heavy | no | yes/default light | yes | no | no | session/quote input | engine | engine `:653-654`; types/defaults `:103-105,254-257` | F | No condition causes automatic manual review |
| Roof | `roof_cleaning` | `roofPitch` | web selector | walkable/moderate/steep | no | presented | no | no | no | UI only | not mapped/ignored | type says informational `:80-81`; mapper `toQuoteInput.ts:53-55` | F | Asked but not priced or reviewed |
| Driveway | `driveway_cleaning` | `drivewayCleaning.sqft` / `drivewaySqft` | “Driveway Size” | 200/400/custom | yes | yes, default 400 | base quantity | no | <=0 manual | quote input/session | engine | engine `:677-703`; selector `DrivewayPresetSelector.tsx:39-115` | F | Session also incorrectly asks home sqft |
| Driveway | `driveway_cleaning` | `surfaceType` / `drivewaySurface` | “Surface Type” | concrete/stamped/pavers/brick/stone/tile | used for multiplier; omission gets config fallback behavior | yes, default concrete | yes | no | no | quote input/session | engine | engine `:679-701`; web `IntentFirstServiceSelector.tsx:599-620` | F | Session does not require it |
| Pressure washing | `pressure_washing` | `pressureWashing.enabled` | service card | true | yes to select | yes | no | no | no | quote input | engine | engine `:708-771` | F | Session uses aggregate fields instead |
| Pressure washing | `pressure_washing` | each `frontPorch/backPatio/poolDeck/walkways.enabled` | area toggles | true/false | at least one positive area needed for useful line | yes | selects price component | no | no selected area leads no line/total | quote input | engine | engine `:713-771`; area card `PressureWashingAreaCard.tsx:44-108` | F | Session has only aggregate `pressureWashSqft` |
| Pressure washing | `pressure_washing` | each enabled area `.sqft` | per-area sq-ft input | 80/200/300/100 | yes when enabled | defaults supplied | yes | no | invalid enabled-area sqft manual | quote input | engine | engine `:713-751`; defaults `homeowner.ts:46-53,235-241` | F | Defaults may be unconfirmed |
| Pressure washing | `pressure_washing` | each area `.surfaceType` plus parent `surfaceType` | “Surface type” | concrete etc. | multiplier input; defaults concrete | defaulted | yes | no | no | quote input | engine | engine `:713-749`; area card `:90-108` | F | Parent and per-area values compete |
| Solar panels | `solar_panel_cleaning` | `panelCount` | panel count control | 1..500 | yes | default 20 | quantity | no | >500 | quote input | engine | engine `:779-816`; defaults `homeowner.ts:258-261` | F | Not in quote-session required logic; voice policy says manual |
| Screen repair | `screen_repair` | `screenCount` | screen count control | 1..500 | yes | default 1 | quantity | no | >500 | quote input | engine | engine `:824-861`; defaults `homeowner.ts:262-265` | F | Not in quote-session required logic; voice policy says manual |
| Commercial windows | no automated price | `commercialLocations` | no shared canonical prompt | address/stories/window estimate per site | intake requirement, not pricing | no web quote flow | no | required for bid | always human pricing | session | orchestrator/manual bid | `quoteSession.ts:53-65,207-210`; `aiOrchestrator.ts:1551-1555` | partial | Location subfields are not individually validated |
| Commercial windows | no automated price | `preferredContactMethods` | no shared canonical prompt | phone/email | no | no | no | required for bid follow-up | yes | session | manual bid | `quoteSession.ts:207-210` | partial | Contact facts may still be absent |
| All delivered/booked quotes | n/a | `name`, `phone` | manifest asks name then phone | text/E.164 | no | booking form | no | workflow asks **before** price; legacy booking requires both | no | session/customer/quote | delivery/booking | manifest `:56-68`; workflow `:64-86`; intake schema `:60-66` | F | Simple readiness does not require either |
| All delivered/booked quotes | n/a | `email`, `address` | email/address manifest prompts | valid email/address | no | booking form | no | yes after price | service area/property can block | session/customer/quote | booking/readiness | workflow `:92-110`; `quoteSession.ts:239-245` | partly consistent | Strict readiness also needs identity/property authorization |
| All | discount | `discountCode` | discount-code input | valid active code | no | optional | yes | no | invalid ignored, not review | quote/session | server revalidates DB | calculate endpoint `:39-71`; mapper `:61-65` | consistent | Promotion stacking governed by config |

Multi-service quotes simply union every selected service’s inputs. The engine returns `missing_information` before any math when a shared required field is absent (`pricingEngine.ts:394-409`) and returns `manual_review_required` if any branch adds a reason (`:879-896`). Recurring plans reuse the same service bases and then apply administrator-configured frequencies/discounts; they do not remove ordinary property inputs (`:1174-1377,1468-1625`).

## 4 — Current question sequences

### Web one-time flow

1. Service mode / service selection.
2. Global “Home Square Footage” and “Number of Stories”; stories is already 1.
3. Configure every selected service card:
   - Whole-home windows: Service Type → Window Condition → optionally open Advanced Window Details → conditional percentages/counts.
   - Promotion: select the promo card; standard condition/advanced details disappear; actual window count is not asked.
   - House wash: Siding Material → Primary Stain Type.
   - Gutter: optionally enable drains → drain count; minor repairs; guards → linear feet.
   - Roof: type, severity and informational pitch.
   - Driveway: preset/custom size → surface.
   - Pressure washing: enable one or more areas → area sqft → per-area surface where shown.
   - Solar/screen: quantity controls.
4. The UI sends the entire default-populated model for live authoritative calculation (`toQuoteInput.ts:26-66`).
5. Price/status is shown.
6. Saved quote/booking collects customer and property details, then availability and confirmation.

### Deterministic residential conversational workflow

1. `contact_name`.
2. `contact_phone`.
3. `services`.
4. Engine-reported missing fields in manifest order: `windowCleaningScope`, `squareFootage`, `windowCleaningSides`, `stories`.
5. If residential whole-home windows, also `windowCleaningCondition`.
6. Calculate price.
7. Speak price.
8. `contact_email`.
9. `address`.
10. Offer scheduling.

This is exact reducer intent (`residentialQuote.ts:64-113`), but the manifest cannot ask many engine fields because they have no entries. `windowCleaningScope` and `windowCleaningSides` are only asked when translated from missing tokens/additional requirements; the fallback engine-missing list is merely services/squareFootage/stories (`:66-85`), so scope/sides are not deterministically required before calculation.

### Partial and commercial branches

- Partial: classify scope → ask `windowCount` → ask `windowCleaningSides` → compute separate partial rule → persist partial price/rule version. No square footage.
- Commercial: classify customer/scope → collect at least one `commercialLocation` and a preferred contact method → mark human pricing required → no automated firm quote.

### Multi-service and recurring

The web displays all selected cards; questions are effectively the union in UI order. Quote-session conversational intake is not capable of reconstructing that full union. Plans first collect home details and selected services, then select/customize tier frequency and customer information; base service inputs are unchanged while configured cadence and bundle discounts alter totals.

## 5 — PROPOSED FOR OWNER REVIEW: minimum safe voice questions

Universal pre-price:

1. Confirm requested service(s). Existing customer/property service selections may be reused only after verbal confirmation.
2. For whole-home windows, house, gutters or roof: obtain verified square footage (existing authorized property record or verified lookup may supply it) and stories.
3. Ask the service-specific fields below; never substitute UI defaults for silence.

Conditional:

- Whole-home windows: scope; outside versus inside/outside; condition. Combine naturally: “For the whole home, is that outside only or inside and outside, and are the windows regularly maintained or heavily soiled?” Then screen once for hard water, French panes, solar screens, second-floor ladder-only windows, or a sunroom/window wall; ask quantities only for each “yes.”
- Partial windows: exact window count and outside versus both sides.
- Promotion: explicit promo selection and actual eligible exterior-window count.
- House wash: rust/irrigation staining versus ordinary organic staining. Siding material is not needed for current price.
- Gutters: offer each configured add-on; ask drain count or guard linear feet only when selected.
- Roof: type and severity because they change price, even though the engine currently defaults omission to 0%. Pitch is not a pricing input.
- Driveway: driveway sqft and surface.
- Flatwork: which named areas; sqft and surface for every enabled area.
- Solar: panel count—but owner must first resolve the firm-engine/manual-policy conflict.
- Screen repair: screen count—but owner must first resolve the same conflict.

After price: email and service address for delivery/scheduling; resolve customer identity/property authorization; name/phone may come from a verified customer record. Availability preference, selected live slot, terms acknowledgement and explicit final confirmation belong after price. City/ZIP should be obtained before availability/serviceability, not silently elevated into pricing.

## 6 — Price-accuracy confirmation

- Whole-home windows: square footage; stories; exterior vs both; condition; each present advanced modifier and its percentage/count; explicitly state “none” only for modifiers the customer was actually screened for.
- Partial windows: window count and outside-only vs both sides.
- Promotion: promo identifier/offer, actual eligible exterior-window count, cap and screen-removal condition.
- House wash: square footage, stories and rust-stain choice.
- Gutters: square footage, stories; drain count, minor-repair selection and guard linear feet where applicable.
- Roof: square footage, stories, roof type and severity.
- Driveway: driveway sqft and surface.
- Flatwork: each enabled named area with its sqft and surface.
- Solar panels: panel count.
- Screen repair: screen count.
- Multi-service: concatenate the applicable recap blocks; do not replace them with home square footage alone.
- Plan/bundle: ordinary input recap plus selected tier, each service frequency/cadence, added/swapped services, billing cadence and configured discount snapshot.

## 7 — Known inconsistencies

1. Manifest `windowCleaningScope` and `windowCleaningSides` are **not guaranteed required** by the deterministic reducer. The reducer asks only engine-missing tokens plus condition; the engine never emits scope or sides, and `windowCleaningType` omission means exterior (`residentialQuote.ts:66-85`; `pricingEngine.ts:423-424`).
2. `windowCleaningType` (`exterior|both`) and `windowCleaningSides` (`outside_only|inside_and_outside`) compete. Session readiness accepts either (`quoteSession.ts:217-229`); the engine consumes only Type.
3. Condition is engine-optional but web/reducer-mandatory/defaulted. Omission silently gets no condition modifier.
4. Square footage is incorrectly universal in quote-session (`:225`) but engine-required only for windows/interior/house/gutters/roof (`pricingEngine.ts:370-377`).
5. `solarPanelCount` and `screenRepairCount` are absent from session fields/required logic, although engine missing tokens use those names (`pricingEngine.ts:784-792,829-837`).
6. Roof type/severity are optional lookups with 0% fallback; the form preselects asphalt/light. Roof pitch is asked but ignored.
7. Driveway surface changes a multiplier but is not session-required and web defaults concrete.
8. Pressure washing session holds one aggregate sqft/surface, while the engine expects four independently enabled areas and uses per-area surface. No faithful mapping exists.
9. House stain type is asked on web/defaulted organic; omission causes no rust surcharge.
10. Gutter add-ons are actively offered only in web; conversational intake applies them only if already populated, which its manifest cannot ask.
11. Partial-window price is deterministic and versioned but outside `calculateQuote`, live pricing config, ordinary quote line items, and web quote form.
12. Promotion selection and count are logically separate in the engine, but web callers pass the configured maximum as count rather than asking the customer. Voice text delivery refuses promotion persistence as unmappable (`voice/quoteByTextDelivery.ts:335-338`).
13. Frontend-only fields include siding material and roof pitch; engine-only/session-missing modifiers include advanced window details, house stain, gutter add-ons, roof modifiers, per-area flatwork, solar count and screen count.
14. Engine advertises solar/screen firm prices while voice policy forces manual quote.
15. Engine duration is null but strict booking readiness requires it; separate line-item duration logic is not the engine result.

## 8 — Decisions needed from Ben

| Exact question | Current behavior | Risk | Options | Recommended for review | Effect |
|---|---|---|---|---|---|
| Must scope and window sides be explicit before whole-home pricing? | Engine can silently price exterior; reducer may skip both | Wrong interior/exterior price | Require both; require sides only with inferred scope; retain default | Require explicit scope and sides | Pricing |
| May web defaults count as customer answers? | Many are sent immediately | Unconfirmed assumptions produce firm totals | Keep; require interaction; label estimate until confirmed | Require confirmation before firm status | Pricing |
| Should city/ZIP be required before price? | Not pricing-critical; address after price | Service-area surprise after quote | Before price; after price/before schedule; lookup from property | After price but before availability, unless owner wants serviceability gated earlier | CX/eligibility |
| How should advanced window modifiers be elicited? | Optional collapsed web panel; absent in voice | Systematic underquote | Ask all; one screening question then branch; disclose manual exception | One screening question, then conditional quantities | Pricing |
| Which roof conditions require human review? | None; type/severity only modify | Unsafe/unusual roofs can receive firm quote | Define automatic triggers; keep modifiers only; all roofs manual | Owner-defined unsafe/unusual trigger list, separate from price modifiers | Pricing/safety |
| Should driveway/flatwork defaults be allowed? | Concrete and sizes default | Wrong multiplier/area | Explicit answer; verified measurement; estimated then confirm | Require verified sqft and explicit surface for firm price | Pricing |
| Which gutter add-ons should voice proactively offer? | Web offers all; voice offers none | Lost/incorrect scope | All; selected subset; post-price upsell | Owner choose, default to all configured add-ons | Pricing/CX |
| Solar and screen: firm or manual? | Engine firm; voice policy manual | Contradictory promises | Make voice use engine; make all manual; conditional threshold | Decide one authority before implementation | Pricing |
| How should unknown square footage resolve? | Web lookup link; engine missing | Quote stalls or guessed sqft | Verified property lookup; text form; human review | Lookup, then text form, then human review—never default | Pricing/CX |
| Should partial-window pricing join canonical engine/config? | Separate hard-coded $10/side rule | Drift, incomplete persistence | Keep separate; integrate engine; manual only | Integrate/version under one authoritative quote contract | Pricing/architecture |
| Should promotion use actual count? | Web passes configured max | Snapshot can misstate scope | Ask actual count; always record max; manual validation | Ask and persist actual count | Pricing |
| What is authoritative booking duration? | Engine null; separate map | Firm quotes cannot pass strict readiness | Populate server result; derive during readiness; manual duration | Populate authoritative quote result from one versioned duration rule | Scheduling |
| Which contact facts are pre-price? | Deterministic flow asks name/phone first | More friction than web | both; phone only; neither | Reuse verified identity; otherwise phone/name only when needed to save continuity | CX only |

## 9 — Proposed implementation contract (machine-readable; owner review required)

```yaml
schemaVersion: proposed-voice-intake-v1
fields:
  - {fieldId: services, appliesToServices: ["*"], requiredStage: pre_price, requiredWhen: "always", canonicalPrompt: "Which services would you like priced?", acceptedValues: "canonical service ids[]", parser: service_alias_map, validator: "nonempty supported set", sourceOfTruth: pricingEngine.EngineAdditionalServices, pricingImpact: selects_lines, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: squareFootage, appliesToServices: [window_cleaning, interior_windows, house_wash, gutter_cleaning, roof_cleaning], requiredStage: pre_price, requiredWhen: "any applicable service selected", canonicalPrompt: "What is the home's approximate square footage?", acceptedValues: "number >0 and <=100000", parser: spoken_area, validator: canonical_engine, sourceOfTruth: authorized_property_or_customer, pricingImpact: base_quantity, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: verified_property_lookup_then_text_then_manual_review}
  - {fieldId: stories, appliesToServices: [window_cleaning, interior_windows, house_wash, gutter_cleaning, roof_cleaning], requiredStage: pre_price, requiredWhen: "any applicable service selected", canonicalPrompt: "How many stories does the home have?", acceptedValues: [1,2,3], parser: spoken_integer, validator: enum, sourceOfTruth: customer_or_verified_property, pricingImpact: modifier, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: windowCleaningScope, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "window cleaning selected", canonicalPrompt: "Is this every window on the home, a specific set of windows, or commercial work?", acceptedValues: [whole_home,partial,commercial_custom], parser: window_scope_classifier, validator: enum, sourceOfTruth: customer, pricingImpact: routes_engine, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: windowCleaningSides, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "scope in [whole_home,partial]", canonicalPrompt: "Outside only, or inside and outside?", acceptedValues: [outside_only,inside_and_outside], parser: window_sides, validator: enum, sourceOfTruth: customer, pricingImpact: interior_component_or_partial_multiplier, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: condition, appliesToServices: [window_cleaning,interior_windows], requiredStage: pre_price, requiredWhen: "whole_home standard pricing", canonicalPrompt: "Are the windows regularly maintained or heavily soiled?", acceptedValues: [maintenance,heavy], parser: condition_enum, validator: enum, sourceOfTruth: customer, pricingImpact: modifier, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: windowAdvancedScreen, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "standard whole_home", canonicalPrompt: "Any hard-water staining, French panes, solar screens, ladder-only windows, or sunroom/window walls?", acceptedValues: "named flags", parser: multi_entity_boolean, validator: known_flags_only, sourceOfTruth: customer, pricingImpact: routes_modifiers, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: hardWaterPercent, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "hardWaterStains=true", canonicalPrompt: "About what percentage of windows is affected?", acceptedValues: [25,50,75,100], parser: percentage_bucket, validator: enum, sourceOfTruth: customer, pricingImpact: modifier_scale, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: frenchPanesPercent, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "frenchPanes=true", canonicalPrompt: "About what percentage has French panes?", acceptedValues: [25,50,75,100], parser: percentage_bucket, validator: enum, sourceOfTruth: customer, pricingImpact: modifier_scale, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: solarScreensPercent, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "solarScreens=true", canonicalPrompt: "About what percentage has solar screens?", acceptedValues: [25,50,75,100], parser: percentage_bucket, validator: enum, sourceOfTruth: customer, pricingImpact: modifier_scale, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: ladderWorkCount, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "ladderWork=true", canonicalPrompt: "How many windows need second-floor ladder work?", acceptedValues: ["1-3","4-8","9+"], parser: count_bucket, validator: enum, sourceOfTruth: customer, pricingImpact: flat_addon, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: sunroom, appliesToServices: [window_cleaning], requiredStage: pre_price, requiredWhen: "advanced screen completed", canonicalPrompt: "What size is the sunroom or window wall?", acceptedValues: [none,small,medium,large], parser: size_enum, validator: enum, sourceOfTruth: customer, pricingImpact: flat_addon, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: windowCount, appliesToServices: [partial_window_v1,window_promo_99], requiredStage: pre_price, requiredWhen: "partial or promotion selected", canonicalPrompt: "How many windows are included?", acceptedValues: "positive integer within rule cap", parser: spoken_integer, validator: scope_specific, sourceOfTruth: customer, pricingImpact: quantity_or_promo_eligibility, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: standard_quote_or_manual_review}
  - {fieldId: promotionId, appliesToServices: [window_promo_99], requiredStage: pre_price, requiredWhen: "customer explicitly selects promotion", canonicalPrompt: "Would you like the current exterior-window special?", acceptedValues: "active configured promo id", parser: promotion_selection, validator: live_pricing_config, sourceOfTruth: pricing_config_plus_customer_selection, pricingImpact: promotion_branch, recapRequired: true, maxVoiceAttempts: 1, fallbackAction: standard_quote}
  - {fieldId: houseWashStainType, appliesToServices: [house_wash], requiredStage: pre_price, requiredWhen: "house_wash selected", canonicalPrompt: "Is the primary staining ordinary organic buildup or rust/irrigation staining?", acceptedValues: [organic,rust], parser: stain_enum, validator: enum, sourceOfTruth: customer, pricingImpact: rust_surcharge, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: undergroundDrains, appliesToServices: [gutter_cleaning], requiredStage: pre_price, requiredWhen: "owner-approved proactive offer", canonicalPrompt: "Include underground drain cleaning?", acceptedValues: "false or count 1/2/3/4+", parser: boolean_then_bucket, validator: configured_bucket, sourceOfTruth: customer, pricingImpact: addon, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: omit_only_after_explicit_no}
  - {fieldId: minorRepairs, appliesToServices: [gutter_cleaning], requiredStage: pre_price, requiredWhen: "owner-approved proactive offer", canonicalPrompt: "Include minor gutter repairs?", acceptedValues: [true,false], parser: boolean, validator: boolean, sourceOfTruth: customer, pricingImpact: addon, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: omit_only_after_explicit_no}
  - {fieldId: gutterGuardsLinearFeet, appliesToServices: [gutter_cleaning], requiredStage: pre_price, requiredWhen: "gutter guards selected", canonicalPrompt: "About how many linear feet of gutter guards?", acceptedValues: "positive number", parser: spoken_length, validator: positive_finite, sourceOfTruth: customer_or_verified_measurement, pricingImpact: addon_quantity, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: roofType, appliesToServices: [roof_cleaning], requiredStage: pre_price, requiredWhen: "roof selected", canonicalPrompt: "What type of roof is it?", acceptedValues: [asphalt,tile,metal,flat], parser: roof_type, validator: enum, sourceOfTruth: customer_or_verified_property, pricingImpact: modifier, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: roofSeverity, appliesToServices: [roof_cleaning], requiredStage: pre_price, requiredWhen: "roof selected", canonicalPrompt: "Is the roof buildup light, moderate, or heavy?", acceptedValues: [light,moderate,heavy], parser: severity_enum, validator: enum_plus_owner_review_rules, sourceOfTruth: customer, pricingImpact: modifier_or_manual_review, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: drivewaySqft, appliesToServices: [driveway_cleaning], requiredStage: pre_price, requiredWhen: "driveway selected", canonicalPrompt: "About how many square feet is the driveway?", acceptedValues: "positive number", parser: spoken_area, validator: positive_finite, sourceOfTruth: customer_or_verified_measurement, pricingImpact: base_quantity, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: drivewaySurface, appliesToServices: [driveway_cleaning], requiredStage: pre_price, requiredWhen: "driveway selected", canonicalPrompt: "What is the driveway surface?", acceptedValues: [concrete,stamped,pavers,brick,stone,tile], parser: surface_enum, validator: enum, sourceOfTruth: customer, pricingImpact: multiplier, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: pressureWashingAreas, appliesToServices: [pressure_washing], requiredStage: pre_price, requiredWhen: "pressure washing selected", canonicalPrompt: "Which areas: front porch, back patio, pool deck, or walkways?", acceptedValues: "nonempty subset", parser: named_area_set, validator: known_areas, sourceOfTruth: customer, pricingImpact: selects_components, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: pressureAreaDetails, appliesToServices: [pressure_washing], requiredStage: pre_price, requiredWhen: "for every enabled area", canonicalPrompt: "For each area, what are its square footage and surface?", acceptedValues: "{area,sqft>0,surface enum}[]", parser: repeated_area_detail, validator: engine_shape, sourceOfTruth: customer_or_verified_measurement, pricingImpact: quantity_and_multiplier, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: solarPanelCount, appliesToServices: [solar_panel_cleaning], requiredStage: owner_decision, requiredWhen: "solar selected and automated pricing approved", canonicalPrompt: "How many solar panels need cleaning?", acceptedValues: "integer 1..500", parser: spoken_integer, validator: canonical_engine, sourceOfTruth: customer, pricingImpact: quantity, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: screenRepairCount, appliesToServices: [screen_repair], requiredStage: owner_decision, requiredWhen: "screen repair selected and automated pricing approved", canonicalPrompt: "How many screens need repair?", acceptedValues: "integer 1..500", parser: spoken_integer, validator: canonical_engine, sourceOfTruth: customer, pricingImpact: quantity, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: manual_review}
  - {fieldId: contactEmail, appliesToServices: ["*"], requiredStage: post_price, requiredWhen: "deliver/save/book", canonicalPrompt: "What email should receive the quote and booking confirmation?", acceptedValues: "valid email", parser: spelled_email, validator: email, sourceOfTruth: verified_customer_or_customer, pricingImpact: none, recapRequired: false, maxVoiceAttempts: 2, fallbackAction: secure_text_form}
  - {fieldId: serviceAddress, appliesToServices: ["*"], requiredStage: post_price, requiredWhen: "availability/book", canonicalPrompt: "What address is this for?", acceptedValues: "verified service address", parser: address, validator: service_area_and_property_authorization, sourceOfTruth: authorized_property_or_customer, pricingImpact: none_currently, recapRequired: true, maxVoiceAttempts: 2, fallbackAction: secure_text_form_or_manual_review}
```

## Validation record

Commands used for discovery included `rg --files`, targeted `rg -n`, `nl -ba … | sed -n …`, bundled Git `rev-parse/status/remote`, and direct inspection of the files cited above.

Tests could not be executed in this checkout: `node_modules` is absent and `node`, `npm`, and `deno` are not installed/available on PATH. No dependency installation was attempted because this is a read-only discovery task. Therefore: tests passed: **0 run**; tests failed: **0 run**; tests unavailable: pricing engine, promotion, plan/bundle, manifest, quote-session, residential workflow, partial-window, booking-duration, and booking-readiness suites. Existing test sources were inspected as evidence, but are not reported as executed.

No application code, tests, schema, migration, provider configuration, Supabase data, Vapi, CallRail, Jobber, deployment, test call, or production system was changed. The only authored artifact is this report.

## Post-audit owner-requirement addendum — 2026-07-31

This addendum does not revise the historical findings above. After the audited baseline, Ben confirmed additional Phase 0 business rules for enclosed patios, screen profiles, solar-screen service, underground-drain clearing, minor gutter/downspout repairs, house-wash patios, and the house-wash/window bundle. The authoritative implementation belongs to `packages/sales-engine/intake/quoteIntakeContract.ts` and the canonical pricing engine; the original proposed voice schema above remains historical audit evidence and is not an approved production prompt.

Confirmed rules added after the audit:

- one screened-enclosure soft wash: $150 flat;
- enclosure windows: $10 each exterior-only or $20 each inside-and-out;
- explicitly confirmed no screens: 5% off the window-cleaning service subtotal, with the approved removal disclosure;
- all-window solar-screen removal/clean/reinstall: +50% for exterior-only or +25% for full service; partial coverage requires clarification until allocation is authoritative;
- underground drains: $100 total for one or two, then $25 for each additional exact drain;
- qualifying minor gutter/downspout repairs: one +30% adjustment against base gutter cleaning only;
- house-wash patios: +10% front, +10% back, or exact measured area at $0.25/sq ft, never both methods;
- qualifying house wash plus window cleaning: one $50 bundle discount.

The possible $50 in-person consultation remains documented-only and inactive. It is not a fallback default for incomplete remote quotes.
