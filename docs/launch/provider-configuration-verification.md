# Provider configuration verification

## Purpose

This runbook verifies that the provider configuration required by the launch
contracts is present, correctly scoped, and consistent with the repository.
It produces redacted structural evidence only. It does not authorize a
deployment, provider change, credential inspection, synthetic booking,
message, email, call, webhook replay, OAuth refresh, or production-data
mutation.

The repository checker validates a sanitized evidence record. It does not read
environment variables, secret stores, provider credentials, or live provider
state:

```bash
node scripts/check-provider-config-contract.mjs \
  scripts/fixtures/provider-config/valid.sanitized.json
node scripts/check-provider-config-contract.self-test.mjs
```

That default command validates the redacted JSON **schema only** and prints
`NOT release verified`. It cannot promote the configuration launch gate.
During the separately authorized window, use exact release binding:

```bash
node scripts/check-provider-config-contract.mjs \
  /restricted/evidence/provider-configuration.sanitized.json \
  --release \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --repository-sha "$RELEASE_SHA" \
  --json > /restricted/evidence/provider-release-verification.json
```

Only `releaseVerified: true` is eligible for the configuration report. Hash that
exact output and record its SHA-256 and immutable external record ID in the
`CONFIGURATION_VERIFIED` measurements. A schema-valid, blocked, stale,
non-production, wrong-project, or wrong-SHA result remains blocked.

Copy the valid fixture to an approved evidence location before a verification
window, replace only booleans, masked identifiers, release-binding hashes,
the exact non-secret release commit SHA, and status fields, then run the checker
against that copy. Never put a
credential value, customer identifier, full phone number, email address, raw
provider payload, transcript, recording, or signed URL in the evidence file.

## Authorization boundary

### Repository-only checks

These checks are safe without provider access:

- inspect provider integration code, migrations, tests, and documentation;
- verify that server secrets are not referenced from browser code;
- validate endpoint authentication, fail-closed behavior, idempotency,
  suppression, replay, and uncertain-delivery tests;
- run the provider evidence checker against synthetic or already-sanitized
  JSON;
- compare an operator-supplied redacted configuration summary with the
  repository contract.

### Separately authorized read-only checks

These checks require an explicit provider or hosted-environment authorization:

- sign in to the expected provider account and confirm its masked identity;
- inspect configuration, resource assignments, scopes, status, and timestamps;
- list existing webhook destinations and subscribed events;
- retrieve metadata for an already-known protected-test provider ID;
- inspect presence-only secret or credential attachment status;
- run provider APIs documented as read-only when the request cannot refresh,
  rotate, acknowledge, replay, or otherwise mutate state.

### Always stop

Stop before a command or UI action that might:

- send an email or SMS, place a call, or create a Jobber record;
- refresh OAuth tokens or exchange an authorization code;
- test a webhook by delivering or replaying an event;
- save, enable, disable, assign, purchase, rotate, reconnect, or delete
  anything;
- show, copy, download, or log a credential value;
- alter routing, forwarding, number assignment, DNS, retention, RLS, or
  provider settings;
- expose customer data, a full phone number, an email address, a transcript,
  recording, or raw payload.

When a provider cannot prove that an action is read-only, classify the check as
`blocked` and record the action that needs separate authorization.

## Evidence contract

The sanitized JSON contract is enforced by
`scripts/check-provider-config-contract.mjs`.

- `authorization` must assert read-only access and deny provider mutation and
  credential inspection.
- `redaction` must attest that credential values, customer data, full phone
  numbers, and email addresses are absent.
- `environment.projectIdentity` must be masked.
- `environment.repositoryBuild` contains only a `sha256:` prefix and 12
  lowercase hexadecimal characters.
- `releaseBinding.projectRefSha256` binds the exact expected hosted project
  without storing the project ref in the sanitized matrix.
- `releaseBinding.repositorySha` is the exact full lowercase release commit.
- Every required surface must be `verified`, `blocked`, or, only for Twilio,
  `not_applicable`.
- A `verified` surface must satisfy every structural check.
- A `blocked` surface must list at least one sanitized blocker.
- The checker rejects credential- and PII-shaped field names and values.
- Release mode additionally requires production, a capture no more than two
  hours old and not future-dated, exact project/SHA binding, and every required
  surface verified (with only Twilio `not_applicable`).

The evidence contract intentionally records booleans rather than secret names
or values. Secret inventory remains in repository documentation and the
provider or hosted secret manager.

## Verification sequence

1. Record the authorization reference, operator, start time, and environment
   outside the JSON evidence if those values contain personal information.
2. Confirm the repository build using a trusted release artifact. Put only a
   redacted 12-character SHA marker in the JSON.
3. Confirm the hosted project identity through an approved read-only surface.
   Store only a masked identifier.
