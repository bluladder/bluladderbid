# BluLadder Klamath messaging compliance review contract

Status: **repository-only candidate; owner, legal, and public-surface review
pending; provider and runtime unchanged**. This package cannot publish a page,
register a campaign, provision a number, send a message, enable customer
traffic, or activate Klamath.

## Purpose

Issue #151 approves the five intended SMS use cases at a business-policy level,
but exact public opt-in, privacy, terms, HELP/STOP, and representative campaign
copy still need bounded review. The safe template is
`docs/operations/bluladder-klamath-messaging-compliance-review.template.json`.
It freezes one exact candidate while leaving owner approval, legal review,
public-surface verification, and contract-test evidence pending.

The requirements were reconciled on 2026-08-14 against Twilio's official
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
  expected volume and owner review remain pending before adoption.
- The five representative messages identify BluLadder Klamath, use bracketed
  variable content, and disclose HELP/STOP. Link-bearing messages declare that
  links are present; embedded phone numbers are not proposed.
- A transactional request is limited to the requested service interaction.
  Promotional messages require a separate unchecked opt-in and are not a
  condition of purchase.
- The message-flow description covers both a visible website request and an
  inbound caller's explicit request for a one-time link. Any future production
  surface must match this description exactly or the package must be revised.
- The privacy candidate includes mobile-information non-sharing, frequency,
  rates, and HELP/STOP statements. The terms candidate includes the program,
  message categories, frequency/rates, HELP/STOP, carrier, and
  no-condition-of-purchase statements.
- Exact future URLs use the already-approved canonical Klamath hostname. They
  are candidates, not claims that those pages are published.

## Signed-in provider readiness reconciliation

A read-only signed-in inspection on 2026-08-15 uniquely matched the intended
business boundary and confirmed an approved compliance profile, approved
low-volume-standard brand, and eligibility for the recommended low-volume use
case. Suitable Oregon local voice/SMS/MMS inventory was also present.

The existing approved campaign is not a Klamath shortcut: its branding,
opt-in origin, privacy/terms origins, consent copy, and assigned sender region
do not match this exact candidate. Repository evidence therefore authorizes no
reuse. A separately reviewed Klamath campaign path remains required after the
owner, legal, and public-surface gates pass. The sanitized provider snapshot is
`docs/operations/bluladder-klamath-twilio-readiness.json`; it contains no
provider identifier, phone digits, credential, message, or customer data.

## Review and provider boundary

A protected copy of the template may reach only
`eligible_for_twilio_campaign_submission_review` after:

1. bounded owner approval of the exact campaign and consent copy;
2. qualified legal/compliance review of the exact privacy and terms language;
3. read-only proof that the exact opt-in, privacy, terms, and support surfaces
   are publicly reachable; and
4. signed-in proof that the intended business boundary is eligible for the
   recommended use-case category (completed read-only on 2026-08-15); and
5. exact contract-test evidence.

The evaluator still returns `activationAllowed: false`. Twilio business and
campaign review, Messaging Service creation, number selection, credentials,
connector insertion, deployment, controlled QA, and the final signed launch
review remain independent gates.

## Current production safety

This package changes no source implementation or public page. Klamath remains
provisioning, unpublished, runtime-routing-disabled, messaging-runtime-disabled,
customer-traffic-disabled, and unable to activate. No Twilio resource,
credential, sender, Messaging Service, A2P campaign, phone number, message,
call, hosted row, deployment, or Lovable action is created.
