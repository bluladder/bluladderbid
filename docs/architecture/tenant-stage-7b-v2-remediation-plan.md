# Stage 7B v2 production preparation plan

Status: review-only. Every SQL block below is a template. Nothing in this plan
has been executed. Production row selection, mutation, migration application,
provider mapping, and deployment each require separate approval.

## Current aggregate evidence

The independent release review reconfirmed:

- one quote row has `organization_id IS NULL`;
- one quote/customer mismatch is reported;
- the migration stop predicate matches one quote row, so the two signals may
  describe the same row;
- bookings have zero null ownership and zero stop-gate matches;
- `quote_sessions`: 20 total, 0 with one authority, 20 unresolved, 0 conflicts;
- `chat_conversations`: 32 total, 2 with one authority, 30 unresolved,
  0 conflicts;
- zero organization-resolution keys are configured; and
- neither second-wave table has an `organization_id` column.

No operational identifier or customer row was selected to obtain this evidence.

## Approval evidence for quote remediation

Ben must approve an immutable remediation record containing all of the
following before an operator selects or changes the row:

1. the exact quote, customer, and property identifiers;
2. quote ownership before the change;
3. customer and property ownership from the database;
4. trusted provider lineage, if any, tied to the same customer/property;
5. evidence that customer and property lineage agree, or an explicit block if
   they do not;
6. the proposed organization identifier and why it is authoritative;
7. confirmation that the organization is active;
8. operator, reviewer, approval timestamp, ticket/decision reference, and a
   rollback owner; and
9. a captured pre-change aggregate and row snapshot stored outside the
   production database.

The existence of only one active organization is not evidence. DFW must never
be selected merely because it is the only configured tenant.

## Approved evidence query template

Run only after Ben approves the exact `approved_quote_id`. This query is
read-only but intentionally reveals one operational lineage record to the
authorized operator.

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT
  q.id AS quote_id,
  q.organization_id AS quote_organization_id,
  q.customer_id,
  c.organization_id AS customer_organization_id,
  q.property_id,
  p.organization_id AS property_organization_id,
  qo.status AS quote_organization_status,
  co.status AS customer_organization_status,
  po.status AS property_organization_status
FROM public.quotes q
LEFT JOIN public.customers c ON c.id = q.customer_id
LEFT JOIN public.properties p ON p.id = q.property_id
LEFT JOIN public.organizations qo ON qo.id = q.organization_id
LEFT JOIN public.organizations co ON co.id = c.organization_id
LEFT JOIN public.organizations po ON po.id = p.organization_id
WHERE q.id = :'approved_quote_id'::uuid;

ROLLBACK;
```

Stop if the row is absent, either parent points to a different organization,
the proposed organization is inactive, or provider/customer/property evidence
does not converge on exactly one organization.

## Remediation transaction template

This template is deliberately fail-closed and ends in `ROLLBACK`. An approved
operator may replace only the final `ROLLBACK` with `COMMIT` after the returned
row and aggregate verification match the signed remediation record.

```sql
\set ON_ERROR_STOP on
BEGIN;

WITH evidence AS (
  SELECT
    q.id,
    q.customer_id,
    q.property_id,
    q.organization_id AS prior_organization_id,
    c.organization_id AS customer_organization_id,
    p.organization_id AS property_organization_id,
    CASE
      WHEN c.organization_id IS NOT NULL
       AND (p.organization_id IS NULL
            OR p.organization_id = c.organization_id)
        THEN c.organization_id
      WHEN c.organization_id IS NULL
       AND p.organization_id IS NOT NULL
        THEN p.organization_id
      ELSE NULL
    END AS derived_organization_id
  FROM public.quotes q
  LEFT JOIN public.customers c ON c.id = q.customer_id
  LEFT JOIN public.properties p ON p.id = q.property_id
  WHERE q.id = :'approved_quote_id'::uuid
  FOR UPDATE OF q
), updated AS (
  UPDATE public.quotes q
  SET organization_id = e.derived_organization_id
  FROM evidence e
  JOIN public.organizations o
    ON o.id = e.derived_organization_id AND o.status = 'active'
  WHERE q.id = e.id
    AND q.organization_id IS NULL
    AND e.customer_id = :'approved_customer_id'::uuid
    AND e.property_id IS NOT DISTINCT FROM
      nullif(:'approved_property_id', '')::uuid
    AND e.derived_organization_id = :'approved_organization_id'::uuid
  RETURNING q.id, q.organization_id, q.customer_id, q.property_id
)
SELECT * FROM updated;

