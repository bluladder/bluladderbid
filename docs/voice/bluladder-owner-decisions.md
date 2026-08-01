# BluLadder quote owner decisions

Updated 2026-07-31. The confirmed rules below are approved contract requirements. Items in the decision table remain `pending_ben_review`; recommendations are not approvals.

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

| ID | Service | Exact field/policy | Frontend now | Pricing engine now | Voice now | Risk | Options | Codex recommendation | Impact | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| QD-01 | All | May a UI default count as confirmed? | Sends defaults | Calculates them | May omit question | Firm quote based on assumption | confirmed only / approved defaults / estimated until confirmed | Track `defaulted`; do not equate with verified | confidence, call length | pending_ben_review |
| QD-02 | Windows | Must `whole_home` scope be explicit? | Implied | Not consumed | Scope classifier exists | Wrong pricing path | require / infer with confirmation | Require route confirmation before automated disposition | confidence | pending_ben_review |
| QD-03 | Windows | Must sides be confirmed? | Defaults exterior | Phase 0 now returns missing instead of defaulting | Mixed legacy vocabularies | Interior omitted by an unconfirmed default | explicit / approved exterior default | Explicit canonical sides; never map missing | pricing | pending_ben_review |
| QD-04 | Windows | Hard-water, French-pane, and ladder-work screening | Collapsed optional panel | Applies only when populated | Not complete | Underquote | ask all / one screen then branch / manual exception | One summary screen then conditional details | pricing, call length | pending_ben_review |
| QD-05 | Roof | Are type and severity required for firm quote? | Default asphalt/light | Missing gets 0% modifier | No approved rule | Incorrect confidence | required / optional / manual if unknown | Require Ben to define disposition; contract blocks channel approval meanwhile | pricing, confidence | pending_ben_review |
| QD-06 | Driveway | Measurement and surface confirmation | Defaults 400/concrete | Uses both | Session was incomplete | Wrong total | explicit / verified measurement / approved defaults | Explicit or verified provenance | pricing | pending_ben_review |
| QD-07 | Flatwork | Per-area measurement and surface confirmation | Defaults by area | Uses enabled areas | Aggregate fields | Zero/wrong line | explicit / verified derivation / manual | Require one valid area and details | pricing | pending_ben_review |
| QD-08 | Gutters | Should gutter guards be proactively offered, and when? | Offers guards with other add-ons | Applies only when populated | Not consistently asked | Missing scope or longer calls | universal / customer-led / configured campaigns | Keep drains and minor repairs as confirmed conditional offers; decide guard timing separately | pricing, call length | pending_ben_review |
| QD-09 | Solar | Firm versus manual | Firm web price | Firm per-panel math | Policy says manual | Channel conflict | firm / manual / threshold | Keep owner-decision block until approved | confidence, booking | pending_ben_review |
| QD-10 | Screen repair | Firm versus manual | Firm web price | Firm per-screen math | Policy says manual | Channel conflict | firm / manual / threshold | Keep owner-decision block until approved | confidence, booking | pending_ben_review |
| QD-11 | Sq-ft services | Unknown square-footage fallback | Lookup helper | Returns missing | Can stall | Guessing or abandonment | verified lookup / text form / manual | lookup → secure form → review; never guess | call length, confidence | pending_ben_review |
| QD-12 | Partial windows | Long-term pricing architecture | No ordinary web path | Separate versioned $10/side rule | Orchestrator uses rule | Split authority | integrate engine/config / keep versioned / manual | Move into versioned configured canonical engine later | pricing | pending_ben_review |
| QD-13 | Promotion | Count and over-limit behavior | Sends configured max | Requires actual count; over max review | Delivery mapping incomplete | Misstated scope | ask actual / max assumption / standard fallback | Ask actual; explicit choice before standard fallback | pricing | pending_ben_review |
| QD-14 | All | Booking duration authority | Local fixed estimates exist | Returns null | Readiness needs positive | Guessed slot length | duration engine / manual / provider rule | Build versioned deterministic duration engine separately | booking | pending_ben_review |
| QD-15 | All | Pre-price contact order | Booking collects later | Not pricing | Current reducer name/phone first | Friction | before / after / verified reuse | Preserve current channel behavior pending funnel decision | call length | pending_ben_review |
| QD-16 | All | Service-area sequence | Address during booking | Not pricing | City/address sequencing varies | Quote outside area | pre-price / post-price-pre-schedule | Check before availability, not as pricing input | booking, call length | pending_ben_review |

## Documented future option — not active

A possible $50 in-person consultation, potentially credited toward booked work, is documented for later owner review. It has no canonical add-on identifier, is not selectable, and must not become the default escape hatch for incomplete remote quotes.
