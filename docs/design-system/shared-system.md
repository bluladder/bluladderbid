# Shared BluLadder design system

## Principles

1. **Outcome before ornament.** Make the customer goal and next action clear before adding decorative treatment.
2. **Confidence through truth.** Use precise promises, states, pricing context, coverage language, and confirmation behavior.
3. **Calm hierarchy.** Use typography, spacing, and sequence before boxes, badges, or color.
4. **Local proof.** Prefer real people, work, vehicles, neighborhoods, reviews, and operational specificity.
5. **Mobile is the primary constraint.** Design for one hand, interruption, outdoor light, slow networks, and limited confidence.
6. **Designed recovery.** Loading, validation, errors, retries, timeouts, empty results, and session restoration are first-class states.
7. **One brand, distinct products.** Share recognition and behavior principles while preserving each product's customer job.

## Brand personality

Clean, precise, confident, premium, approachable, local, trustworthy, modern, fast, clear, helpful, competent, visually calm, and purposeful.

BluLadder communicates next-level cleanliness, professional care, visible attention to detail, reliability, safety, respect for the home, local accountability, easy decision-making, clear expectations, and premium execution without luxury theater.

## Color system

Current product tokens are related but not identical:

| Role | Public website | BluLadder BID |
| --- | --- | --- |
| Brand anchor | `#1F5FA8` / HSL `211 70% 39%` | No equivalent dark anchor is consistently defined |
| Bright accent / primary | `#00CFFF` / HSL `191 100% 50%` | HSL `193 100% 45%` |
| Text | Charcoal HSL `220 10% 25%` | Foreground HSL `220 15% 15%` |
| Surface | White and very light cool gray | White and very light cool gray |

Do not silently replace either token system. A future token-alignment decision must:

- evaluate contrast in real states;
- define anchor versus accent roles;
- preserve conversion-critical control recognition;
- include before/after screenshots and accessibility results;
- migrate in a bounded product-specific sequence.

Semantic colors communicate only status. Never use success green, warning amber, or destructive red as decoration. Pair color with text and iconography.

## Typography

- Display and headings: Montserrat
- Body and interface: Inter
- Default body size: 16 CSS pixels or larger
- Supporting text: maintain legibility and contrast; avoid using size to hide complexity
- Line length: roughly 45–75 characters for reading content
- Numeric prices and totals: stable alignment, strong hierarchy, unambiguous cadence and qualifiers

Use semantic heading levels and a small, deliberate scale. Do not use heading styling on non-heading text to manufacture emphasis.

## Spacing

Use a 4-pixel-derived scale:

`4, 8, 12, 16, 24, 32, 48, 64, 96`

Prefer:

- 16-pixel minimum horizontal phone gutters;
- 24–32 pixels between coherent form or decision groups;
- 48–96 pixels between website narrative sections, proportionate to content;
- dense-but-breathable BID steps that keep the decision and primary action together.

## Radius

Use modest radii:

- 4–6 pixels for compact controls;
- 8–10 pixels for standard fields and surfaces;
- 12 pixels only for prominent, friendly containers;
- pills only for tags, compact statuses, or segmented choices that behave like pills.

Avoid a page where every object becomes a rounded card.

## Shadow policy

Use the lowest elevation that communicates hierarchy:

- no shadow for ordinary grouping;
- subtle shadow for floating or layered controls;
- medium shadow for dialogs, drawers, and overlays;
- never stack glow, gradient, border, and deep shadow on the same ordinary card.

## Icon policy

- Use Lucide unless a brand-specific icon is required.
- Keep visual size and stroke weight consistent within a control group.
- Pair unfamiliar icons with text.
- Provide accessible names to icon-only controls.
- Do not use decorative icons to fill empty space.

## Photography policy

Prioritize:

1. real BluLadder work and results;
2. real team, owner, vehicle, and job-site proof;
3. clear before/after evidence;
4. locally credible homes and neighborhoods;
5. carefully selected service detail photography.

Specify focal point, aspect ratio, responsive crop, alternative text, loading priority, and compression. Avoid unsafe practices, implausible stock scenes, and text baked into images.

## Motion

- Typical interaction: 120–220 ms
- Context-preserving entrance/exit: up to 300 ms
- Use opacity and small transforms; avoid large travel
- Never delay the primary action for animation
- Respect `prefers-reduced-motion`
- No looping CTA animation or decorative parallax by default

## Accessibility standard

Target WCAG 2.2 AA for customer-facing experiences.

Required design considerations:

- semantic structure and landmarks;
- keyboard access and logical focus order;
- visible focus indicators;
- 44 × 44 CSS-pixel touch targets where practical;
- text and non-text contrast;
- 200% zoom and narrow reflow;
- accessible forms, errors, dialogs, menus, tabs, and async status;
- reduced motion;
- meaningful image alternatives;
- no color-only instructions.

## Responsive breakpoints

Keep existing Tailwind defaults unless a product-specific need is proven. Design and verify at the layout's real failure points, not only framework breakpoints.

Reference widths:

- 320: constrained phone
- 360: narrow phone
- 390: common modern phone
- 768: tablet
- 1024: small desktop
- 1440: desktop

## Interaction principles

- One dominant primary action per decision.
- Stable action labels across the journey.
- Progressive disclosure for secondary explanation.
- Inline validation that does not interrupt typing.
- Preserve safe customer input across retries.
- Confirm irreversible or high-consequence actions.
- Never claim success before authoritative confirmation.
- Never rely on hover for essential information.

## Copy principles

- Lead with outcome and next step.
- Use short, specific sentences.
- State limitations and recovery paths plainly.
- Avoid internal systems language.
- Prefer proof over adjectives.
- Do not repeat the same reassurance in adjacent sections.
- Do not claim service coverage, notification, booking, availability, or savings that is not confirmed.

## Design token direction

Keep tokens in each product's existing CSS-variable and Tailwind structure for now. The shared governance layer defines semantic roles; it does not introduce a shared runtime package.

A future token normalization may use:

- a small generated token artifact copied into each repo;
- a shared source document with product adapters;
- or a package only if both applications develop a stable, independently versioned component dependency.

Do not create a package until dependency ownership, release cadence, and rollback behavior are justified.