-- Must return exactly zero before commit.
SELECT count(*) AS remaining_first_wave_quote_stop_gate_rows
FROM public.quotes q
LEFT JOIN public.customers c ON c.id = q.customer_id
LEFT JOIN public.properties p ON p.id = q.property_id
CROSS JOIN LATERAL (
  SELECT count(DISTINCT candidate) AS organization_count
  FROM unnest(ARRAY[
    q.organization_id, c.organization_id, p.organization_id
  ]) candidate
  WHERE candidate IS NOT NULL
) evidence
WHERE evidence.organization_count > 1
   OR (q.customer_id IS NOT NULL AND c.organization_id IS NULL)
   OR (q.property_id IS NOT NULL AND p.organization_id IS NULL)
   OR (
     q.organization_id IS NULL
     AND (c.organization_id IS NOT NULL OR p.organization_id IS NOT NULL)
   );

ROLLBACK;
```

If the `updated` CTE returns zero rows, do not broaden its predicates. Re-open
the evidence review.

## Rollback template

The external remediation record must retain the prior value. For the currently
reported null-ownership case, rollback is permitted only when the quote still
has the approved organization and its customer/property links have not changed.
This template also ends in `ROLLBACK` by default.

```sql
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.quotes
SET organization_id = NULL
WHERE id = :'approved_quote_id'::uuid
  AND organization_id = :'approved_organization_id'::uuid
  AND customer_id = :'approved_customer_id'::uuid
  AND property_id IS NOT DISTINCT FROM
    nullif(:'approved_property_id', '')::uuid
RETURNING id, organization_id, customer_id, property_id;

ROLLBACK;
```

Rollback is not an alternative ownership guess. If the prior value was not
null, use the exact captured prior value and obtain new approval.

## Provider and site resolution preparation

No mapping may be created until the schema migration is applied and verified.
The later runtime needs these trusted identifiers, as applicable:

- Vapi assistant ID → `vapi_assistant`;
- Vapi phone-number resource ID → `vapi_phone_number`;
- CallRail tracking-number resource ID → `callrail_number`;
- Jobber account identifier → `jobber_account`;
- canonical application hostname → `hostname`;
- trusted site or campaign identifier → `site`;
- trusted embed identifier → `embed`; and
- permitted territory → a separately verified territory rule, not a caller-
  supplied organization ID.

Do not configure ordinary customer email or caller ANI as tenant authority.
`email_address` exists in the historical key vocabulary but requires a separate
owner decision and a trusted provider-owned mailbox use case before activation.

Safest later process:

1. Two reviewers inventory identifiers in the provider dashboards without
   copying raw values into tickets, source control, chat, or logs.
2. Normalize at the controlled boundary: trim all values; lowercase hostnames
   and remove a port/trailing dot; retain provider resource IDs exactly after
   trimming.
3. Compute lowercase SHA-256 hex locally in the approved operator environment.
4. Compare `(key_type, key_hash)` against existing rows and stop on any mapping
   to a different organization.
5. Insert only the hash, approved organization, `active` status, and non-secret
   audit metadata in one reviewed transaction. Never upsert across an existing
   organization.
6. Verify each expected key resolves to exactly one active organization and
   that unknown, duplicated, inactive, and conflicting evidence fails closed.
7. Keep existing-quote, memo, reschedule, cancellation, availability, and
   booking gates closed until provider mapping and runtime deployment are both
   independently verified.

Aggregate verification may report counts by `key_type`; it must not return raw
provider values or hashes in general release logs.

## Release boundary

The required order is:

1. merge schema preparation;
2. approve and perform the narrow quote remediation;
3. re-run aggregate gates;
4. apply and verify the migration;
5. approve and configure hashed provider/site mappings;
6. merge the dependent runtime-consumption PR; and
7. explicitly deploy and smoke-test under a separate production authorization.

Reordering steps 2–6 is blocked.
