# BluLadder quote owner decisions

Updated 2026-07-31. Ben approved QD-01 through QD-16. This file records the resulting channel-neutral contract; it is no longer a pending-decision register for standard residential flows.

## Confirmed owner rules

| Rule | Confirmed behavior | Implementation status |
|---|---|---|
| Screened enclosure | One enclosure is a $150 flat add-on; no size question | Implemented in canonical contract/engine; downstream UI not started |
| Enclosure windows | $10 each exterior-only; $20 each inside-and-out | Implemented in canonical contract/engine |
| No screens | Explicitly confirmed `no_screens` receives 5% off window-cleaning only plus the approved disclosure; inferred/defaulted values cannot qualify | Implemented in canonical contract/engine |
| Solar-screen service | All windows: +50% exterior-only or +25% full-service; only when remove/clean/reinstall is selected | Implemented; partial coverage remains clarification/manual review |
| Underground drains | $0 at zero; $100 total for one or two; +$25 each after two | Implemented from exact count |
| Minor gutter/downspout repairs | One +30% adjustment against base gutter cleaning, including ordinary minor labor/materials | Implemented; major/uncertain repair portion routes to clarification |
| House-wash patios | Simple: +10% front and +10% back; optional exact method at $0.25/sq ft; never stack methods | Implemented in canonical contract/engine; downstream UI not started |
| House wash + windows | One stable $50 bundle discount, never below zero | Implemented in canonical contract/engine |
| Whole-home windows | Outside only is $0.08/home sq ft; inside and outside is $0.15/home sq ft | Implemented as configurable canonical combined rate with legacy adapter |
| Added/omitted window-sides | Added interiors +$10/side; explicit omissions -$8/side, minimum-bounded; half equivalents allowed | Implemented; omissions are never proactively offered |
| Advanced windows | Hard water +$10/affected equivalent; French panes +50% of whole-home base only; unusual ladder access +$5/affected equivalent | Implemented in canonical engine |
| Estimated sales tax | 8.25%; gutter cleaning and integrated drain/minor-repair lines exempt; discounts before tax | Implemented as a versioned policy and separate quote summary |
| Duration | Work value divided by $120/$150/$175 hourly targets, +15 minutes setup once, rounded up to 15 minutes | Implemented as deterministic quote metadata |

| ID | Approved resolution | Status |
|---|---|---|
| QD-01 | Track canonical answer provenance. Approved business defaults may price, but every price-changing default/customer estimate must be confirmed in the final assumption summary. Explicit answers override defaults. | resolved_2026_07_31 |
| QD-02 | Residential window cleaning is whole-home by approved default; do not routinely ask scope. Preserve legacy partial records as a compatibility/manual route. | resolved_2026_07_31 |
| QD-03 | Always explicitly ask inside-and-outside versus outside-only. Missing sides never become exterior-only. | resolved_2026_07_31 |
| QD-04 | Ask one advanced screen, then only applicable follow-ups. Hard water is $10/affected equivalent, French panes +50% of base, unusual ladder access $5/affected equivalent. | resolved_2026_07_31 |
| QD-05 | Firm roof wash is asphalt shingle, one/two story, light/moderate staining, no damage/pitch/material/access flag. Exceptions route only roof to photo-assisted review. | resolved_2026_07_31 |
| QD-06 | Driveway needs positive approximate area plus surface and provenance. The old 400-sq-ft default is not authoritative. Unknown specialty surfaces review only driveway. | resolved_2026_07_31 |
| QD-07 | Every enabled flatwork area needs ID, positive area, and surface. Unknown specialty surfaces review only that area. House-wash patios retain the mutually exclusive 10%/20% or $0.25/sq-ft methods. | resolved_2026_07_31 |
| QD-08 | Quote drains/minor repairs with base gutters; present gutter guards only after the base quote. An unanswered guard offer never blocks. | resolved_2026_07_31 |
| QD-09 | Solar is firm for confirmed count plus ordinary one/two-story residential access and no safety/access flags; exceptions review only solar. | resolved_2026_07_31 |
| QD-10 | Standard removable reusable-frame mesh replacement with confirmed count is firm; doors, frames, solar/specialty/unknown scopes review only screen repair. | resolved_2026_07_31 |
| QD-11 | Address/property lookup, then customer estimate, then remote follow-up only for square-foot-dependent services. Never guess; customer estimates require final confirmation. | resolved_2026_07_31 |
| QD-12 | Whole-home is primary. Added interior sides are $10; explicit omitted sides are -$8 and minimum-bounded; uncertain omission count remains bookable with onsite reduction disclosure. | resolved_2026_07_31 |
| QD-13 | $99 covers the first ten exterior equivalents; each additional equivalent is $10 on a separate line. Half increments are valid. | resolved_2026_07_31 |
| QD-14 | Canonical duration is deterministic, pre-discount/pre-tax, additive, setup-once, and 15-minute rounded. Manual-only work has no duration; independently firm portions retain one. | resolved_2026_07_31 |
| QD-15 | Voice: intent, callback phone, pricing, price, then remaining booking info. Web: no early contact wall. Reuse verified facts. | resolved_2026_07_31 |
| QD-16 | Service-area eligibility is required before availability/booking and is not a price modifier. Preserve outside-area requests for follow-up. | resolved_2026_07_31 |

## Documented future option — not active

A possible $50 in-person consultation, potentially credited toward booked work, is documented for later owner review. It has no canonical add-on identifier, is not selectable, and must not become the default escape hatch for incomplete remote quotes.
