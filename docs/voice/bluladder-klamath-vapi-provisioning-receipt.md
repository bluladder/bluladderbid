# BluLadder Klamath Vapi provisioning receipt contract

Status: **sanitized provider evidence verified; activation remains blocked**.

The template at
`docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json`
now contains the verified, sanitized browser-provisioning handoff. It is bound
to the owner-approved manifest SHA-256
`f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1`.

The receipt may contain only bounded booleans, counts, UTC timestamps,
provider-managed version markers, blocker codes, drift paths, and
non-reversible SHA-256 identity fingerprints. It must never contain a full
provider identifier, phone digit, credential, authorization header, server
URL, transfer recipient, customer datum, or message content.

The verified receipt qualifies only for the separately authorized hosted
tenant-binding review. Its `assistantBindingAbsent` field records the required
post-import, pre-binding safety check; the provider phone was subsequently
bound to the uniquely verified Klamath assistant without changing Twilio
messaging. The receipt does not authorize customer traffic, hosted data
changes, deployment, owner QA, or activation. A blocked, ambiguous, drifting,
or unsafe receipt remains blocked.
