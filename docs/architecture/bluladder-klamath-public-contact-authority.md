# BluLadder Klamath public contact publication authority

Status: **repository-only, dormant, stacked on draft PR #177**. The migration
is not applied, no contact value exists, no function/frontend bundle from this
stack is deployed, and all publication and customer-traffic gates remain
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

The repository includes unchanged read-only preflight and postflight SQL. A
future hosted application requires separate authorization, exact migration-
ledger reconciliation, a transactionally applied migration, postflight, and
unchanged DFW/Klamath fingerprints. This PR does not authorize that action.

## Remaining gates

1. Draft PR #177 must be reviewed and merged first, then this stack must be
   rebased/retargeted and independently reviewed.
2. Exact owner-approved Klamath phone/email content and channel choice are
   still missing.
3. Contact ownership and reachability must be verified without exposing the
   value in review artifacts.
4. The migration, function, and frontend require separately authorized hosted
   application/deployment only after exact-head checks and migration preflight.
5. Legal/compliance copy, DNS/TLS, site lifecycle, public acceptance, and all
   customer-runtime activation gates remain separate and blocked.

No hosted mutation, deployment, DNS action, provider change, credential
action, purchase, call, message, customer traffic, or Lovable credit is part of
this repository stage.
