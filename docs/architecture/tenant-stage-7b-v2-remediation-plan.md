# Stage 7B v2 production preparation plan

Status: review-only, post-merge evidence captured 2026-08-01. The targeted
`SELECT` investigation described below was executed through the Lovable-managed
database connection. No mutation block in this document has been executed.
Production mutation, migration application, provider mapping, and deployment
each require separate approval.

## Current aggregate evidence

The independent release review reconfirmed:

- one quote row has `organization_id IS NULL`;
- one quote/customer mismatch is reported;
- the migration stop predicate matches one quote row; the targeted review
  confirmed that the null and mismatch signals describe that same row;
- bookings have zero null ownership and zero stop-gate matches;
- `quote_sessions`: 20 total, 0 with one authority, 20 unresolved, 0 conflicts;
- `chat_conversations`: 33 total, 2 with one authority, 31 unresolved,
  0 conflicts;
- zero organization-resolution keys are configured; and
- neither second-wave table has an `organization_id` column.

The initial release review obtained those findings without selecting an
operational row. The authorized post-merge investigation subsequently selected
only the identifiers, organization lineage, lifecycle timestamps/statuses, and
boolean provider-link indicators needed to evaluate the single stop-gate row.
It did not select names, addresses, phone numbers, email addresses, messages,
notes, or raw provider identifiers.

## Exact affected lineage

The one stop-gate row is:

| Record | Identifier | Current organization | Relationship |
|---|---|---|---|
| Quote | `9b55aaa5-1a98-462a-9d71-edc2ea128e03` | null | Target row |
| Customer | `c867029e-2d5a-498f-9226-32533c5a1665` | `b1addf00-0000-4000-8000-000000000001` | Quote parent |
| Property | null | null | The quote has no property parent |

This is one null-versus-scoped parent defect, not two independent defects and
not evidence that the quote points to the wrong customer or property. The
customer organization is active and is the explicitly designated legacy DFW
organization. The customer predates the tenant migration. The organization was
created at `2026-07-30 07:25:08.546983+00`; the target quote was created later
at `2026-07-30 14:16:11.172686+00`, while the then-current trigger still allowed
a null-owned quote to reference a scoped customer.

Corroborating non-PII evidence for the same customer is one earlier scoped
quote, one scoped property used by that earlier quote, and two scoped,
non-test Jobber-backed bookings. All carry
`b1addf00-0000-4000-8000-000000000001`; no non-null organization conflicts.
The customer's Jobber client identifier is unique among customer rows, but no
`jobber_account` organization-resolution key exists, so the provider identifier
is corroboration rather than an independent tenant resolver. The target quote
has no booking, contact request, quote session, chat conversation, campaign
enrollment, Jobber quote identifier, CallRail mapping, or attribution-event
row. It has processed quote lifecycle events, an accepted transactional email,
suppressed SMS, and resume tokens. Those records establish activity, not tenant
authority.

The target is a saved, unexpired, unconverted, non-superseded quote with an
abandonment marker and later view activity. It is not explicitly flagged as a
test. Its referrer host was `lovable.dev`, which is a development/editor signal,
but the parent is an older Jobber-linked customer with non-test bookings. Treat
the row as operational unless Ben separately classifies it as a test; that
classification does not change the tenant-lineage result.

The quote has no supersession or other duplicate marker. One different
customer row shares the normalized phone value, while the normalized email and
Jobber client identifier are unique. A shared phone is neither sufficient to
classify the customer as a duplicate nor tenant authority, so it is excluded
from the remediation decision.

A read-only hypothetical overlay that assigned only the target quote to the
customer's organization produced zero quote stop-gate rows, zero booking
stop-gate rows, zero quote-session parent conflicts, and zero conversation
parent conflicts. This establishes migration eligibility after the approved
write only if the same four checks are re-run and remain zero immediately
before migration application.

## Approval evidence for quote remediation

Ben must approve an immutable remediation record containing all of the
following before an operator changes the row:

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

## Exact review-only remediation transaction

This transaction is deliberately fail-closed, locks every mutable authority
row, asserts the exact reviewed state, affects exactly one quote, and ends in
`ROLLBACK`. It is review evidence, not authorization to execute. After Ben's
approval, an authorized operator must re-run the read-only snapshot, compare it
with the signed audit record, and replace only the final `ROLLBACK` with
`COMMIT` in a separately controlled execution copy.

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Lock the exact child, parent, and intended organization. If any SELECT
-- returns zero rows, stop before the mutation block.
SELECT id, organization_id, customer_id, property_id, status, updated_at,
       converted_booking_id, converted_at, superseded_by, declined_at
