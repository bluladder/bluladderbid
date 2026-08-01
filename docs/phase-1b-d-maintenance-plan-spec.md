# Phase 1B-D Maintenance Plans — Final Implementation-Ready Business Specification

Status: business-rules specification only. No D1–D4 product, pricing, persistence, payment, Jobber, or Portal behavior is implemented by this document.

Dependency: Phase 1B-B quote-to-scheduling flow. All plan calculations must continue to come from canonical server pricing and eligibility contracts.

## 1. Public plan names

The proposed public names, subject to Ben's approval, are:

1. **Essential Window Care**
2. **Signature Home Care**
3. **Next Level Clean**

Public interfaces must not display Good, Better, or Best. Those legacy values may remain internal compatibility identifiers until a versioned migration is separately approved.

## 2. Positioning

- **Essential Window Care:** dependable year-round window clarity with a low-complexity entry point.
- **Signature Home Care:** the balanced whole-home exterior-care plan for customers who want windows plus recurring protection and curb appeal.
- **Next Level Clean:** the highest-coverage plan, with more interior-window service, the broadest exterior-care mix, the strongest additional-service benefit, and highest scheduling priority.

Plans are maintenance programs, not unlimited restoration contracts. Public copy must distinguish scheduled base work, qualifying touch-ups, discounted extra work, and excluded or separately quoted work.

## 3. Base services and frequencies

| Plan | Base services and annual frequency |
|---|---|
| Essential Window Care | Exterior windows 4x; interior windows 1x, paired with one exterior visit. Window-only enrollment is allowed. Exterior frequency may increase but may not fall below 4x; interior frequency may increase but may not fall below 1x. |
| Signature Home Care | Exterior windows 4x; interior windows configurable at 1x or 2x; gutter cleaning 1x; house wash 1x. Driveway cleaning is a recommended annual add-on under item 6, not a universal base service. |
| Next Level Clean | Exterior windows 4x; interior windows 2x; gutter cleaning 1x; house wash 1x; driveway cleaning 1x; one additional measured pressure/flatwork benefit governed by item 7. |

Every service occurrence must be represented separately in the canonical schedule, duration, price, tax, and Jobber payload. A frequency label is not a license to multiply or divide a client-side price.

## 4. Plan minima

- Essential: exterior windows at least 4x and interior windows at least 1x. No other service category is required.
- Signature: at least two distinct service categories, one of which must be windows. The configured base above qualifies through windows plus exterior washing; if a customer removes house wash, another non-window category must replace it.
- Next Level: at least three distinct service categories, one of which must be windows. Its standard base qualifies through windows, gutter care, exterior washing, and flatwork.
- Disabled minus/remove controls must state the exact reason, such as “Essential requires at least 4 exterior visits” or “Signature requires windows plus one other category.”
- A customization that violates a minimum is not saved, submitted, priced as valid, or represented as qualified.

## 5. Exact category definition

The qualification categories are:

1. **Windows:** exterior window cleaning and interior window cleaning are one category, regardless of frequency.
2. **Building exterior:** house washing and roof washing are one category.
3. **Water management:** gutter cleaning and underground drain cleaning are one category. Gutter repair and gutter guards do not qualify because they are excluded work.
4. **Flatwork:** driveway, patio, porch, pool deck, and walkway cleaning are one category.
5. **Specialty:** solar-panel cleaning and screen repair are one category only after the service is firm-price eligible or manually approved.

Multiple services within one category do not satisfy multiple-category minima. The server returns both the category count and the exact qualifying category keys.

## 6. Signature composition recommendation

Recommendation: keep **house wash as Signature base** and make **driveway cleaning a prominently recommended annual add-on**, rather than placing both in the universal base.

Reasoning:

- House washing is clearer as a whole-property annual maintenance promise and usually has more predictable annual need.
- Driveway scope varies materially by square footage, surface, staining, access, and chemical needs; treating it as universal base work makes a simple plan harder to price and compare.
- A universal driveway visit increases duration and monthly payment even for customers who do not need it every year.
- A measured, preselected driveway add-on preserves visible value while keeping scheduling and margin tied to the actual property.
- Next Level Clean retains driveway as base, creating a meaningful plan distinction.

