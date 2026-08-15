# BluLadder Klamath public-site bootstrap and compliance boundary

Status: **fail-closed Edge Function deployed; frontend and site unpublished**.
The exact `public-site-bootstrap` function is active and returns unavailable
for the inactive Klamath origin while preserving the canonical DFW path. The
frontend bundle is not published, the Klamath hostname does not resolve
publicly, and every publication/customer-traffic gate remains closed.

## Purpose

The existing frontend assumes the established DFW application and includes
DFW contact fallbacks. Serving that bundle on the future Klamath hostname
without a boundary could expose the wrong tenant's contact, quote, booking,
portal, chat, messaging, and pricing paths. This package adds a fail-closed
presentation boundary before any of those components render.

The public bootstrap derives authority only from the exact HTTPS `Origin` and
server-side hosted rows. It does not accept an organization ID, tenant key,
geography, provider identifier, or contact value from the browser. Unknown,
ambiguous, malformed, inactive, runtime-disabled, or unpublished evidence
returns one generic unavailable response.

## Compliance-only mode

The hosted site model can represent a separately reviewed compliance-only
publication:

- organization active;
- mapping active;
- runtime routing enabled;
- site published;
- customer traffic still disabled.

That exact state may render only `/privacy`, `/terms`, and `/contact`. Root,
quote, booking, portal, admin, chat, message, and contact-write paths remain
blocked. A provider response that says customer traffic is allowed still does
not open the customer runtime: `customerRuntimeReady` is hard-false until a
future tenant-aware runtime release is reviewed.

The privacy and terms pages contain the existing candidate statements from the
messaging-compliance review. They are not claims of owner, legal, carrier, or
publication approval. The contact page exposes no DFW or protected value while
`publicContactReady` is false. The stacked public-contact authority candidate
can make that flag true only for a separately verified, owner-approved,
published row in the dedicated public-contact table; internal escalation and
notification contacts are never eligible.

## DFW and preview compatibility

The exact DFW production hostname continues to render the existing application
without a bootstrap read. Localhost and Lovable preview hosts preserve the
current development path. Every other host fails closed; there is no first-row,
DFW, or preview fallback for Klamath.

## Remaining release gates

Before any public presentation is published, separate review must prove:

1. exact owner approval of the messaging and compliance copy;
2. qualified legal/compliance review;
3. one protected, owner-approved, verified public contact value in the already
   applied organization-scoped authority;
4. exact hosted lifecycle, mapping, routing, and publication mutations;
5. DNS/TLS ownership for the canonical hostname;
6. publication of only the reviewed frontend commit (the function deployment
   is complete);
7. secret-free and browser acceptance of all blocked/allowed paths; and
8. a later tenant-aware customer-runtime release before quote traffic.

The completed hosted step applied only the empty public-contact schema and
deployed only this function. It did not publish the frontend, modify DNS,
enable customer traffic, activate pricing, create a provider resource, access
a secret, purchase anything, call, or message.