4. Verify public-booking dependencies.
5. Verify Jobber without invoking token refresh.
6. Verify Resend and the Lovable email connector without sending mail.
7. Verify CallRail without sending a text or changing routing.
8. Record Twilio as not applicable unless a separately approved provider
   decision and implementation exists.
9. Verify Vapi configuration without placing a call or saving settings.
10. Reconcile existing bid-delivery provider IDs and uncertain states using
    sanitized aggregate evidence.
11. Run the structural checker against the sanitized JSON.
12. Classify the result and attach only redacted screenshots or exports.

## Public booking and hosted project

### Repository settings

Browser-public settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_META_PIXEL_ID`
- `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`

Server-only settings:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`, where a server function explicitly requires it
- `LOVABLE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `PUBLIC_APP_URL`, with `APP_URL` retained as a compatibility alias

Do not copy any value. Record only:

- hosted project matches the intended release;
- browser and server project identities agree;
- service-role material is absent from browser code and browser bundles;
- the server geocoder connection is configured;
- the browser Maps key is application- and API-restricted;
- the canonical DFW organization resolves active;
- organization settings, territory, and service-availability state are
  available;
- the Jobber schedule mirror is current enough for booking.

### Read-only evidence

- masked hosted project identity and region;
- deployed function names and version timestamps;
- presence-only environment-setting status;
- browser-key restriction names without the key;
- organization-resolution and schedule-freshness aggregate results.

### Stop conditions

- project identities conflict;
- a server credential is present in client code or a browser artifact;
- geocoding, organization resolution, or schedule freshness is ambiguous;
- an inspection action would invoke a function that can mutate provider or
  production state.

## Jobber

### Repository settings

- `JOBBER_CLIENT_ID`
- `JOBBER_CLIENT_SECRET`
- `JOBBER_WEBHOOK_SECRET`
- OAuth access and refresh tokens stored in `jobber_oauth_tokens`
- Jobber GraphQL version `2025-04-16`

Never query or display token columns. `getJobberAccessToken()` is not a
read-only diagnostic: it may refresh the OAuth grant and update the database
when the current token is near expiry.

### Read-only evidence

- expected OAuth application and Jobber account identities match;
- required scopes are present;
- token row exists and its expiration metadata is current, without token
  values;
- configured webhook URL, events, and signature-auth status;
- active technician records have expected Jobber user mappings;
- `jobber_sync_state`, busy-block, and schedule-mirror timestamps are current;
- the configured API version is still supported.

### Provider checks requiring authorization

- inspect OAuth app, redirect URI, scopes, grant status, and account identity;
- inspect webhook destination, subscriptions, and signing configuration;
- execute an explicitly read-only GraphQL account, user, property, schema, or
  schedule query.

Do not invoke a mutation, connection test that refreshes OAuth, webhook test,
reconnect, or schedule sync.

## Resend and email delivery

### Repository settings

- `LOVABLE_API_KEY`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `RESEND_INBOUND_WEBHOOK_SECRET`
- `EMAIL_REPLY_TOKEN_SECRET`
- `EMAIL_FROM_NAME`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_REPLY_TO`
- `OWNER_NOTIFICATION_EMAIL`
- `PUBLIC_APP_URL` or its compatibility alias `APP_URL`

`supabase/functions/_shared/emailConfig.ts` sends through the Lovable email
connector gateway. It does not call the raw Resend send endpoint directly.
Treat the connector identity and the Resend account identity as separate
checks.

### Read-only evidence

- connector and Resend account identities match the intended environment;
- sending domain is verified and its SPF/DKIM state is healthy;
- sender and reply-to alignment is approved;
- delivery webhook destination, event set, and signature status are correct;
- inbound domain, MX status, route, webhook, and retry policy are correct;
- existing delivery, bounce, complaint, and suppression aggregates reconcile;
- outbound reply-token adoption remains disabled unless separately approved.

`listResendDomains()` is a no-send provider request, but it still requires
separate provider-read authorization.

### Stop conditions

- the UI offers to send a test email;
- a webhook test or replay would deliver an event;
- DNS, sender, route, or webhook settings would be saved;
- a raw recipient, provider payload, message body, or signing secret would be
  included in evidence.

## CallRail SMS and Twilio

### Repository settings

- `CALLRAIL_API_KEY`
- `CALLRAIL_ACCOUNT_ID`
- `CALLRAIL_COMPANY_ID`
- `CALLRAIL_SENDER_NUMBER`
- `CALLRAIL_WEBHOOK_SECRET`

The implemented SMS transport is CallRail. The repository has no `TWILIO_*`
environment contract, Twilio SDK, or Twilio Verify implementation. References
to Twilio in verification UI copy or comments do not establish a runtime
dependency. Record Twilio as `not_applicable` and record that provider decision
explicitly unless a later approved implementation changes the contract.

