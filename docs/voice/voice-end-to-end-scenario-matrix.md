# Voice End-to-End Scenario Matrix

The automated contract suite is `supabase/functions/_shared/voice/voiceEndToEndScenarioMatrix_test.ts`. It uses test doubles and pure state transitions; it makes no provider or production calls. Passing a matrix row proves the named contract helper, not that every step is reachable through the deployed controller. Rows marked contract-only require a separate production integration before they may be advertised or enabled. “Manual later” means the provider-facing verification remains separately authorized.

| # | Scenario | Deterministic expected result | Automated evidence | Manual later |
|---:|---|---|---|---|
| 1 | New customer, residential quote | Intent is sticky; callback then only canonical service fields; recap precedes price. | controller, canonical intake, matrix | End-to-end call only if authorized |
| 2 | Returning customer, one safe match | Contract helper can gate on resolved identity; production controller performs no phone-only lookup or greeting until tenant authority is available. | identity contract, controller rollout tests, matrix | Production tenant-authority integration, then provider caller-ID ingress |
| 3 | Ambiguous customer | Contract helper fails closed; production controller does not query or disclose customer records. | identity contract, controller rollout tests, matrix | Production tenant-authority integration |
| 4 | Caller-ID spoof attempt | Contact may be captured; identity and stored records remain locked. | controller rollout test, matrix | None |
| 5 | Price-changing correction | Replace value and clear quote, duration, acceptance, delivery, slots, booking. | quote-session adapter tests, matrix | None |
| 6 | Add/remove service after price | Canonical fingerprint changes; dependent downstream state clears. | quote-session tests, matrix | None |
| 7 | Stale quote tool call | Full quote identity mismatch rejects delivery/availability/booking. | quote identity and delivery tests, matrix | None |
| 8 | Stale duration | Booking readiness returns duration blocker; no slot mutation. | duration/readiness tests, matrix | None |
| 9 | SMS provider accepted | Say accepted for delivery; do not say sent or delivered without later evidence. | delivery tests, matrix | One approved SMS |
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
| 26 | Existing valid quote | Contract-only helper validates identity/org-scoped selection; production controller returns `tenant_authority_required` and discloses nothing. | existing-record tests, controller rollout tests, matrix | Production tenant-authority integration, then read-only fixture retrieval |
| 27 | Expired/superseded quote | Contract-only helper never revives silently; production controller remains fail-closed. | existing-record tests, controller rollout tests, matrix | Production tenant-authority integration |
| 28 | Successful reschedule | Contract-only recovery helper requires exact booking, current slot, confirmation, and provider+local success; production controller performs no mutation. | recovery tests, controller rollout tests, matrix | Production integration, then one approved fixture reschedule |
| 29 | Reschedule provider rejection | Contract-only helper preserves the existing time; production controller performs no mutation. | recovery tests, controller rollout tests, matrix | Production integration, then controlled fixture rejection |
| 30 | Successful cancellation | Contract-only recovery helper requires exact booking, confirmation, and provider+local success; production controller performs no mutation. | cancellation/recovery tests, controller rollout tests, matrix | Production integration, then one approved fixture cancellation |
| 31 | Cancellation retry | Contract-only helper models a versioned idempotency key; production controller performs no mutation. | cancellation/idempotency tests, controller rollout tests, matrix | Production integration, then optional fixture replay |
| 32 | Cancellation uncertain | Contract-only helper forbids retry/success claims; production controller performs no mutation. | recovery tests, controller rollout tests, matrix | Production integration, then controlled timeout |
| 33 | General question | Question intent remains outside quote intake; no quote mutation. | router/controller tests, matrix | None |
| 34 | Field-team memo | Contract-only helper verifies customer/booking/org; production controller returns `tenant_authority_required` and writes nothing. | memo tests, controller rollout tests, matrix | Production tenant-authority integration, then confirm field-team surface |
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
