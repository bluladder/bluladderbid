# Customer Intelligence Phase 3

## Purpose

Turn operational history into explainable, advisory customer recommendations that improve as outcomes accumulate.

The learning capability is part of the data model and scoring pipeline, not an optional prompt convention. Every recommendation stores its point-in-time feature snapshot, model version, score, confidence, reason codes, evidence, and eventual outcome.

## Current managed-data baseline

Managed Lovable Cloud inspection on 2026-07-27 found:

| Object | Records | Earliest | Latest |
|---|---:|---|---|
| Customers | 16 | 2026-01-26 | 2026-07-15 |
| Bookings | 2 | 2026-07-22 | 2026-07-23 |
| Quotes | 2 | 2026-07-22 | 2026-07-22 |
| Jobber busy blocks | 545 | 2026-01-27 | 2026-07-27 |
| Jobber webhook events | 5,230 | 2026-01-27 | 2026-07-25 |

The local customer, quote, and booking tables are not yet a sufficient historical training corpus. Jobber historical records and retained webhook payloads should therefore seed the initial timeline and feature store.

## Learning contract

1. Owner-configured business rules remain authoritative.
2. Recommendations are advisory by default.
3. Learning can propose bounded weight changes only after minimum evidence thresholds.
4. Each model update creates a new version and preserves its parent.
5. No model version activates silently.
6. Complaint, damage, refund, legal, and safety events suppress normal sales recommendations.
7. Point-in-time snapshots prevent future-data leakage.
8. Dedupe keys make backfills and incremental updates idempotent.
9. Sparse histories use conservative service-cadence priors.
10. Every recommendation must be reproducible from stored evidence.

## Historical Jobber backfill order

1. Clients and properties
2. Jobs and visits
3. Quotes
4. Invoices and payments
5. Notes and tags where supported
6. Webhook payload reconciliation

Each provider record becomes a normalized `customer_timeline_events` row. Source payloads remain available for audit, but feature calculations use normalized fields.

## Initial feature groups

- Monetary: lifetime value, average ticket, completed revenue.
- Frequency: completed jobs, quotes, bookings, cancellations.
- Recency: last completed service and last quote.
- Service history: count, last completion, inferred cadence per service.
- Customer behavior: preferred channel, cancellation tendency, response history.
- Context: city, season, property traits, source attribution.
- Safety: recent complaint, damage, refund, legal, or safety escalation.
- Data quality: event count, coverage period, sparse-history indicator.

## Baseline recommendation model

The first model is deterministic and explainable. It combines:

- service due/overdue ratio;
- prior purchase of the service;
- conservative cross-sell gaps;
- seasonal fit;
- repeat-customer status;
- recent cancellation penalty;
- strong sensitive-event suppression.

Empirical outcomes later adjust bounded weights. A single run cannot move any weight more than the configured maximum delta or outside the configured global bounds.

## Next implementation slice

- Jobber historical importer and cursor persistence.
- Timeline normalization for existing bookings, quotes, and webhook events.
- Feature recomputation edge function.
- Recommendation persistence API.
- Admin customer timeline and recommendation-explanation UI.
- Outcome capture from bookings, cancellations, completions, and owner actions.
