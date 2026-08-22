# BluLadder Klamath Vapi provisioning receipt contract

Status: **candidate pending owner reapproval; provider evidence and activation
remain blocked**.

The template at
`docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json`
is the only repository shape approved for the separate browser provisioning
handoff. It is bound to the unapproved candidate manifest SHA-256
`cb53e67ccba87d01a6251f71b80c081f3ab296e4a3f6ea767112c14739bcdb90`.
Even otherwise verified provider evidence remains blocked until that exact
candidate receives separately recorded owner approval.

The receipt may contain only bounded booleans, counts, UTC timestamps,
provider-managed version markers, blocker codes, drift paths, and
non-reversible SHA-256 identity fingerprints. It must never contain a full
provider identifier, phone digit, credential, authorization header, server
URL, transfer recipient, customer datum, or message content.

A verified receipt can qualify only for a separately authorized hosted
tenant-binding review. It cannot bind a phone, modify hosted data, deploy,
perform owner QA, enable customer traffic, or activate BluLadder Klamath. A
pending, blocked, ambiguous, drifting, or unsafe receipt remains blocked.
