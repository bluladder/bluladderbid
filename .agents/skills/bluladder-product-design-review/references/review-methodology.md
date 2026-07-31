# BluLadder design review methodology

Use this method in Audit and Verification modes. Narrow it to the approved route or journey when the request is focused.

## 1. Discovery

Identify:

- all customer-facing routes in scope;
- service-specific, general, campaign, city, educational, service-plan, and quote entry points;
- booking and returning-customer paths;
- mobile navigation and footer paths;
- cross-product transitions and embed/standalone behavior;
- shared components, duplicated components, route templates, and one-off variants;
- authoritative loading, validation, error, empty, disabled, success, and confirmation states;
- the local, preview, and live targets that are actually available.

Create a route/journey matrix before sampling a large templated route set. Review canonical templates plus representative high-risk variants rather than treating hundreds of generated city/service pages as unrelated designs.

## 2. Representative journeys

Test relevant journeys:

1. Homepage → service page → quote
2. City page → service quote
3. Paid-ad landing page → quote
4. QR or postcard landing page → quote
5. Window-cleaning page → quote
6. House-washing page → quote
7. Gutter-cleaning page → quote
8. Service-plan page → plan selection
9. General BID entry → initial quote
10. Service-specific BID entry → initial quote
11. Quote result → booking
12. Returning customer
13. Customer uncertain which service they need
14. Mobile customer using one hand
15. Older homeowner with limited technical confidence
16. Distracted or outdoor customer
17. Customer entering incomplete or incorrect information

For cross-product journeys, verify that CTA copy, selected service, attribution, embed state, visual expectations, and confirmation language survive the transition.

## 3. Evaluation categories

Evaluate each screen and journey for:

- first visual impression;
- primary-action clarity;
- visual and information hierarchy;
- cognitive load and number of decisions;
- clicks, friction, and unnecessary repetition;
- customer trust and clarity;
- accessibility and mobile usability;
- brand recognition and consistency;
- copy quality and scannability;
- form usability and button prominence;
- contrast and focus visibility;
- conversion risk and navigation clarity;
- error recovery and perceived speed;
- perceived professionalism;
- cross-product continuity;
- whether the interface feels custom or generic.

## 4. State review

Review where applicable:

- initial, hover, focus, active, selected, and pressed states;
- disabled and unavailable states;
- loading and skeleton states;
- empty and no-result states;
- validation, error, retry, and recovery states;
- success and confirmation states;
- long-content and localization-stress states;
- small-screen, zoomed, and reflow states;
- slow-network and interrupted-session behavior.

Do not infer a state from a component name. Trigger it or cite code-only evidence.

## 5. Viewport and input matrix

Minimum practical viewport set:

- 390 × 844: common modern phone baseline
- 360 × 800: narrower Android baseline
- 320 × 568: constrained-width stress case when the route supports it
- 768 × 1024: tablet
- 1440 × 900: desktop

Use portrait phone testing first for conversion flows. Add landscape, large desktop, or browser-specific checks only when the layout or risk justifies them.

Test:

- touch;
- keyboard-only navigation;
- pointer hover where applicable;
- browser zoom/reflow to 200% where practical;
- reduced motion when motion exists.

## 6. Accessibility

Check:

- semantic landmarks and heading order;
- descriptive page titles;
- accessible names and instructions;
- label, help, error, and control relationships;
- focus order, focus visibility, and focus restoration;
- keyboard reachability and escape behavior;
- contrast and non-color status cues;
- touch-target size and spacing;
- zoom, reflow, and text resizing;
- motion preferences;
- image alternatives;
- dialog, drawer, menu, accordion, and tab semantics;
- live-region behavior for asynchronous updates;
- error summary and recovery.

Automated accessibility scans supplement, but never replace, keyboard and journey review.

## 7. Performance and resilience

Where tooling permits, check:

- layout shift;
- oversized imagery and responsive image behavior;
- blocking fonts and perceived loading;
- route-level lazy loading;
- console errors and unhandled promise rejections;
- duplicate navigation or submission;
- route refresh and session restoration;
- offline/timeout copy;
- disabled-feature and environment-configuration behavior.

Do not claim a performance score without recording the target, build, device profile, and command.

## 8. Finding classification

Classify each finding as exactly one primary type:

1. Defect
2. Usability problem
3. Visual inconsistency
4. Conversion problem
5. Accessibility problem
6. Brand problem
7. Optional enhancement

Use severity:

- **P0:** blocks completion, creates material falsehood, exposes sensitive data, or creates severe accessibility exclusion.
- **P1:** materially harms completion, trust, mobile use, or a critical journey.
- **P2:** noticeable friction or inconsistency with a bounded workaround.
- **P3:** polish or optimization with low immediate customer harm.

## 9. Finding contract

Every finding includes:

- product;
- route;
- screen or component;
- viewport and input method;
- state;
- severity;
- category;
- customer impact;
- evidence;
- recommended correction;
- local or systemic scope;
- implementation complexity: S, M, or L;
- conversion impact: low, medium, or high;
- accessibility impact;
- engineering review required: yes or no.

Avoid vague findings such as “make this cleaner.” Describe the observed problem, the customer consequence, and a testable correction.

## 10. Audit completion

Before recommending implementation:

- deduplicate systemic findings;
- identify the few changes with the largest customer impact;
- separate facts from hypotheses;
- flag business-rule or data dependencies;
- record untested journeys and environmental limits;
- propose a small first implementation slice;
- define objective verification criteria.
