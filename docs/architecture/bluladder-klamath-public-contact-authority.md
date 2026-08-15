# BluLadder Klamath public contact publication authority

Status: **schema applied and resolver deployed; publication still dormant**.
The reviewed migration is recorded once in the hosted ledger through its
Lovable-generated execution receipt, the `public-site-bootstrap` function is
deployed, and read-only postflight passed. No public contact value exists, the
frontend and site are unpublished, and all customer-traffic gates remain
closed.

## Purpose

The established `organization_contacts` table is an internal operations
registry for escalation, notification, and manager destinations. None of those
rows is public-display authority. This stage creates a separate
`organization_public_contacts` table so internal destinations can never become
public through a type alias, fallback, first-row selection, or presentation
default.

No contact is seeded. A future owner-approved insertion must provide a
normalized phone or email, an owner-approval reference represented only by its
SHA-256 digest, independent verification and approval timestamps, a positive
configuration version, and `published` status. The database permits at most
one published contact per organization and channel.

## Access boundary

The table is in the exposed `public` schema, so the migration uses both
Postgres grants and RLS:

- `anon` and `PUBLIC` receive no table privileges;
- active organization operators may read only their organization's rows;
- active organization owners/admins may manage only their organization's rows;
- `service_role` retains server-only access; and
- all policy predicates use persisted membership rows and `(select auth.uid())`.

The server resolver runs only after exact HTTPS Origin, active organization,
active site mapping, runtime-routing, and site-publication authority have
already passed. It reads only `published` rows for that organization, caps the
result at three to detect drift, revalidates every publication proof and
destination, rejects duplicate channels, and returns only channel, public
label, and public value. Database IDs, approval hashes/timestamps, memberships,
internal contacts, providers, and credentials are never returned.

Missing schema, missing rows, draft/retired rows, malformed values, cross-
organization rows, duplicate channels, invalid provenance, or query errors all
produce `publicContactReady: false` and an empty public contact set. The contact
page therefore remains the existing unavailable notice until a separately
reviewed hosted release supplies one exact approved row.

## Migration and verification

The additive migration:

- creates exactly one empty table and two indexes;
- enables RLS and creates exactly two organization-scoped policies;
- normalizes hosted default grants to exact least privilege;
- locks and validates the established DFW/Klamath authority rows before DDL;
- performs no `INSERT`, `UPDATE`, or `DELETE`; and
- neither changes nor activates any organization, site, provider, customer,
  pricing, territory, service, connector, contact, or traffic state.

The repository includes unchanged read-only preflight and postflight SQL. The
authorized hosted application used the exact reviewed payload with only the
provider's terminal-LF normalization. The ledger advanced once, postflight
proved the exact grants/RLS/policies and zero rows, and all captured DFW
fingerprints remained unchanged. The sanitized record is
`docs/operations/bluladder-klamath-public-contact-hosted-evidence.json`.

## Remaining gates

1. Exact owner-approved Klamath phone/email content and channel choice are
   still missing.
2. Contact ownership and reachability must be verified without exposing the
   value in review artifacts.
3. The frontend remains unpublished and requires separate exact-head release
   authorization after contact and compliance approval.
4. Legal/compliance copy, DNS/TLS, site lifecycle, public acceptance, and all
   customer-runtime activation gates remain separate and blocked.

The completed hosted action created only the empty table/ledger receipt and
deployed only the fail-closed bootstrap function. It did not publish the
frontend, modify DNS/providers/credentials, purchase anything, create a public
contact, call, message, or allow customer traffic.
