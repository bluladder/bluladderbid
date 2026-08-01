# Sales Engine (runtime-neutral)

Shared, framework-free contracts for BluLadder's Sales Engine. Consumed by:

- Web app (`src/`)
- Supabase Edge Functions (`supabase/functions/`)
- Voice adapter
- Future SMS / chat channels

## Dependency rules (one-way)

```
packages/sales-engine/   ← leaf. Imports NOTHING from src/ or supabase/.
        ▲
        │  imported by
   ┌────┴────┬─────────────────┐
   │         │                 │
 src/     supabase/         future SMS
          functions/
```

- **Never** import React, Vite aliases (`@/…`), Deno, or `supabase-js` here.
- **Never** import from `packages/sales-engine/` into another `packages/sales-engine/` file with framework code.
- Edge Functions import via a relative path (e.g. `../../../packages/sales-engine/…`).
  Deno resolves `.ts` extensions natively, so include the `.ts` suffix.
- The web app may add a `@sales-engine/*` tsconfig alias when it first consumes
  this package. It is intentionally omitted until then to keep the surface tiny.

## Contents (current)

- `intake/quoteIntakeContract.ts` — **authoritative** service-specific fields,
  stages, requirement categories, canonical prompts, stable add-on/adjustment
  identifiers, normalization, and readiness evaluation.
- `intake/residentialQuoteManifest.ts` — canonical intake fields for the
  legacy residential presentation sequence. It does not own requirements.

## Edge mirror synchronization

Edge bundling cannot import outside `supabase/`, so Sales Engine sources have
generated mirrors in `supabase/functions/_shared/salesEngine/`. Edit only the
`packages/sales-engine/` source, then run `node scripts/sync-sales-engine-intake.mjs`.
`src/lib/pricing/salesEngine.parity.test.ts` compares every mirror byte-for-byte.

## What lives here vs elsewhere

| Concern | Lives here | Lives elsewhere |
| --- | --- | --- |
| Service-specific intake requirements | YES | `intake/quoteIntakeContract.ts` |
| Question priority + customer-facing wording | YES | — |
| Prices, modifiers, promotion rules | NO | `pricingEngine.ts` |
| Persistence, DB access | NO | Edge functions / web |

The pricing engine is the sole authority on whether enough information exists
to price. This package translates that authority into the next question to ask.
Owner-confirmed monetary rules and their deterministic calculation order live
in the byte-identical canonical pricing engines; display labels are never used
as pricing keys. The configured `$99` promotion remains a mutually exclusive
flat-price branch, so it intentionally bypasses ordinary quote ordering and
does not stack unless its configured policy explicitly allows it.
