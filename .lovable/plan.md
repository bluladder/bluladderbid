
## Goal

Redefine the three Service Plans to match your spec, surface a prominent **Customize plan** button, and add the touchup‑guarantee language for each tier.

## 1. New plan compositions

| Tier | Ext windows | Int windows | Gutter | House wash | Driveway | Pressure wash | Roof |
|---|---|---|---|---|---|---|---|
| **Good** | 4x/yr | 1x/yr (bundled with one exterior visit) | — | — | — | — | — |
| **Better** | 4x/yr | 2x/yr | 1x/yr | — | 1x/yr | — | — |
| **Best** | 2x/yr | 4x/yr | 2x/yr | 1x/yr | 1x/yr | 1x/yr | — |

The pricing engine today only supports gutter/house wash/roof as *included* services and only a single `additionalServicesFrequency` shared by all of them. Best (gutter 2x vs driveway 1x, pressure 1x) and Better (driveway inclusion) need per‑service frequencies.

## 2. Touchup guarantee copy

- **Good** feature line: `10-day rain guarantee — free touch-ups within 10 days of service`
- **Better** feature line: `Unlimited window touch-ups between visits`
- **Best** feature line: `Unlimited window touch-ups between visits` (replaces the existing "Free touch-ups between visits")

Copy only — no pricing effect.

## 3. Prominent Customize button

Add a **Customize plan** button directly in `PlanUpsellCard` (the card most customers see first), next to *Upgrade & Book on Autopilot*. It opens the existing `PlanCustomizeDrawer` for the currently selected tier. The customize button on the full `ServicePlanSelector` grid remains.

## Technical details

**A. Engine changes (`src/lib/pricing/engine.ts` + mirror in `supabase/functions/_shared/pricingEngine.ts`)**

Extend `BundleConfigEntry` with optional per‑service overrides:

```ts
includedServiceFrequencies?: Record<
  "gutter_cleaning" | "house_wash" | "driveway_cleaning" | "pressure_washing" | "roof_cleaning",
  number
>
```

In the tier build loop:
- Move driveway/pressure into the *included* branch when they appear in `includedServices`, priced at their per‑service frequency (default 1). Otherwise keep them as addons — no behavior change for tiers that don't include them.
- Read gutter/house wash/roof frequencies from `includedServiceFrequencies` when present; fall back to today's `additionalServicesFrequency`. This is a superset — old configs behave identically.
- The included list is authored from `includedServices` regardless of whether the customer selected the service one-time, so plan preview shows the plan composition (already true for gutter/house wash today; extend to driveway/pressure).

**B. DB migration — update `pricing_config.bundle_config`**

```json
{
  "good":   { "exteriorWindowFrequency": 4, "interiorWindowFrequency": 1,
              "includedServices": [], "additionalServicesFrequency": 1,
              "label": "Core Window Care",
              "description": "4 exterior window visits per year, one includes interior — with a 10-day rain guarantee." },
  "better": { "exteriorWindowFrequency": 4, "interiorWindowFrequency": 2,
              "includedServices": ["gutter_cleaning","driveway_cleaning"],
              "includedServiceFrequencies": { "gutter_cleaning": 1, "driveway_cleaning": 1 },
              "label": "Windows + Curb Appeal",
              "description": "Full year of window care plus gutter and driveway cleaning, with unlimited touch-ups." },
  "best":   { "exteriorWindowFrequency": 2, "interiorWindowFrequency": 4,
              "includedServices": ["gutter_cleaning","house_wash","driveway_cleaning","pressure_washing"],
              "includedServiceFrequencies": { "gutter_cleaning": 2, "house_wash": 1, "driveway_cleaning": 1, "pressure_washing": 1 },
              "label": "Total Home Care",
              "description": "Frequent interior + exterior windows, gutters twice a year, plus house wash, driveway and pressure washing." }
}
```

Discounts (`bundleDiscount`, `addonDiscount`) are unchanged. `bundle_rules.alwaysAddonServices` stays as-is (driveway/pressure remain addons for tiers that don't include them).

**C. Features list (engine)**

After existing feature lines, append per-tier guarantee copy:

- `good`: push `10-day rain guarantee — free touch-ups within 10 days of service`
- `better`, `best`: push `Unlimited window touch-ups between visits`
- Remove the existing `if (tier === "best") push "Free touch-ups between visits"` line so wording is consistent.

**D. UI — `src/components/homeowner/PlanUpsellCard.tsx`**

- Add `onCustomize?: (tier) => void` prop.
- Render a secondary `Customize plan` button under `Upgrade & Book on Autopilot`, disabled when `!hasValidPlan`, calling `onCustomize(currentBundle.tier)`.
- Wire it from `src/pages/Index.tsx` and `src/pages/ServiceLanding.tsx` to open the existing `PlanCustomizeDrawer` for the current tier (both pages already own `setTierCustomization`).

**E. Tests**

- Extend `src/lib/pricing/engine.planOptions.test.ts` / `engine.bundleParity.test.ts` snapshots for the new compositions (Best now includes driveway 1x + pressure 1x, Better includes driveway 1x).
- Update `src/components/homeowner/PlanUpsellCard.failClosed.test.tsx` if it asserts feature copy.

## Out of scope

- Payment schedule, deposit %, installments — unchanged.
- The `alwaysAddonServices` list — unchanged.
- One-time quote pricing — unchanged.
