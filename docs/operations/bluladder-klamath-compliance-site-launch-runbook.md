# BluLadder Klamath compliance-site launch runbook

Status: **prepared, not authorized for production execution**.

This is the exact operator sequence for making only the BluLadder Klamath
privacy, terms, and public-contact pages reachable. It does not authorize
customer quote, booking, pricing, CRM, messaging, voice, territory, service, or
other provider runtime traffic.

## 1. Freeze the reviewed release

1. Require PR #186 to be merged normally after exact-head CI and Secret Scan
   pass.
2. Fetch live `main`, inspect every newer commit, and record the exact release
   SHA. Stop for any unrelated or unexplained change.
3. Require a clean worktree and prove the activation migration still matches:
   - path:
     `supabase/migrations/20260815103000_bluladder_klamath_compliance_site_activation.sql`
   - bytes: `9939`
   - SHA-256:
     `8743e66464403d67973180146c82ea82df2360d793fe737a1846900c0568c3a8`
4. Run the complete repository CI contract matrix, unit tests, typecheck, lint,
   production build, and Secret Scan against that exact SHA.

Hard stop: do not continue from a branch, stale Lovable sync, failed check, or
different migration payload.

## 2. Close the review gates

1. Recompute and require every artifact byte count, SHA-256, and the canonical
   candidate-bundle SHA-256 in
   `docs/operations/bluladder-klamath-compliance-copy-review-manifest.json`.
   This binds the review to the exact rendered privacy, terms, opt-in, HELP,
   STOP, page-heading, and public-contact rendering candidate without storing
   either protected contact value.
2. Record exact owner approval for that candidate bundle. The approval record
   must name the candidate-bundle SHA-256, not merely a branch, PR, screenshot,
   or mutable URL.
3. Record a separate qualified legal/compliance review for the same immutable
   candidate bundle. Owner approval cannot substitute for qualified review.
4. Keep both review references non-sensitive and independently auditable.

Hard stop: do not infer either approval from general launch authorization,
provider eligibility, an older campaign, or a previous copy revision.

## 3. Verify and publish the public contacts

1. Read-only retrieve the two Klamath public-contact rows and require exactly
   one `phone` channel and one `sms` channel, distinct destinations, draft
   status, complete owner-approval evidence, and no publication timestamp.
2. Perform one owner-controlled reachability test for each destination. Record
   only channel, timestamp, outcome, and a non-reversible evidence fingerprint;
   do not store digits or message content in repository evidence.
3. In one separately authorized transaction, lock the contact rows, recheck the
   exact draft state, set the reviewed verification timestamps, and publish
   only those two rows. Stop and roll back on any row-count or destination
   mismatch.
4. Read-only retrieve them again and require exactly two published contacts,
   one per channel, two distinct destinations, and complete approval,
   verification, and publication evidence.

Hard stop: do not create a fallback contact, expose a destination in GitHub,
or treat format validation as reachability proof.

## 4. Publish the dormant frontend first

1. Uniquely match the existing BluLadder Bid Lovable project and require its
   synchronized GitHub SHA to equal the reviewed release SHA.
2. Use the direct Publish control for the existing frontend. Do not prompt
   Lovable AI, edit source, deploy an Edge Function, or change hosted data.
3. Before connecting the Klamath hostname, verify the existing DFW domain still
   renders its approved customer experience and that unknown hosts remain
   fail-closed.

This order is mandatory. Connecting the Klamath hostname to an older published
frontend could expose the DFW experience at the new hostname.

## 5. Connect and verify the custom domain

1. Connect only the reviewed Klamath subdomain in Lovable project settings.
2. Apply only the exact ownership and routing records Lovable supplies. Require
   the expected `A` and `TXT` records and no conflicting `AAAA` record.
3. Wait for DNS verification and the Lovable-managed TLS certificate. Record
   only status and timestamps, not full provider verification values.
4. Before lifecycle activation, require the custom origin to show the
   fail-closed unavailable surface, never the DFW app or a customer workflow.

Hard stop: do not make the Klamath hostname primary for the shared project,
change the existing DFW domain, enable proxying during verification, or accept
an invalid certificate.

## 6. Run the immutable hosted preflight

Run unchanged:

`supabase/preflight/bluladder_klamath_compliance_site_activation.sql`

Require every value in
`docs/operations/bluladder-klamath-compliance-site-activation-gates.json` under
`required_preflight_counts`. Capture DFW fingerprints independently and require
them to match the established baseline.

Hard stop: do not repair data, publish a missing contact, replay migration
history, use include-all, or alter the preflight SQL.

## 7. Apply only the reviewed lifecycle migration

1. Obtain separate production authorization naming the exact migration path,
   bytes, SHA-256, hosted project, and release SHA.
2. Use the migration-aware Lovable/Supabase mechanism and apply only the one
   reviewed migration. If direct zero-credit application is unavailable, stop
   before using Lovable AI unless one bounded message is separately approved.
3. Require one correlated migration-ledger entry. Stop on a partial application,
   unexpected version, additional migration, history repair request, or source
   normalization that changes the pinned payload.

The migration may change only:

- the Klamath organization from `provisioning` to `active`; and
- its customer-site mapping from inactive to published compliance-only routing.

It must keep customer traffic false and every generic hostname, territory,
service, pricing, CRM, messaging, voice, and customer-data runtime disabled.

## 8. Run postflight and browser acceptance

Run unchanged:

`supabase/verification/bluladder_klamath_compliance_site_activation.sql`

Then verify from a fresh browser session:

- `/privacy`, `/terms`, and `/contact` are the only Klamath compliance routes;
- privacy and terms copy exactly match the approved candidate;
- contact renders exactly the reviewed call and text channels;
- `/` and every customer-action route remain unavailable;
- no quote, booking, chat, portal, pricing, CRM, messaging, or voice action can
  start from the Klamath host; and
- the existing DFW domain remains unchanged.

Stop and fail closed on any mismatch. Do not repair by enabling customer
traffic, changing the hostname key, or applying another migration.

## 9. Keep later provider releases separate

Only after the public surfaces are live and exact may a separate review submit
the Klamath-specific messaging campaign. The existing approved campaign is not
reusable. Number purchase, Messaging Service changes, Vapi resources, JobTread
runtime, and all customer traffic remain separate releases with their own
controlled acceptance evidence.

Complete every launch-window result in
`docs/operations/bluladder-klamath-compliance-site-launch-evidence.template.json`.
The template must stay fail-closed until the real evidence exists.
