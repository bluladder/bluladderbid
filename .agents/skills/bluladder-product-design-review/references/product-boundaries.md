# BluLadder product map and authority boundaries

## Confirmed architecture

| Product | Repository | Lovable project | Supabase project | Primary role |
| --- | --- | --- | --- | --- |
| BluLadder BID | `bluladder/bluladderbid` | `b6e0d823-59c4-4b5a-afbe-182485e5458b` (“BluLadder Bid”) | `gyndziiuizpgwhqwyrvn` | Guided quoting, pricing presentation, plan selection, booking, and customer self-service |
| Public website | `bluladder/bluladder` | `54853c5d-d12f-40a9-8d77-dddae0e8f699` (“BluLadder Home Site”) | `cjtkezrwbjpuqysuckes` | Discovery, education, local pages, campaigns, trust, and quote conversion |

Both Lovable projects are in workspace `B4aFaODpdbgZgxKbuI5y`. They are separate repositories, applications, Supabase projects, migration histories, Edge Function sets, route trees, component source trees, and deployment units.

They share React 18, Vite 5, TypeScript, Tailwind 3, shadcn/ui conventions, Radix primitives, Lucide icons, Inter body type, Montserrat display type, and BluLadder brand intent. They do not currently share a frontend package.

The public site embeds BID for some campaign journeys and receives a sanitized `postMessage` funnel-event contract. Preserve that security and analytics boundary. Existing documentation names both `bid.bluladder.com` and `quote.bluladder.com`; verify the active production hostname before a cross-product browser audit or implementation.

## Product identification

Read `docs/design-system/product-profile.md` in the active repository. Do not infer product identity only from Lovable or Supabase access.

If the profile and repository remote disagree, stop. If the Supabase project reference differs from the profile, do not connect or mutate anything; report the discrepancy.

## Design authority

The Product Design Director may:

- inspect relevant product source and behavior;
- recommend customer-facing changes broadly;
- create audit findings and implementation-ready design specifications;
- in explicit Implementation mode, modify approved customer-facing frontend presentation and interaction code;
- add or refine reusable frontend components when justified;
- add frontend-only tests and design-governance checks;
- verify local, preview, or explicitly authorized live experiences.

## Engineering dependencies

The Product Design Director must not independently change:

- pricing formulas, pricing rules, promotions, quote calculations, or service eligibility;
- estimated durations, scheduling, availability, slot holds, booking, rescheduling, or cancellation;
- customer identity, authentication, authorization, or organization resolution;
- Jobber, CRM, Supabase schemas, row-level security, Edge Functions, webhooks, or payments;
- production secrets, provider configuration, or deployment configuration;
- analytics event definitions or consent policy;
- server-side business rules or authoritative workflow state.

When a better experience requires one of these, label it `ENGINEERING DEPENDENCY`, describe the desired customer behavior, cite the current limitation, and define acceptance criteria without implementing it.

## Cross-product synchronization

Use documentation and a versioned shared-contract hash, not a shared runtime package, as the first synchronization mechanism.

When shared philosophy, method, agent instructions, or review templates change:

1. update the same files in both repositories;
2. bump `system_version` in `docs/design-system/governance.json`;
3. regenerate the shared-contract SHA-256;
4. run `npm run check:design-governance` in both repositories;
5. open coordinated PRs and note any temporary version skew.

Product-specific profiles and implementation patterns may diverge deliberately.
