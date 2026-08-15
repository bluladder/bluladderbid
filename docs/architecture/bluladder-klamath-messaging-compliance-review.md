# BluLadder Klamath messaging compliance review contract

Status: **owner-approved path-based public surface published; bounded Klamath
campaign submitted for Twilio/TCR review; sender and runtime remain disabled**. This package cannot by itself publish a page,
register a campaign, provision a number, send a message, enable customer
traffic, or activate Klamath.

Issue #151 records the owner's direction to use Twilio/TCR carrier vetting as
the external review step. No separate legal review is claimed or required by
this release contract.

## Purpose

Issue #151 approves the five intended SMS use cases at a business-policy level,
but exact public opt-in, privacy, terms, HELP/STOP, and representative campaign
copy still need bounded review. The safe template is
`docs/operations/bluladder-klamath-messaging-compliance-review.template.json`.
It freezes one exact candidate while leaving public-surface verification,
carrier vetting, and contract-test evidence pending.

The requirements were reconciled on 2026-08-15 against Twilio's official
[business-information and campaign requirements](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info),
[campaign-registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart),
and [consent guidance](https://help.twilio.com/articles/26147853183259-How-to-collect-customer-consent-in-A2P-10DLC-campaigns).
Twilio requires a verifiable opt-in description and representative samples;
website opt-in review includes public privacy and terms surfaces, and new
campaign registration requires those URLs. The candidate does not claim that
Twilio or carrier review will approve it.

## Exact candidate boundary

- The use cases are quote link, booking management, reminders, genuine operator
  follow-up, and authentication only.
- Twilio documents `LOW_VOLUME` as a lower-throughput mixed-use category and
  `MIXED` as the standard mixed-use category. `LOW_VOLUME` is recorded only as
  the launch-cost recommendation. Signed-in eligibility is now verified;
  expected volume and the signed-in campaign form remain pending before adoption.
- The five representative messages identify BluLadder Klamath, use bracketed
  variable content, and disclose HELP/STOP. Link-bearing messages declare that
  links are present; embedded phone numbers are not proposed.
- A transactional request is limited to the requested service interaction.
  Promotional messages require a separate unchecked opt-in and are not a
  condition of purchase.
- The message-flow description truthfully covers an inbound caller's explicit
  request and confirmation before a text is sent. The launch has no website
  opt-in form. Any future production surface must match this description
  exactly or the package must be revised.
- The privacy candidate explicitly protects mobile numbers, messaging opt-in
  data, and consent from sharing, sale, rent, transfer, or other provision for
  third-party marketing. It also includes frequency, rates, and HELP/STOP
  statements. The terms candidate includes the program, approved launch
  message categories, frequency/rates, HELP/STOP, support and privacy links,
  carrier, and no-condition-of-purchase statements.
- Marketing and promotional messages are outside the approved launch campaign.
  Any future marketing campaign remains behind a separate unchecked opt-in and
  separate owner, carrier, and release approval.
- Exact future URLs use the Klamath-only `/klamath` path boundary on the
  existing primary site. This avoids the hosting provider's cross-domain
  redirect while leaving every existing DFW route unchanged. They are
  candidates, not claims that those pages are published.

## Signed-in provider readiness reconciliation

A read-only signed-in inspection on 2026-08-15 uniquely matched the intended
business boundary and confirmed an approved compliance profile, approved
low-volume-standard brand, and eligibility for the recommended low-volume use
case. Suitable Oregon local voice/SMS/MMS inventory was also present.

The existing approved campaign is not a Klamath shortcut: its branding,
opt-in origin, privacy/terms origins, consent copy, and assigned sender region
do not match this exact candidate. Repository evidence therefore authorizes no
reuse. A separately reviewed Klamath campaign path remains required after the
owner-directed public-surface gates pass. The sanitized provider snapshot is
`docs/operations/bluladder-klamath-twilio-readiness.json`; it contains no
provider identifier, phone digits, credential, message, or customer data.

## Review and provider boundary

A protected copy of the template may reach only
`eligible_for_twilio_campaign_submission_review` after:

1. bounded owner direction for the exact campaign and consent copy;
2. read-only proof that the exact opt-in, privacy, terms, and support surfaces
   are publicly reachable; and
3. signed-in proof that the intended business boundary is eligible for the
   recommended use-case category (completed read-only on 2026-08-15); and
4. exact contract-test evidence.

The evaluator still returns `activationAllowed: false`. Twilio business and
campaign approval, number selection, sender assignment, credentials,
connector insertion, deployment, controlled QA, and the final signed launch
review remain independent gates.

## Release reconciliation

The owner-approved canonical bundle was merged through PR #188 at
`436837df91b0cfad6ad7f72506c088f313110db2`. Exact-head CI and Secret Scan
passed, the four exact path surfaces were published and verified, and the DFW
boundary remained unchanged. A separate Klamath Messaging Service and bounded
campaign were then created and submitted. The sanitized provider state is
`in_review`; carrier approval is not claimed.

No Klamath number was selected, reserved, purchased, or assigned. No message or
call was sent, and messaging runtime, customer traffic, and tenant activation
remain disabled. The release receipt records provider-resource presence and
status only and contains no provider identifier, phone digits, or credential.

## Current production safety

This package adds only a fail-closed path-based compliance presentation. Klamath remains
provisioning, runtime-routing-disabled, messaging-runtime-disabled,
customer-traffic-disabled, and unable to activate. No Twilio resource,
credential, sender assignment, phone number, message, call, hosted row, or
provider runtime is created by the repository package.