Ben must approve this recommendation. If Ben requires driveway in Signature base, D0 must validate its measured scope and economics before D1 treats it as a base row.

## 7. Additional pressure/flatwork benefit

Do **not** approve or advertise a generic “1,000 sq ft included” allowance until labor productivity, chemical usage, surface risk, mobilization, service frequency, gross margin, rollover behavior, and whether the allowance may be divided across areas are validated together.

Safer initial rule: Next Level Clean includes **one annual measured flatwork service credit**, applied to one customer-selected area and priced by the canonical server against its exact square footage, surface, and condition. The credit value is capped at the lower of the validated plan credit or the authoritative line-item price. It has no cash value, does not roll over, cannot be divided across visits, and cannot combine with the 10% additional-service discount on the same line item. Until D0 approves a numeric credit, public UI says “Annual measured flatwork benefit” and shows no square-foot allowance or dollar value.

## 8. Additional-service discount policy

Essential and Signature receive **5% off eligible extras**. Next Level Clean receives **10% off eligible extras**. There is no “up to” language because the percentage is fixed; eligibility varies by rule below.

- Eligible services: additional window cleaning, house washing, gutter cleaning, roof washing, driveway cleaning, patio/porch/pool-deck/walkway cleaning, solar-panel cleaning, and screen repair, but only when the item has a firm canonical price or a manually approved final price.
- Ineligible services: item 9 exclusions, taxes, permits, disposal, subcontracted specialty work, pass-through materials, and any explicitly non-discountable line item.
- Applies to one-time extra work performed at the same property during a scheduled plan visit while the plan is Active.
- Separately mobilized work uses normal pricing unless a later, validated policy explicitly covers the extra trip.
- Added recurring frequency is priced as a plan customization and does not also receive the extra-service discount.
- The plan must be Active both when the work is accepted and when it is performed. Draft, Submitted, Awaiting review, Approved-but-not-active, Change requested, Paused, Cancelled, and Expired plans do not qualify.
- Discounts never reduce a service below its canonical minimum and never apply to an amount excluded from the eligible labor/service subtotal.
- Manual quotes show the plan benefit only after staff records the approved eligible subtotal; the UI must not estimate it.
- No stacking: the server applies the single best eligible promotion or plan benefit unless an explicit, versioned rule says otherwise. A line item cannot receive both a plan discount and a promo, bundle adjustment, flatwork credit, or another plan benefit.
- Display must show eligible subtotal, plan percentage, exact savings, exclusions, and final authoritative total. The server records a benefit identifier per discounted line item to prevent double discounting across quote, booking, invoice, and Jobber sync.

## 9. Explicit exclusions

The following never receive the Essential/Signature 5% or Next Level 10% additional-service discount:

- Christmas-light installation, removal, storage, repair, or materials
- gutter repairs
- gutter-guard installation, repair, or materials

Exclusions must appear in the comparison disclosure and at the point an excluded service is added. An excluded item may still be requested and quoted separately.

## 10. Fourteen-day touch-up policy

Essential and Signature include a 14-day touch-up request window after each completed included visit. A qualifying request concerns a missed spot or ordinary workmanship issue within the originally serviced scope and normal access conditions. It does not include new weather, new construction debris, new staining, damage, inaccessible areas, changed scope, severe mineral restoration, or another service category. BluLadder may inspect first and will schedule the remedy rather than promise an instant appointment.

## 11. Unlimited qualifying touch-up policy

Next Level Clean includes unlimited **qualifying** touch-up requests while Active. “Unlimited” means no fixed count for legitimate workmanship or recurring-clarity issues within plan-included services and normal access; it does not waive scope, safety, service-area, abuse, restoration, damage, contamination, or excluded-work rules. Each request is triaged, may require photos or inspection, and is scheduled with highest plan priority, not guaranteed same-day service. Repeated requests caused by a new ongoing condition may trigger a plan-change recommendation or BluLadder review rather than endless free restoration work.

