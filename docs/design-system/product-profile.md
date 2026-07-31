# Product profile — BluLadder BID

Repository: `bluladder/bluladderbid`

## Identity

- Product: BluLadder BID
- GitHub default branch: `main`
- Inventory baseline: `ab16b52aed84f37387c708c056ebd4591e1954ca`
- Lovable project: “BluLadder Bid”
- Lovable project ID: `b6e0d823-59c4-4b5a-afbe-182485e5458b`
- Lovable workspace: `B4aFaODpdbgZgxKbuI5y`
- Supabase project reference: `gyndziiuizpgwhqwyrvn`
- Supabase role: authoritative BID backend, Edge Functions, and migrations
- Deployment unit: separate from the public website

Existing cross-product documentation names both `https://bid.bluladder.com` and `https://quote.bluladder.com` as production BID origins. Treat the active customer hostname as unresolved until deployment or DNS evidence confirms it. Do not loosen origin allowlists to work around the discrepancy.

## Customer job

BID helps a homeowner:

1. enter through a general or service-specific quote path;
2. select services and describe the property;
3. understand a server-authoritative price;
4. compare one-time, package, add-on, or service-plan options;
5. choose a booking path;
6. receive truthful confirmation or recovery.

Optimize speed, clarity, guided decisions, price confidence, low-friction completion, booking conversion, and state recovery.

## Current frontend architecture

- React 18, Vite 5, TypeScript 5
- React Router with 23 declared route patterns
- Tailwind CSS 3 with CSS variables
- shadcn/ui conventions with 49 UI primitive files
- Radix primitives
- Lucide icons
- Inter body and Montserrat display typography
- TanStack Query, React Hook Form, Zod, Sonner
- 382 `src` files, including 218 component files and 17 page/test files
- Customer component areas: `booking`, `homeowner`, `plan-builder`, `quote`, `customer`, and `chat`
- Administrative components are substantial and are outside a customer-facing audit unless explicitly included

## Customer-facing route groups

- General quote entry: `/`
- Service discovery: `/services`
- Service-specific entry: `/window-cleaning`, `/gutter-cleaning`, `/house-wash`, `/roof-cleaning`, `/driveway-cleaning`, `/pressure-washing`, and `/:service`
- Plan building: `/plan-builder`
- Quote result: `/quote/:id`
- Booking: `/quote/:id/book`
- Customer self-service: `/customer-portal`, `/my-appointments`, `/confirm-change`, `/preferences`
- Authentication support: `/auth/callback`, `/reset-password`

## Cross-product boundary

The public website can open BID in an iframe overlay and BID can emit a sanitized versioned `postMessage` funnel contract. Preserve:

- explicit allowed parent origins;
- no wildcard target origin;
- no PII in messages;
- deterministic event IDs and deduplication;
- authoritative quote/booking success gates;
- attribution allowlists;
- no coupling of marketing analytics to pricing or booking internals.

## Existing design foundations

- Primary token: HSL `193 100% 45%`
- Accent token: HSL `200 90% 48%`
- Inter and Montserrat
- Radius: `0.625rem`
- Existing shadows, gradients, tier colors, card utilities, and CTA utilities

These foundations are implementation evidence, not an automatic approval of every use. Audit their real hierarchy, contrast, density, and cross-product continuity before proposing normalization.

## Assets

BID has service imagery/asset metadata but no confirmed full BluLadder logo source in `src/assets` at the inventory baseline. Do not copy or invent a logo during implementation; source an approved asset from the public website or brand owner.

## Testing and commands

- Install: `npm ci`
- Local development: `npm run dev` (Vite port 8080)
- Unit/integration: `npm test`
- Lint: `npm run lint`
- Type check: `npx tsc --noEmit`
- Production build: `npm run build`
- Design governance: `npm run check:design-governance`

Current repository evidence includes 63 Vitest test files and broad contract checks. It does not include Playwright, axe, Storybook, Lighthouse CI, or a visual-regression runner.

## Implementation boundary

Design work must not modify server quote calculation, pricing, eligibility, organization routing, scheduling, availability, booking creation, Jobber behavior, authentication, authorization, Supabase schema/RLS, Edge Functions, provider configuration, analytics definitions, or authoritative confirmation rules.

## Initial audit focus

The first approved audit should cover service-specific and general entry through initial quote result, with primary booking action, plan presentation, mobile form behavior, price hierarchy, trust, recovery, and continuity from the public website.
