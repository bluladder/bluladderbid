# Manual customer-journey acceptance

Execute only in a separately authorized hosted window with approved synthetic
identities. This pack does not authorize deployment, provider changes, messages,
calls, database writes, or Oregon activation.

Capture the deployed SHA, project/environment, synthetic identity, operator,
UTC timestamps, correlation and domain-record IDs, provider IDs, diagnostics,
screenshots, and redacted logs for every phase.

| Phase | Required action and result | Stop immediately if |
|---|---|---|
| Landing | Open every public CTA at 320, 375, 390, and desktop widths. Confirm the canonical booking route, attribution continuity, privacy/contact links, and truthful loading/errors. | Obsolete booking path, clipped primary action, raw PII in analytics, stale PDF action, or misleading success copy. |
| Eligible booking | Submit one approved DFW address, firm quote, current slot, and explicit confirmation. Prove exactly one customer/property/quote/booking lineage and DFW organization. | Any write before eligibility, duplicate, org fallback/override, stale duration, or false confirmation. |
| Territory failures | Try approved Oregon, non-DFW Texas, incomplete, conflicting, and provider-unavailable fixtures. Prove no authoritative write or communication. | DFW fallback, Oregon activation, service promise, or message. |
| Retry/replay | Replay an eligible request and client timeout with the same key. Prove one semantic outcome and no unknown-result retry. | Second provider/business effect or uncertainty reported as success. |
| Intervention | Trigger booking failure with intervention persistence success and failure. | Office/callback/booking claim without durable evidence. |
| Bid delivery | Exercise email/SMS concurrency, same/different keys, provider timeout, and duplicate/out-of-order webhooks. | Duplicate message, cross-customer access, event regression, or terminal quote delivery. |
| Bid response | Accept/decline authorized fixtures; repeat, cross-customer, stale, and out-of-order transitions. | Unauthorized transition, lineage leak, or duplicate business event. |
| Follow-up | Exercise due, duplicate, stale claim, suppression, consent, accepted-crash, and unknown-provider fixtures. | Duplicate communication, consent bypass, or state advancement from uncertainty. |
| Voice | Execute every scenario in `docs/voice/real-call-acceptance.md`. | Disabled voice writes, caller-selected identity/org, false success, duplicate booking, or transcript/PII exposure. |
| Operator | Inspect all eight diagnostic workflow views, redaction, unresolved counts, stale resolution, and cross-tenant denial. | Missing incident, stale overwrite, cross-tenant/PII exposure, or mock evidence labeled hosted. |
| Closeout | Reconcile approved uncertain fixtures and resolve incidents with independent review. | Unproven resend, state regression, unresolved P0/P1, or evidence gap. |

Acceptance requires every phase to pass, independent evidence review, zero
unresolved P0/P1 findings, Oregon remaining inactive, and explicit sign-off.
Any stop condition makes the launch **NO-GO**.