## 12. Hard-water treatment

All three plans include assessment and treatment of treatable routine hard-water spotting within the enrolled window scope when the technician determines it is safe and suitable. Severe buildup, etched glass, restoration, specialty access, or conditions requiring nonstandard chemicals/tools require a separate canonical or manual quote. The plan must never promise reversal of permanent etching. The profile records affected areas, severity, result, and future-prevention recommendation.

## 13. Preventative coating

Preventative coating may be offered or included where warranted only after compatibility, material cost, application labor, expected life, retreatment frequency, and margin are validated in D0. A technician must confirm suitability; the system records product, surfaces, application date, and expected review date. Until Ben approves the economics and operating procedure, UI may describe “hard-water prevention recommendations” but must not promise included coating.

## 14. First-visit workflow

Replace **Current Condition** with this optional field:

- Label: **“Does anything need extra attention on the first visit?”**
- Helper: “Optional—tell us about buildup, access, stains, timing, or anything else our team should know. This does not change your price.”
- Control: multiline text, 500-character maximum with visible remaining count.
- Safety: normalize Unicode, trim surrounding whitespace, reject or strip control characters, store plain text, escape on every display, and never interpret HTML, Markdown, URLs, scripts, or instructions.
- Pricing: never used as a pricing input, eligibility fact, discount trigger, duration input, or automatic scope change.
- Destinations: versioned plan/profile record; plan quote or booking notes; internal job notes; and Jobber notes where the supported API field and organization mapping are verified. Do not put it into customer-visible line-item descriptions by default.
- Staff workflow: show the note during BluLadder review and first-visit preparation; preserve the original text in audit history if staff adds a separate internal interpretation.

## 15. Scheduling-preference fields

Capture preferences, not appointments:

- important date
- reason for the date
- affected service
- whether completion must occur before the date
- flexibility window
- highest-priority preference
- preferred month or season per service
- event, guests, holiday, property listing, closing, inspection, or other deadline context
- avoided dates or months
- additional notes

Every screen must say: **“These are preferences, not appointments. BluLadder will call to confirm your service schedule.”** Preferences never reserve inventory, bypass availability, create a Jobber visit, or imply confirmation.

## 16. Stage-1 UX

Stage 1 is qualification and plan selection:

- show the three public plan names and concise positioning
- show standard base service/frequency rows, guarantee/touch-up benefit, additional-service percentage, scheduling priority, annual total, payment schedule, and authoritative savings
- allow the customer to choose a starting plan and proceed to customization
- show qualification status and the exact unmet minimum
- keep Good/Better/Best out of public labels
- keep one-time service available as a distinct choice; never visually disguise the plan as required

## 17. Stage-2 UX

Stage 2 is customization and review:

- rows support `+`, `−`, Remove, Add, and Restore standard plan
- minimum-breaking controls are disabled with the exact reason
- every accepted change requests server repricing; no browser price arithmetic
- while repricing, invalidate the prior actionable price and show an updating state
- when ready, display the immediate authoritative plan state, qualification categories, visit frequencies, annual total, payment schedule, savings, tax treatment, and next scheduling step
- unsaved changes trigger navigation and close warnings
- Restore standard plan returns to the currently versioned default, not an old browser snapshot
- add/remove operations must preserve unrelated services and preferences

## 18. Desktop comparison

Use a dedicated sticky first column for row labels and sticky plan headers. Keep rows compact and horizontally aligned. Required rows include every requested service, benefit, frequency, guarantee/touch-up policy, additional-service discount, scheduling priority, first payment, remaining payment count and amount, annual total, savings, and material exclusions. Long explanations belong in accessible disclosures, not giant cells.

## 19. Mobile comparison

