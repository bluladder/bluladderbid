# BluLadder Klamath Vapi provisioning receipt contract

Status: **manifest owner approval and sanitized provider evidence remain pending;
activation remains blocked**.

The template at
`docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json`
is the only repository shape prepared for the separate browser provisioning
handoff. It is bound to the exact candidate manifest SHA-256
`f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1`. Owner approval has not been recorded, so provider
provisioning and receipt verification remain blocked.

The receipt may contain only bounded booleans, counts, UTC timestamps,
provider-managed version markers, blocker codes, drift paths, and
non-reversible SHA-256 identity fingerprints. It must never contain a full
provider identifier, phone digit, credential, authorization header, server
URL, transfer recipient, customer datum, or message content.

Only after exact manifest owner approval can a verified receipt qualify for a
separately authorized hosted tenant-binding review. It cannot bind a phone, modify hosted data, deploy,
perform owner QA, enable customer traffic, or activate BluLadder Klamath. A
pending, blocked, ambiguous, drifting, or unsafe receipt remains blocked.
