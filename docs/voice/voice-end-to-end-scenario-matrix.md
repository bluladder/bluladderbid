# Voice End-to-End Scenario Matrix

The automated contract suite is `supabase/functions/_shared/voice/voiceEndToEndScenarioMatrix_test.ts`. It uses test doubles and pure state transitions; it makes no provider or production calls. “Manual later” means the logic is automated but the final provider integration requires the separately authorized checklist.

| # | Scenario | Deterministic expected result | Automated evidence | Manual later |
|---:|---|---|---|---|
| 1 | New customer, residential quote | Intent is sticky; callback then only canonical service fields; recap precedes price. | controller, canonical intake, matrix | End-to-end call only if authorized |
| 2 | Returning customer, one safe match | Caller ID remains a hint; resolved identity unlocks the exact customer. | identity/controller tests, matrix | Provider caller-ID ingress |
| 3 | Ambiguous customer | Ask safe disambiguation; reveal no stored PII. | customer resolver/controller tests, matrix | None |
| 4 | Caller-ID spoof attempt | Contact may be captured; identity and stored records remain locked. | controller rollout test, matrix | None |
| 5 | Price-changing correction | Replace value and clear quote, duration, acceptance, delivery, slots, booking. | quote-session adapter tests, matrix | None |
| 6 | Add/remove service after price | Canonical fingerprint changes; dependent downstream state clears. | quote-session tests, matrix | None |
| 7 | Stale quote tool call | Full quote identity mismatch rejects delivery/availability/booking. | quote identity and delivery tests, matrix | None |
| 8 | Stale duration | Booking readiness returns duration blocker; no slot mutation. | duration/readiness tests, matrix | None |
| 9 | SMS provider accepted | May say accepted/sent at configured threshold; not “delivered.” | delivery tests, matrix | One approved SMS |
| 10 | SMS queued only | Say queued; do not say sent/delivered. | delivery tests, matrix | Queue observation if desired |
| 11 | SMS timeout/rejection | Timeout is uncertain; permanent rejection is failed; no false success. | SMS outbox and delivery tests, matrix | Controlled provider failure only |
| 12 | Email provider accepted | Durable attempt/provider id; accepted is distinct from delivered. | quote-delivery tests, matrix | One approved email |
| 13 | Duplicate delivery | Existing semantic/idempotency claim returns the same attempt; no duplicate. | quote-delivery/SMS outbox tests, matrix | Optional approved replay |
| 14 | Missing street number | Ask only for digits; preserve other components. | address tests, matrix | None |
| 15 | Missing city | Ask only for city. | address tests, matrix | None |
| 16 | Missing ZIP | Ask only for five-digit ZIP and normalize spoken digits. | address tests, matrix | None |
| 17 | Ambiguous/partial geocode | Keep pending/partial confidence and require clarification/confirmation. | address/voice remediation tests, matrix | Read-only geocoder check |
| 18 | Outside service area | No availability; preserve request for human review. | service-area/readiness tests, matrix | None |
| 19 | Fresh schedule mirror | Small current slot set may be offered with version/expiry. | availability tests, matrix | Read-only Jobber comparison |
| 20 | Stale schedule mirror | Withhold slots and request authorized refresh/follow-up. | freshness/availability tests, matrix | Read-only freshness check |
| 21 | Jobber unavailable | Distinct provider-unavailable result; never reinterpret as no openings. | availability tests, matrix | Controlled outage only |
| 22 | No available appointments | State that no slot was found for the checked window. | availability language/matrix | Read-only test window |
| 23 | Selected slot becomes unavailable | No mutation; refresh current options. | slot revalidation tests, matrix | Fixture booking race only |
| 24 | Successful booking | Provider and local persistence must both confirm before success language. | booking/recovery tests, matrix | One approved fixture booking |
| 25 | Provider accepts, local persistence fails | Non-retryable reconciliation state; customer told not to rebook. | launch safety/recovery tests, matrix | Sandbox injection only |
| 26 | Existing valid quote | Identity/org-scoped latest usable quote may be presented/continued. | existing-record tests, matrix | Read-only fixture retrieval |
| 27 | Expired/superseded quote | Never revive silently; require current inputs/reprice. | existing-record tests, matrix | None |
| 28 | Successful reschedule | Exact booking, current slot, explicit confirmation, provider+local success. | recovery tests, matrix | One approved fixture reschedule |
| 29 | Reschedule provider rejection | Existing time remains; no success claim. | recovery tests, matrix | Controlled fixture rejection |
| 30 | Successful cancellation | Exact booking, explicit confirmation, provider+local success. | cancellation/recovery tests, matrix | One approved fixture cancellation |
| 31 | Cancellation retry | Same versioned idempotency key; already-applied outcome is safe. | cancellation/idempotency tests, matrix | Optional fixture replay |
| 32 | Cancellation uncertain | Do not retry or claim cancellation; reconcile. | recovery tests, matrix | Controlled timeout only |
| 33 | General question | Question intent remains outside quote intake; no quote mutation. | router/controller tests, matrix | None |
| 34 | Field-team memo | Verify customer/booking/org; idempotent bounded note; quote unchanged. | memo/matrix tests | Confirm field-team surface later |
| 35 | Disconnect + permitted follow-up | No send without consent/contact; queued/accepted truth still applies. | exit/delivery/consent tests, matrix | One approved call/SMS only |
| 36 | Explicit partial-window request | Enter partial path only from explicit language; never whole-home pricing. | intake/contract tests, matrix | None |
| 37 | Whole-home default | Explicit residential window intent defaults scope; no routine scope question. | canonical intake tests, matrix | None |
| 38 | Window sides | Always ask and capture exact inside/outside choice; never default exterior. | normalization/intake tests, matrix | None |
| 39 | Mixed firm/manual portions | Preserve priced lines, label review portion, block unsupported booking portion. | disposition/readiness tests, matrix | Owner/provider flow review |
| 40 | Cross-org/cross-customer attempt | Identity, ownership, and server-derived organization mismatch fail closed. | organization/existing-record/matrix tests | None |

## Pass criteria

- All forty executable matrix cases pass.
- Relevant dedicated suites remain green; the matrix does not replace their deeper assertions.
- Frontend, Edge, type, lint, build, mirror, and diff checks pass with no branch-caused errors. Repository-wide Deno formatting/lint baseline debt is reported separately, and the GitHub Secret Scan workflow is the authoritative post-publication secret check when local scanner binaries are unavailable.
- Provider rows above remain unexecuted until Ben grants the specific authorization described in the provider checklist.