Use tabs labeled **Essential**, **Signature**, and **Next Level** and display one plan at a time. The selected tab is keyboard operable and announced accessibly. Each tab contains the same service, benefit, frequency, guarantee, discount, payment, savings, priority, and exclusion rows as desktop; mobile may reorder rows but may not omit them. The plan CTA remains reachable without covering content or the chat control.

## 20. Payment presentation

Every plan selection, comparison, customization review, checkout, saved plan, and Portal management surface shows:

- first payment amount
- remaining payment count and normal amount
- any final-payment adjustment
- annual total
- authoritative savings and comparison basis

Explain differences caused by service timing, tax, customization, cent rounding, or an uneven final payment. Never derive or invent payment values in the client. This specification adds no payment collection, subscription, invoice, refund, retry, or cancellation-fee logic.

## 21. Profile architecture

The future customer/property plan profile must separate:

- stable identity and property data
- versioned plan definition and pricing snapshot
- mutable customer preferences
- staff review/approval facts
- scheduled service occurrences and Jobber identities
- benefit usage, touch-up requests, and discount lineage
- audit events and actor identity

Future persistence states are: **Draft, Submitted, Awaiting BluLadder review, Approved, Active, Change requested, Paused, Cancelled, Expired**. State transitions require authorization, timestamps, actor, reason, version, and idempotency. Historical pricing and prior versions remain immutable and readable after change.

## 22. Portal management

The verified customer Portal will eventually allow customers to view the current plan and history, submit change requests, update non-price scheduling preferences, request qualifying touch-ups, and see review/sync status. It must not directly mutate canonical price, approved scope, eligibility, billing, or Jobber visits. Material changes create a versioned Change requested state, receive canonical repricing, and require BluLadder review/approval before activation. Pausing or cancelling must show downstream service and payment implications supplied by future approved rules.

## 23. Database and API dependencies

D1–D4 require separately reviewed contracts for plan definitions and versions, plan instances, property profiles, selected services and frequencies, qualification categories, price snapshots, payment schedules, preferences, first-visit notes, benefits/usage, touch-ups, state transitions, approvals, and sync attempts. APIs must enforce authentication/authorization, organization scope, canonical server repricing, optimistic concurrency/version checks, idempotency, immutable history, safe note handling, and fail-closed stale state. No schema or API is authorized by this document alone.

## 24. Jobber dependencies

Before activation, validate the connected organization's supported Jobber fields and lifecycle for recurring work, visits, line items, notes, custom fields, client/property identity, request/quote/job relationships, webhooks, cancellations, and rescheduling. Every outbound sync needs organization scope, stable idempotency key, canonical plan/version identity, field-level mapping, result status, retry policy, reconciliation, and manual-review escalation. Scheduling preferences remain internal until converted to an approved appointment; they must never create speculative Jobber visits.

## 25. Ben approvals required

Ben must explicitly approve:

1. the three public names
2. Signature's recommended house-wash-base/driveway-add-on composition
3. Essential 5%, Signature 5%, and Next Level 10% eligible-extra benefits
4. eligible-service list, same-visit rule, minimum protection, non-stacking rule, and exclusions
5. 14-day and unlimited qualifying touch-up definitions
6. hard-water inclusion boundary
7. whether preventative coating becomes included after cost/operations validation
8. Next Level's measured flatwork-credit amount and operating rules; no 1,000-sq-ft claim is approved
9. scheduling-priority promises
10. first-visit helper wording and Jobber destination
11. payment cadence/comparison basis after accounting validation
12. the exact customer assurance: “Your price is confirmed based on the information provided. If the actual property conditions differ materially, we’ll discuss any change with you before work begins.”
13. whether “No payment due until service is complete” remains accurate for one-time service and how future plan payments differ

## 26. Delivery phases D0–D4

