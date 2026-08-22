# BluLadder Klamath Vapi raw assistant provisioning runbook

Status: **repository serializer verified; provider execution remains separate
and blocked until the exact merged head is independently confirmed**.

This runbook does not authorize or perform provider access, assistant creation,
phone import or binding, hosted mutation, deployment, calls, messages, tool
invocations, customer traffic, or activation.

## Current API contract

Vapi's live OpenAPI document was inspected read-only on 2026-08-21. Its
`CreateAssistantDTO` defines `serverMessages` as a top-level JSON array whose
items are server-message enum strings. The same live document's `MonitorPlan`
contains listening, control, authentication, and monitor-identity settings; it
does not contain `serverMessages`.

This live schema is authoritative over the historical 2025 release note that
described a move under `monitorPlan`. The browser preflight also showed that
the interactive API Explorer rendered the field as a single-selection control,
even though the raw API contract is an array.

Authoritative public evidence:

- Vapi live OpenAPI: `https://api.vapi.ai/api-json`
- Vapi Create Assistant reference:
  `https://docs.vapi.ai/api-reference/assistants/create`

The repository adapter therefore emits exactly one top-level
`serverMessages` array. A scalar, comma-delimited value, partial selection,
duplicate, reordering, extra event, or nested
`monitorPlan.serverMessages` representation fails closed.

## Immutable repository inputs

The owner-approved provider-neutral source remains
`supabase/functions/_shared/voiceProviderKlamathConfig.ts`, exactly 9,195 bytes
at SHA-256
`f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1`.

The serializer is
`supabase/functions/_shared/voiceProviderKlamathVapiSerializer.ts`. It accepts
private provider authority only as in-memory runtime input and emits the
current raw `POST /assistant` request. It never stores or reports that
authority.

The serializer requires:

- the runtime server-events URL;
- the reviewed server credential identity;
- exactly three distinct, published, version-pinned tool references; and
- the complete reviewed name, description, and zero-argument schema for each
  referenced tool.

The tool definitions must match the approved manifest in exact order. The raw
assistant request emits only version-pinned tool references, never transient
tools or unpinned tool identities.

## Provider preflight

Before creating temporary credentials or transmitting a request, the
separately authorized browser operator must:

1. pin the exact merged GitHub main and verify its CI and Secret Scan;
2. recompute the approved manifest byte count and SHA-256;
3. verify one intended Vapi organization and zero Klamath assistant
   collisions;
4. retrieve the exact three existing tool versions and compare their complete
   function definitions with the manifest;
5. verify the reviewed server credential by presence only; and
6. confirm no DFW or unrelated resource is selected for mutation.

Any ambiguous identity, missing version, tool drift, credential mismatch,
schema mismatch, or repository mismatch stops the operation before mutation.

## One-shot raw creation

Use a secure server-side request mechanism. Do not use the interactive
Explorer, browser-page JavaScript, a public client, a committed script, or any
mechanism that can expose a private Vapi key.

1. Resolve the runtime-only inputs in memory.
2. Build the request exclusively with
   `buildKlamathVapiCreateAssistantRequest`.
3. Serialize it exclusively with
   `serializeKlamathVapiCreateAssistantRequest`.
4. Parse the final JSON string again and run
   `verifyKlamathVapiCreateAssistantRequest`.
5. Confirm the verifier returns no drift paths and the top-level
   `serverMessages` value is an array containing exactly five entries.
6. Transmit at most one raw `POST /assistant` request.

Do not retry a timeout, ambiguous response, validation error, or non-success
status. A failed or ambiguous request returns to primary release review.

## Raw saved-state postflight

After a successful creation response, immediately retrieve that exact
assistant through the raw API and pass the unmodified response to
`verifyKlamathVapiSavedAssistant`. The verifier compares every emitted
provider-effective field and returns sanitized JSON paths only.

The postflight must additionally confirm through the raw response that:

- the assistant is unique and isolated;
- the approved model and OpenAI voice are saved;
- a separate transcriber and a separate voice model are absent;
- the complete first message and system prompt match;
- exactly three version-pinned tools remain attached with no transient or
  unpinned tools;
- the server URL and reviewed credential match in memory;
- all five server messages remain in exact order;
- duration, warning hooks, pacing, privacy, transcript, and disabled analysis
  settings match;
- phone binding, transfer destination, fallback assistant, and unrelated
  authority remain absent; and
- existing DFW and other non-Klamath resources remain unchanged.

Any drift stops the process. Do not patch, recreate, delete, import or bind a
phone, place a call, send a message, or invoke a tool.

## Sanitized handoff

Revoke the temporary Vapi key and clear all transient credential material on
success or failure. Return only the fields allowed by
`docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json`.
The receipt may contain sanitized paths such as `$.serverMessages`, but no raw
provider identity, phone digit, credential, header, live server URL, transfer
recipient, customer data, or message content.

Even a completely verified assistant remains unbound and inactive. Phone
import, hosted tenant binding, deployment, owner-controlled QA, customer
traffic, and final activation require separate approvals.
