# BluLadder Klamath Vapi manifest review

Status: **exact candidate prepared; owner approval and provider provisioning
remain pending**. This package does not create, clone, import, edit, publish,
assign, or call any Vapi or Twilio resource.

## Exact source boundary

The candidate source is
`supabase/functions/_shared/voiceProviderKlamathConfig.ts` at 9,214 bytes and
SHA-256
`e35e56efca6160be37c1cb35cf213b2aa8f1f66cb82351e6c3c5ee09aa4c47c4`.
The checker recomputes both values from the exact file. The review template is
`docs/operations/bluladder-klamath-vapi-manifest.template.json`.

Every provider-effective value is pinned in the digest-covered source. The
only shared-file import is type-only and cannot change the emitted assistant
payload. The model, voice, duration, warning copy and timing, and server-event
list therefore cannot drift behind an unchanged Klamath approval digest.

The exact owner approval phrase for this candidate is:

`APPROVE KLAMATH VAPI MANIFEST e35e56efca6160be37c1cb35cf213b2aa8f1f66cb82351e6c3c5ee09aa4c47c4`

Approval of that digest authorizes only a separately bounded provider
preflight and provisioning review. It does not authorize credential disclosure,
phone import, phone binding, a call, a message, hosted activation, or customer
traffic.

## Candidate configuration

- Name: `BluLadder Klamath Realtime`.
- First message and system prompt identify BluLadder Klamath only and explicitly
  prohibit DFW pricing, customer, appointment, contact, provider, or fallback
  authority.
- Model: OpenAI `gpt-realtime-2025-08-28` with OpenAI voice `marin`.
- A separate transcriber is absent from the intended provider payload.
- Exactly three tools are present in order:
  `send_online_quote_link`, `send_booking_management_link`, and
  `request_human_transfer`.
- Every tool has an empty object schema and accepts no caller, organization, or
  destination authority from the model.
- The phone binding, transfer destination, fallback assistant, provider end-call
  phrases, and CallRail integration are absent.
- Model output in retained messages is disabled; background sound is off.
- Maximum duration is 900 seconds with exact warning hooks at 780 and 870
  seconds and Klamath-branded cutoff copy.
- Audio recording, video, PCAP, logging, and full-message history are disabled.
- Transcript retention remains enabled only for bounded owner QA; every
  analysis plan remains disabled.
- Server events are exactly `assistant.started`, `status-update`, `hang`,
  `end-of-call-report`, and `tool-calls`.
- The source contains no phone number, provider identifier, credential, secret,
  authorization header, server URL, or transfer recipient.

## Provisioning gates

After exact owner approval, a separately authorized provider action must:

1. preflight the signed-in Vapi organization and preserve every existing
   non-Klamath resource;
2. attach only the existing reviewed link and transfer tools by immutable tool
   identity without recreating them;
3. attach the reviewed server credential by presence only;
4. create one isolated assistant and retrieve its raw saved state;
5. fail closed on any transcriber, voice, tool, privacy, duration, server-event,
   credential-presence, or serializer drift;
6. import the selected Twilio number only after separate approval to transmit
   the Twilio account credential to Vapi;
7. create and verify Klamath-only tenant resolution keys before binding the
   phone resource; and
8. keep calls and messages blocked until hosted mappings, runtime deployments,
   rollback, and owner-controlled QA gates pass.

The DFW assistant, DFW phone resource, and all other Vapi resources remain out
of scope.
