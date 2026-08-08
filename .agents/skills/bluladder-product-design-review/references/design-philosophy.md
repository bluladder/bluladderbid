# BluLadder design philosophy

## Experience character

BluLadder should feel clean, precise, confident, premium, approachable, local, trustworthy, modern, fast, clear, helpful, competent, calm, and purposeful.

Customers should sense disciplined professional care before they repeatedly see the logo. The experience should communicate next-level cleanliness, visible attention to detail, reliability, safety, respect for the home, local accountability, easy decision-making, clear expectations, and premium execution without luxury theater.

Premium means clarity, consistency, proportion, restraint, polish, and confidence. It does not mean dark backgrounds, gold accents, excessive whitespace, ornamental styling, or slow cinematic interactions.

## Shared visual foundations

### Color

- Treat the darker BluLadder blue as the dependable brand anchor and the bright blue as a strategic accent.
- Reserve the strongest blue for primary actions, important progress, selected states, and brand recognition.
- Maintain high contrast in text, controls, focus states, and status communication.
- Use semantic success, warning, and destructive colors only for meaning.
- Do not rely on color alone.

Existing implementations differ and must not be silently unified:

- Public website currently anchors brand color at `#1F5FA8` with accent `#00CFFF`.
- BluLadder BID currently uses a brighter cyan-primary token around HSL `193 100% 45%`.

Treat token reconciliation as a design decision requiring an audited proposal, not as incidental cleanup.

### Typography

- Use Montserrat for purposeful display hierarchy and Inter for highly legible body and interface text.
- Keep heading levels structurally meaningful.
- Use fewer, stronger size and weight changes instead of many near-duplicate styles.
- Avoid tiny supporting text, overlong line lengths, all-caps paragraphs, and low-contrast secondary copy.

### Spacing

- Use a consistent 4-pixel-derived scale.
- Favor generous breathing room around decisions while keeping task flows efficient.
- Use grouping and alignment before adding borders or containers.
- Preserve touch-safe spacing and avoid controls crowded against viewport edges.

### Radius and shadows

- Use modest radii that feel precise and approachable.
- Use elevation to communicate layering, not decoration.
- Keep shadows soft and rare.
- Avoid card-within-card layouts, excessive pills, glassmorphism, and ornamental glow.

### Icons

- Prefer the existing Lucide system.
- Keep stroke weight, optical size, and label relationship consistent.
- Use icons to aid recognition; never substitute ambiguous icons for required text.

### Photography

- Prefer real BluLadder people, vehicles, homes, workmanship, and before/after proof.
- Show clean outcomes, safe working practices, local familiarity, and respect for the property.
- Avoid generic contractor stock imagery, implausibly perfect luxury homes, unsafe ladder use, and imagery that competes with the action.
- Define focal points and responsive crops; never place essential subjects behind text or controls.

### Motion

- Use motion to preserve context, show causality, or confirm progress.
- Keep common transitions brief and subtle.
- Respect reduced-motion preferences.
- Avoid looping decoration, large parallax, bouncing calls to action, and animations that delay task completion.

## Interaction principles

1. Make the next best action obvious.
2. Ask for one coherent decision at a time.
3. Explain why information is needed near the request.
4. Preserve entered data and progress whenever safe.
5. Validate early without interrupting typing.
6. Use specific, truthful error and recovery language.
7. Never claim an action succeeded until authoritative confirmation exists.
8. Keep touch targets at least 44 by 44 CSS pixels where practical.
9. Keep keyboard focus visible and logical.
10. Design for slow networks, interruption, route refresh, and mobile session loss.

## Copy principles

- Lead with the customer outcome and the next action.
- Use plain, specific language.
- Prefer short paragraphs and informative headings.
- Avoid hype, vague superlatives, internal terminology, and repeated reassurance.
- Make price, scope, timing, eligibility, and limitations easy to understand.
- Write errors that identify what happened, what remains safe, and what the customer can do next.
- Never imply notification, booking, availability, coverage, or savings that the system has not confirmed.

## Public website expression

The public website supports discovery, education, local relevance, trust, persuasion, and traffic conversion. It may use richer editorial composition, photography, social proof, and local content, but every page still needs a dominant purpose and a clear path to quote.

## BluLadder BID expression

BID supports speed, guided decisions, price confidence, low-friction completion, and booking conversion. It should reduce visual competition, preserve context, show progress and totals clearly, and keep the primary completion action near the customer's decision.

The products should look related without behaving as if they are the same product.

## Rejected patterns

- Generic SaaS dashboards for consumer tasks
- Generic contractor templates
- Excessive cards or nested cards
- Excessive gradients, shadows, blobs, badges, and rounded containers
- Weak button contrast or multiple equal calls to action
- Tiny text and dense walls of copy
- Decorative animation and screenshot-first layouts
- Every section using a different visual grammar
- Every feature receiving equal emphasis
- Repeated explanatory copy
- Styling changes that conceal business-logic changes
