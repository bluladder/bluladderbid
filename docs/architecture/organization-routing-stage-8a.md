# Organization routing contract — Stage 8A

Status: repository foundation only. The migration is not authorized for hosted
Supabase, no runtime entry point consumes these tables yet, and the Oregon
fixture must remain inactive.

## Data ownership

`organization_settings`, `organization_contacts`,
`organization_territories`, and `organization_services` are authoritative,
organization-owned records. Every row has an explicit `organization_id`.
Authenticated members may read only their organizations. Only active owners
and admins may mutate them. Service-role access is reserved for trusted
server-side code and must never be exposed to a client.

DFW uses organization ID `b1addf00-0000-4000-8000-000000000001`. Oregon test
data uses `b1addf00-0000-4000-8000-000000000002`, organization status
`provisioning`, and inactive territory/service/contact records. The migration
does not create active DFW territory rules: current production behavior stays
unchanged until an independently authorized data and runtime-adoption stage.

## Territory routing

Routing accepts normalized country, state, county, city, and five-digit ZIP
plus the complete active rule set. A rule may include state, county, city, ZIP,
or any supported combination and has:

- `effect`: `include` or `exclude`
- `priority`: higher values win
- `status`: only `active` rules participate
- organization lifecycle status: only `active` organizations may receive work

Rules first match every populated geographic field. Matching active-
organization rules are ranked by priority, then specificity (ZIP, city,
county, state). At the winning rank:

- an include routes to exactly one organization;
- an exclusion produces `manual_review / unknown_territory`;
- include/exclude disagreement for one organization produces
  `manual_review / conflicting_rules`;
- more than one organization produces
  `manual_review / overlapping_territory`;
- an inactive organization produces
  `manual_review / organization_inactive`;
- incomplete or unmatched geography produces `manual_review`.

There is no implicit organization and no fallback to DFW. Stable IDs only
provide deterministic ordering after semantic ties; they never break an
organization ambiguity.

## Service availability and contacts

Service availability is keyed by `(organization_id, service_key)`. Missing or
inactive configuration returns `manual_review /
organization_service_not_configured`; another organization's rule is never
reused.

Contacts are keyed by organization and type. Lowest numeric priority wins.
Missing contacts and equal-priority leaders return explicit manual-review
states. Destinations are never resolved across organizations.

## Lead tagging

The routing boundary must persist or pass the following immutable tag set:

```ts
{
  organizationId: string | null;
  region: string | null;       // matched territory name
  city: string | null;
  county: string | null;
  state: string | null;
  postalCode: string | null;
  entrySource: string;
  routingStatus: "routed" | "manual_review";
}
```

For manual review, `organizationId` and `region` are null even when candidate
organizations are reported. This prevents untrusted or ambiguous traffic from
becoming authoritative.

## Server API contract

The shared implementation in
`supabase/functions/_shared/organizationRouting.ts` is a pure server-side
domain boundary. A later authenticated Edge Function may expose:

- `POST /organization-routing/resolve`
  - request: `{ location, serviceKey?, entrySource }`
  - response: `{ route, serviceAvailability?, leadTags }`
  - unknown, conflicting, or overlapping results use HTTP 200 with explicit
    `manual_review`; malformed input uses HTTP 400.
- `GET /organizations/:organizationId/settings|contacts|territories|services`
  - active membership required and path organization must equal resolved
    organization.
- `POST|PATCH|DELETE` for those resources
  - active owner/admin required; the server supplies `organization_id` from
    trusted membership context and rejects conflicting payload IDs.

Admin mutations must use optimistic concurrency (an `updated_at` precondition)
when implemented. Bulk territory activation must validate overlaps before
commit. Runtime handlers, generated database types, and owner-portal screens
are intentionally deferred until the hosted migration and type regeneration
are separately authorized.

## Compatibility and unresolved decisions

- DFW locale/timezone settings are seeded idempotently, but no DFW contact,
  territory, or service record is guessed.
- Oregon is schema/test data only and cannot route while `provisioning` and
  inactive.
- County naming depends on a future authoritative geocoder. Until chosen,
  callers must provide already-normalized county names.
- Priority governance and who may activate a territory require an owner-portal
  product decision. Database access is currently owner/admin.
- A future stage must decide whether service keys reference a catalog table.
  Stage 8A uses stable text keys to stay additive and backward compatible.