FROM public.quotes
WHERE id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid
FOR UPDATE;

SELECT id, organization_id, created_at, updated_at
FROM public.customers
WHERE id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
FOR UPDATE;

SELECT id, status, is_legacy_default, created_at, updated_at
FROM public.organizations
WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
FOR SHARE;

-- PII-free before-state snapshot for the external audit record.
SELECT jsonb_build_object(
  'quote_id', q.id,
  'quote_organization_id', q.organization_id,
  'customer_id', q.customer_id,
  'customer_organization_id', c.organization_id,
  'property_id', q.property_id,
  'quote_status', q.status::text,
  'quote_updated_at', q.updated_at,
  'organization_status', o.status,
  'organization_is_legacy_default', o.is_legacy_default
) AS before_state
FROM public.quotes q
JOIN public.customers c ON c.id = q.customer_id
JOIN public.organizations o ON o.id = c.organization_id
WHERE q.id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid;

-- Trusted-lineage review. No raw Jobber identifiers are selected.
SELECT
  count(*) FILTER (
    WHERE q.organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
  )::int AS matching_other_quotes,
  count(*) FILTER (
    WHERE q.organization_id IS NOT NULL
      AND q.organization_id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
  )::int AS conflicting_other_quotes
FROM public.quotes q
WHERE q.customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
  AND q.id <> '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid;

SELECT
  count(*) FILTER (
    WHERE b.organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
  )::int AS matching_bookings,
  count(*) FILTER (
    WHERE b.organization_id IS NOT NULL
      AND b.organization_id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
  )::int AS conflicting_bookings,
  count(*) FILTER (
    WHERE NOT b.is_test_fixture
      AND b.jobber_job_id IS NOT NULL
      AND b.jobber_visit_id IS NOT NULL
  )::int AS non_test_jobber_backed_bookings
FROM public.bookings b
WHERE b.customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid;

-- Lock the corroborating rows after displaying the PII-free counts above.
SELECT id, organization_id, status, property_id
FROM public.quotes
WHERE customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
  AND id <> '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid
FOR SHARE;

SELECT id, organization_id, status, property_id, is_test_fixture,
       (jobber_job_id IS NOT NULL) AS has_jobber_job_id,
       (jobber_visit_id IS NOT NULL) AS has_jobber_visit_id
FROM public.bookings
WHERE customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
FOR SHARE;

DO $$
DECLARE
  target_quote public.quotes%ROWTYPE;
  target_customer public.customers%ROWTYPE;
  target_organization public.organizations%ROWTYPE;
  affected integer;