- **D0 — Owner/economic validation:** resolve all item 25 approvals; validate service frequencies, duration, chemicals, surface risk, mobilization, margin, touch-up operations, pressure/flatwork benefit, payment cadence, and Jobber capabilities. No customer launch.
- **D1 — Canonical read contracts:** introduce versioned domain types, qualification/category evaluator, canonical plan-definition read model, authoritative payment/savings presentation contract, fixtures, and tests. No schema mutation, write API, Jobber mutation, payment logic, or public activation.
- **D2 — Quote and customization:** implement Stage 1/Stage 2 UI against canonical server repricing, exact qualification feedback, responsive comparison, safe first-visit/preference capture in transient draft state, and unsaved-change protection.
- **D3 — Persistence and reviewed activation:** add separately approved schema/API, authenticated plan/profile persistence, state machine, versioning/history, BluLadder review, and approved scheduling/Jobber sync. Payment behavior remains a separate explicitly approved workstream.
- **D4 — Portal lifecycle:** add verified Portal management, change requests, pauses/cancellations under approved rules, touch-up requests, benefit history, sync/reconciliation visibility, and operational reporting.

No later phase begins until its dependencies and Ben approvals are recorded and the preceding phase's contract tests pass.

## 27. Exact D1 implementation prompt

```text
Work entirely in a ChatGPT Work cloud repository workspace.

Repository: bluladder/bluladderbid
Dependency: the merged or explicitly approved Phase 1B-D specification workstream containing docs/phase-1b-d-maintenance-plan-spec.md.

Implement Phase 1B-D1 only: canonical read contracts for maintenance plans. Read AGENTS.md completely and obey it. Create a new codex/* branch from the exact approved dependency head and open a new DRAFT PR. Do not merge, deploy, apply migrations, mutate Supabase, access Vercel/Lovable, change providers/secrets/production data, make paid calls, or implement D2–D4.

Before editing, prove repository, clean tracked worktree, exact dependency SHA, current origin/main, relevant issue/PR, and absence of a conflicting worktree. Stop on any mismatch. Use apply_patch for edits.

Implement only:
- versioned TypeScript domain/read-model types for Essential Window Care, Signature Home Care, and Next Level Clean while preserving legacy good/better/best internal compatibility where required
- exact service-category keys and a pure, deterministic qualification evaluator with the minima and disabled-control reasons from specification items 4–5
- versioned plan-definition fixtures encoding the approved D0 names, positioning, base services/frequencies, benefits, exclusions, discounts, priority, and pressure/flatwork rule
- read-only authoritative presentation contracts for first payment, remaining payment count/amount, final adjustment, annual total, savings, comparison basis, tax/customization/rounding disclosures, and unavailable/stale states
- safe plain-text validation contract for the optional first-visit note (exact label/helper, 500-character limit, Unicode normalization, trim, control-character rejection/stripping, escaped display; never pricing)
- typed scheduling-preference draft contract that explicitly represents preferences rather than appointments
- persistence-state enum only: Draft, Submitted, Awaiting BluLadder review, Approved, Active, Change requested, Paused, Cancelled, Expired
- exhaustive unit/contract tests and documentation showing which D0 approvals were supplied

Do not implement schema, migrations, database writes, Edge Functions, HTTP write endpoints, React plan UI, customer activation, payment logic, Jobber calls, Portal management, state transitions, repricing formulas, or client-side money calculations. If any D0 approval is missing, fail closed with an explicit unresolved-decision fixture and do not invent the rule.

Preserve all existing quote, tax, duration, readiness, service-area, booking, saved-quote, voice-web, route, refresh, plan-pricing, and eligibility contracts. Run frozen install, npm ls --all, TypeScript, changed-file and full ESLint, focused D1 and existing Phase 1B-A/B tests, full Vitest, quote/booking/saved-quote/voice-handoff contracts, every repository check:* script, production build, and git diff --check. Separate inherited failures and do not repair unrelated debt.

Commit only D1 tersely, push without force, and open an actual DRAFT PR blocked on its dependency. Report exact files, tests/results, commit SHA, branch, PR/base/dependency, unresolved D0 decisions, and confirmation that no deployment, migration, Supabase, Vercel, Lovable, provider, secret, payment, Jobber, or production action occurred.
```
