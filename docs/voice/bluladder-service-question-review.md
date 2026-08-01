# BluLadder service question review

Updated 2026-07-31. **No wording in this document is wired into a production prompt or controller.** Canonical prompts for newly confirmed fields are approved as shared contract copy; any additional proposed voice phrasing remains unapproved.

Universal post-price fields: email to save/deliver; authorized service address before availability/booking. Verified customer/property values may satisfy contact, address, square footage, stories, roof type, and measured areas when the canonical contract permits verified/derived provenance. No default is considered verified.

| Service | Required before price | Conditional/add-on | Current wording | Proposed wording (unapproved) | Pre-price recap | Manual review / unresolved |
|---|---|---|---|---|---|---|
| Whole-home windows | square footage; stories; canonical sides; condition; screen profile; enclosed-patio profile | hard water %, French panes %, ladder category; solar coverage/count/service; screened-enclosure soft wash; enclosure window count/sides | “How many square feet is your home?”; “Would you like exterior only, or full service inside and out?”; condition manifest question | Contract prompts distinguish standard/no/solar/mixed/fixed screens and none/screened/window/mixed enclosures; ask only the branch selected | scope, sides, sqft, stories, condition, screen profile/provenance, enclosure profile, every selected modifier/add-on | Hard-water/French/ladder screening remains pending; partial solar and mixed enclosure require clarification |
| Partial windows | count; canonical sides; partial route | areas/access notes do not currently change deterministic rule | “Is this every window…or a specific count?” | “How many windows, and outside only or inside and outside?” | count, sides, rule version | Separate versioned path; architecture pending |
| Window promotion | explicit promotion ID from config; actual count | eligibility/cap from config | Promo card advertises configured offer | “Would you like the configured exterior-window special? How many windows?” | offer ID/version/count/cap/prep | Over limit routes review/standard choice; policy pending |
| House wash | home sqft; stories; enclosed-patio profile | rust/irrigation stain; screened-enclosure soft wash; front/back patios using one selected method; optional full window-cleaning branch | “Primary Stain Type” | Ask front/back selection first; offer optional exact sqft. Reuse the complete canonical window branch when selected | sqft, stories, stain, enclosure choice, each patio/method, bundled window facts | Patio and enclosure prices confirmed; window branch retains its own pending policies |
| Gutters | home sqft; stories | exact underground-drain count; multi-select repair needs; guards→linear feet | Web add-on labels and “Number of Drains” / “Linear Feet of Gutters” | “How many underground drains or downspouts would you like us to clear?” and the canonical repair-needs multi-select | sqft, stories, exact drain count, selected repairs, guards | Drain/repair offers and prices confirmed; unknown drain or major/uncertain repair routes only that add-on to clarification; guard timing pending |
| Roof | home sqft; stories | type and severity change math | Current web selectors | “What roof type and buildup severity should the quote use?” | sqft, stories, type, severity | Firm-without-modifiers policy pending; no automatic approval |
| Driveway | driveway sqft; surface | none | “Driveway Size”; “Surface Type” | “About how many square feet is the driveway, and what surface is it?” | driveway sqft, surface | Defaults are not confirmation |
| Pressure washing | at least one named area with positive sqft; shared surface type | additional named areas | Area cards and “Surface type” | “Which areas—front porch, back patio, pool deck, or walkways? About how many square feet is each, and what surface are we cleaning?” | each selected area and sqft; shared surface | Invalid/zero enabled area cannot be firm |
| Solar panels | panel count | none | Current quantity control | “How many solar panels need cleaning?” | panel count | Firm-vs-manual pending Ben review |
| Screen repair | screen count | none | Current quantity control | “How many screens need repair?” | screen count | Firm-vs-manual pending Ben review |
| Commercial windows | no automated residential price | structured location(s), property/scope/frequency/access, preferred contact | No complete shared wording | “I’ll collect the property locations and scope for a custom bid.” | structured scope only | Always separate manual bid path |
| Multi-service | deduplicated union of each selected service | union of selected modifiers/add-ons | No canonical combined sequence | Combine shared sqft/stories once; then service blocks | union, grouped by service | Any unresolved service blocks channel approval |

Fields that may be deferred: contact sequence remains channel-specific; email/address are after price by contract. Fields removed from pricing: siding material and roof pitch are not current engine inputs. Derived values are allowed only where the contract says so and must retain `derived`, not `verified`, provenance.

## Confirmed conditional sequences

1. For window cleaning, ask the screen profile. Only solar/mixed answers open solar coverage, affected-count, and service questions. `no_screens` receives the 5% discount only with captured/verified/corrected provenance.
2. For window cleaning or house washing, ask the enclosed-patio profile. Screened opens the optional $150 soft wash. Window-enclosed plus window cleaning opens count and sides. Mixed/uncertain asks for clarification.
3. For gutter cleaning, the independently quotable base remains visible. Selected underground-drain service requires an exact count. Repair needs may be multi-selected; qualifying minor needs receive one +30%, while uncertain/other needs route only repair scope to review.
4. For house-wash patios, default to simple front/back selection. Exact square footage is optional and replaces—not supplements—the simple method.
5. Selecting qualifying house washing and window cleaning derives the stable `house_wash_window_cleaning_bundle` adjustment once.

Calculation order: base services → count/measurement add-ons → service-specific percentage adjustments → fixed bundle discounts → other explicitly authorized promotions → final total.

Exception: the configured `$99` window promotion remains an explicit, mutually exclusive flat-price branch and returns before ordinary whole-home service math. This preserves its non-stacking eligibility/cap rules instead of treating it as a discount on a standard quote.

The possible $50 in-person consultation is documented-only, inactive, and not a default fallback.