BEGIN
  SELECT * INTO STRICT target_quote
  FROM public.quotes
  WHERE id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid;

  SELECT * INTO STRICT target_customer
  FROM public.customers
  WHERE id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid;

  SELECT * INTO STRICT target_organization
  FROM public.organizations
  WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid;

  IF target_quote.organization_id IS NOT NULL
     OR target_quote.customer_id IS DISTINCT FROM
       'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
     OR target_quote.property_id IS NOT NULL
     OR target_quote.status::text <> 'saved'
     OR target_quote.updated_at IS DISTINCT FROM
       '2026-07-30 19:08:49.788811+00'::timestamptz
     OR target_quote.converted_booking_id IS NOT NULL
     OR target_quote.converted_at IS NOT NULL
     OR target_quote.superseded_by IS NOT NULL
     OR target_quote.declined_at IS NOT NULL THEN
    RAISE EXCEPTION 'approved quote state changed; repeat evidence review';
  END IF;

  IF target_customer.organization_id IS DISTINCT FROM
       'b1addf00-0000-4000-8000-000000000001'::uuid
     OR target_customer.created_at IS DISTINCT FROM
       '2026-01-26 05:50:18.855363+00'::timestamptz THEN
    RAISE EXCEPTION 'approved customer lineage changed; repeat evidence review';
  END IF;

  IF target_organization.status <> 'active'
     OR NOT target_organization.is_legacy_default THEN
    RAISE EXCEPTION 'approved organization is not active legacy authority';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.quotes q
       WHERE q.customer_id = target_customer.id
         AND q.id <> target_quote.id
         AND q.organization_id IS NOT NULL
         AND q.organization_id <>
           'b1addf00-0000-4000-8000-000000000001'::uuid
     )
     OR EXISTS (
       SELECT 1 FROM public.bookings b
       WHERE b.customer_id = target_customer.id
         AND b.organization_id IS NOT NULL
         AND b.organization_id <>
           'b1addf00-0000-4000-8000-000000000001'::uuid
     ) THEN
    RAISE EXCEPTION 'corroborating historical organization conflict';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.quotes q
       WHERE q.customer_id = target_customer.id
         AND q.id <> target_quote.id
         AND q.organization_id =
           'b1addf00-0000-4000-8000-000000000001'::uuid
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.bookings b
       WHERE b.customer_id = target_customer.id
         AND b.organization_id =
           'b1addf00-0000-4000-8000-000000000001'::uuid
         AND NOT b.is_test_fixture
         AND b.jobber_job_id IS NOT NULL
         AND b.jobber_visit_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'approved corroborating lineage is no longer present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.properties
    WHERE id = target_quote.property_id
  ) THEN
    RAISE EXCEPTION 'unexpected property parent; repeat evidence review';
  END IF;

  UPDATE public.quotes
  SET organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
  WHERE id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid
    AND organization_id IS NULL
    AND customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
    AND property_id IS NULL
    AND status::text = 'saved'
    AND updated_at = '2026-07-30 19:08:49.788811+00'::timestamptz;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'expected exactly one remediated quote, got %', affected;
  END IF;
END
$$;

-- Must return exactly the approved post-state.
SELECT id, organization_id, customer_id, property_id, status, updated_at
FROM public.quotes
WHERE id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid
  AND organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
  AND customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
  AND property_id IS NULL;

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

-- Must return exactly zero before commit.
SELECT count(*) AS remaining_first_wave_booking_stop_gate_rows
FROM public.bookings b
LEFT JOIN public.customers c ON c.id = b.customer_id
LEFT JOIN public.properties p ON p.id = b.property_id
CROSS JOIN LATERAL (
  SELECT count(DISTINCT candidate) AS organization_count
  FROM unnest(ARRAY[
    b.organization_id, c.organization_id, p.organization_id
  ]) candidate
  WHERE candidate IS NOT NULL
) evidence
WHERE evidence.organization_count > 1
   OR (b.customer_id IS NOT NULL AND c.organization_id IS NULL)
   OR (b.property_id IS NOT NULL AND p.organization_id IS NULL)
   OR (
     b.organization_id IS NULL
     AND (c.organization_id IS NOT NULL OR p.organization_id IS NOT NULL)
   );

-- Pre-migration second-wave conflicts. Unresolved zero-authority rows are
-- permitted to remain null; only multiple parent organizations block.
SELECT count(*) AS quote_session_parent_conflicts
FROM public.quote_sessions qs
LEFT JOIN public.customers c ON c.id = qs.customer_id
LEFT JOIN public.properties p ON p.id = qs.property_id
LEFT JOIN public.quotes q ON q.id = qs.quote_id
CROSS JOIN LATERAL (
  SELECT count(DISTINCT candidate) AS organization_count
  FROM unnest(ARRAY[
    c.organization_id, p.organization_id, q.organization_id
  ]) candidate
  WHERE candidate IS NOT NULL
) evidence
WHERE evidence.organization_count > 1;

SELECT count(*) AS conversation_parent_conflicts
FROM public.chat_conversations cc
LEFT JOIN public.customers c ON c.id = cc.customer_id
LEFT JOIN public.customers confirmed
  ON confirmed.id = cc.confirmed_email_customer_id
LEFT JOIN public.properties p ON p.id = cc.property_id
LEFT JOIN public.quote_sessions qs ON qs.id = cc.quote_session_id
LEFT JOIN public.customers qsc ON qsc.id = qs.customer_id
LEFT JOIN public.properties qsp ON qsp.id = qs.property_id
LEFT JOIN public.quotes qsq ON qsq.id = qs.quote_id
CROSS JOIN LATERAL (
  SELECT count(DISTINCT candidate) AS organization_count
  FROM unnest(ARRAY[
    c.organization_id, confirmed.organization_id, p.organization_id,
    qsc.organization_id, qsp.organization_id, qsq.organization_id
  ]) candidate
  WHERE candidate IS NOT NULL
) evidence
WHERE evidence.organization_count > 1;

