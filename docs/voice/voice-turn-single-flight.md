# Voice turn single-flight (review-only Phase 2 design)

## Boundary

`voice-llm-adapter` removes only exact `isProviderRecordingNotice` matches
before transcript reconstruction or any tenant-owned write. A finalized turn
requires a provider-authenticated, non-synthetic Vapi call ID. Its stable ID is
derived from that call ID, the filtered cumulative customer-turn position, and
a SHA-256 hash of the filtered cumulative customer text.

The runtime code depends on `supabase/release-candidates/voice_turn_single_flight.sql`.
That SQL is a review-only release candidate and **must be applied through the
separately approved migration process before this runtime may be deployed**.

## Ordering and retries

`claim_voice_turn` takes a transaction-scoped advisory lock keyed by
organization and call. This serializes claim decisions across Edge isolates.
The `(organization_id, call_id, turn_id)` key deduplicates provider delivery;
the position uniqueness constraint prevents two different contents from
claiming the same cumulative position. A per-request `claim_token` makes an
automatic retry of the same PostgREST RPC POST idempotent without allowing a
separate duplicate HTTP delivery to execute.

An active earlier turn makes a later claim return `wait`. The losing request
is silent and relies on provider redelivery; it never executes the controller,
tools, persistence, or journaling. A greater committed position makes an older
claim stale. Completion and the final authority read use the same durable
ledger. The adapter constructs JSON or SSE only after that final read; stale
SSE consists solely of `[DONE]` and contains no `delta.content` frame.

## Crash recovery and leases

Claims use a two-minute lease, longer than the bounded provider/tool timeouts.
There is intentionally no automatic takeover of the same finalized turn. If
an isolate dies, the next claim transaction marks the expired claim
`uncertain`, which is terminal. This can require manual review, but cannot
repeat a booking, message, or other provider action whose outcome is unknown.
The design chooses omission/manual recovery over duplicate customer impact.

## External actions

Every controller tool and nested quote-delivery Edge call first inserts a
unique external-action claim. Duplicate, completed, still-claimed, and
uncertain action rows are all terminal to automatic execution. A timeout or
exception is persisted as `uncertain`; a failure to persist the outcome is
also safe because the existing action claim prevents another call. Provider
acceptance is recorded as completed. No external provider is called before
the claim transaction commits.

## Authority and privilege

Both ledgers are organization-scoped, reference the authoritative organization
and turn, force RLS, and grant no access to `PUBLIC`, `anon`, or
`authenticated`. RPCs are `SECURITY INVOKER` with a fixed search path and are
executable only by `service_role`. The adapter obtains organization authority
from the authenticated provider mapping before making a claim; ANI, transcript
content, client metadata, and model output never select a tenant.

## Evidence limitation

The requested production call IDs were not present in repository sources.
`voiceTurnCoordinator_test.ts` therefore uses an explicitly labeled sanitized
behavioral reconstruction. It is not represented as an original provider log.