### Read-only evidence

- expected CallRail account and company identities match;
- API key scope is sufficient and no broader than intended;
- configured sender matches the approved sender using only a boolean and last
  four digits in external evidence;
- the sender is owned and text-enabled;
- inbound webhook destination and shared-secret presence are correct;
- public voice forwarding and number routing are unchanged;
- existing provider conversation/message IDs reconcile with local records;
- opt-out, suppression, uncertain, and failed-state aggregates are reviewed.

### Provider checks requiring authorization

- inspect account, company, key scope, sender-number status, and webhook
  configuration;
- retrieve metadata for an already-known protected-test conversation or
  message ID.

Do not invoke the CallRail text-message POST endpoint, send a test SMS, change
number routing, or expose a full number.

## Vapi voice

### Repository settings

- `VOICE_LLM_ADAPTER_SHARED_SECRET`
- `VAPI_SERVER_SECRET`
- `VOICE_HUMAN_TRANSFER_NUMBER`, configured but unused in the current phase
- `VOICE_PROVIDER_DEBUG`
- `VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE`
- `VOICE_LATENCY_METRICS`
- `VOICE_WORKFLOW_CONTROLLER_ENABLED`
- `VOICE_WORKFLOW_CONTROLLER_ALLOWLIST`
- `VOICE_WORKFLOW_TEST_SECRET`
- `AI_SCHEDULING_MODEL` or `AI_MODEL`
- `LOVABLE_API_KEY`

The authoritative repository manifest is
`supabase/functions/_shared/voiceProviderConfig.ts`.

### Read-only evidence

- expected Vapi organization and plan;
- Zero Data Retention enabled and HIPAA mode disabled;
- isolated inbound English assistant matches the manifest;
- custom-LLM and server-event credentials are attached, presence only;
- URLs target the intended hosted project;
- an isolated test DID is assigned only to this assistant;
- provider tools are empty and transfer is disabled;
- raw recording, video, packet capture, summary, structured output, and
  analysis are disabled;
- sanitized operational logging, transcript delivery, full message history,
  and end-of-call reporting match the reviewed repository manifest;
- the BluLadder 30-day transcript deadline and approved expired-row purge are
  verified;
- events are exactly `assistant.started`, `status-update`, `hang`, and
  `end-of-call-report`;
- no CallRail number or route is linked.

The current booking adapter supports only `disabled` and `dry_run`. A value
such as `live` fails closed, and the dry-run result carries
`noProviderWrite: true`.

### Stop conditions

- ZDR cannot be proven;
- raw recording, video, packet capture, summary, structured output, or
  analysis is enabled;
- transcript/full-message/end-of-call delivery differs from the reviewed
  repository manifest, or the 30-day expiry process cannot be proven;
- the assistant has a provider tool or transfer destination;
- the DID, assistant, event URL, or custom-LLM URL targets another
  environment;
- verification requires saving the assistant, assigning a number, placing a
  call, or revealing a credential.

Real-call acceptance is a separate protected window using
`docs/voice/real-call-acceptance-worksheet.md`.

## Bid delivery reconciliation

Bid delivery uses the Resend/Lovable connector path for email and CallRail for
SMS. Read-only reconciliation may aggregate:

- quote delivery attempts by channel and state;
- stable semantic keys, claim tokens, and provider-ID presence;
- stale in-flight, uncertain, and `delivery_unknown` counts;
- duplicate semantic keys;
- email and SMS suppressions;
- webhook receipt and replay state;
- quote-resume capability expiration, scope, and revocation.

Do not output recipient data, token material, message content, full provider
IDs, or raw payloads. Do not retry or resend an attempt during verification.

## Result classification

- `PASS`: every required surface is `verified`, Twilio is explicitly
  `not_applicable`, the checker accepts the evidence, and no stop condition
  occurred.
- `PASS_WITH_CONDITIONS`: use the evidence status `blocked` for each incomplete
  surface, list sanitized blockers, and record a separate authorization or
  corrective action. The overall launch provider gate remains blocked.
- `FAIL`: an identity mismatch, unexpected live dependency, artifact-retention
  violation, routing change, credential exposure, unauthorized mutation, or
  customer-data exposure occurred. Stop the window and open an incident.

## Evidence package

Capture:

- sanitized JSON accepted by the checker;
- authorization reference and time window;
- operator and reviewer signoff in the protected evidence system;
- redacted screenshots showing only identities, status, timestamps, and
  configuration labels;
- list of checks that could not be completed and why;
- anomalies, stop conditions, and incident references;
- explicit attestation that no provider or production mutation, credential
  inspection, send, call, deployment, or routing change occurred.

The repository must contain only templates and synthetic fixtures. Store real
verification evidence in the approved restricted evidence system.