ROLLBACK;
```

The two lineage queries must report zero conflicts. The final quote query must
return exactly one row, and the aggregate stop gate must return zero. Do not
broaden any predicate after a zero-row result, timeout, serialization failure,
or changed timestamp; repeat the evidence review instead.

## Review-only rollback transaction

The external remediation record must retain the prior value. For the currently
reported null-ownership case, rollback is permitted only when the quote still
has the approved organization and its customer/property links have not changed.
This template also ends in `ROLLBACK`. It deliberately requires the committed
remediation timestamp from the signed audit record; that value cannot be known
before an approved remediation commit occurs.

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Replace only from the signed post-remediation audit record.
\set approved_remediation_updated_at 'REQUIRED_FROM_SIGNED_AUDIT_RECORD'

SELECT id, organization_id, customer_id, property_id, status, updated_at
FROM public.quotes
WHERE id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid
FOR UPDATE;

SELECT id, organization_id
FROM public.customers
WHERE id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
FOR UPDATE;

WITH reverted AS (
  UPDATE public.quotes q
  SET organization_id = NULL
  WHERE q.id = '9b55aaa5-1a98-462a-9d71-edc2ea128e03'::uuid
    AND q.organization_id = 'b1addf00-0000-4000-8000-000000000001'::uuid
    AND q.customer_id = 'c867029e-2d5a-498f-9226-32533c5a1665'::uuid
    AND q.property_id IS NULL
    AND q.status::text = 'saved'
    AND q.converted_booking_id IS NULL
    AND q.converted_at IS NULL
    AND q.superseded_by IS NULL
    AND q.declined_at IS NULL
    AND q.updated_at = :'approved_remediation_updated_at'::timestamptz
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = q.customer_id
        AND c.organization_id =
          'b1addf00-0000-4000-8000-000000000001'::uuid
    )
  RETURNING q.id, q.organization_id, q.customer_id, q.property_id
)
SELECT *, count(*) OVER () AS reverted_row_count
FROM reverted;

ROLLBACK;
```

The `reverted` result must contain exactly one row. A zero-row or multi-row
result is a hard stop; never weaken the predicates.

Rollback is not an alternative ownership guess. If the prior value was not
null, use the exact captured prior value and obtain new approval.

## Audit-record template

Store this record outside production and do not include PII or raw provider
identifiers:

```json
{
  "decision_id": "stage7b-v2-quote-9b55aaa5",
  "status": "pending_ben_review",
  "lovable_project_id": "b6e0d823-59c4-4b5a-afbe-182485e5458b",
  "supabase_project_ref": "gyndziiuizpgwhqwyrvn",
  "repository_main_sha": "e8709faad8663bf9d9cd903b81985e7bedcb00bf",
  "quote_id": "9b55aaa5-1a98-462a-9d71-edc2ea128e03",
  "customer_id": "c867029e-2d5a-498f-9226-32533c5a1665",
  "property_id": null,
  "before_organization_id": null,
  "approved_organization_id": "b1addf00-0000-4000-8000-000000000001",
  "authority_basis": [
    "approved_legacy_customer_backfill",
    "active_parent_organization",
    "same-customer historical quote/property/bookings",
    "no_non_null_organization_conflict"
  ],
  "non_authority_signals": [
    "caller_phone_or_email",
    "lovable_referrer",
    "unmapped_jobber_identifiers",
    "delivery_provider_identifiers"
  ],
  "before_snapshot_sha256": "REQUIRED",
  "operator": "REQUIRED",
  "reviewer": "REQUIRED",
  "ben_approval_text": "REQUIRED",
  "approval_timestamp": "REQUIRED",
  "ticket_or_decision_reference": "REQUIRED",
  "transaction_timestamp": "REQUIRED_AFTER_EXECUTION",
  "committed_quote_updated_at": "REQUIRED_AFTER_EXECUTION",
  "post_snapshot_sha256": "REQUIRED_AFTER_EXECUTION",
  "post_quote_stop_gate": 0,
  "post_booking_stop_gate": 0,
  "post_session_conflicts": 0,
  "post_conversation_conflicts": 0,
  "rollback_owner": "REQUIRED"
}
```

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
