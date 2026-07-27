# BluLadder Bid — Phases 4–7 Roadmap

## Execution contract

- Finish, validate, and merge each phase before beginning the next production branch.
- GitHub is the default engineering surface.
- Lovable is reserved for managed-database, managed-edge-function, preview, or deployment work that cannot be completed correctly through GitHub.
- Additive migrations only unless an explicitly reviewed corrective migration is required.
- No automatic customer-facing email. Gmail remains draft-only.
- Approved low-risk SMS automation must remain allowlisted, configurable, and auditable.
- Complaints, damage, refunds, legal matters, and safety issues always escalate to the owner.

## Phase 4 — CallRail conversation intelligence

- Ingest calls, texts, recordings, transcripts, dispositions, tracking numbers, and campaign metadata.
- Normalize them into the customer timeline.
- Generate call summaries, intent, sentiment, service interests, objections, promises, and follow-up tasks.
- Link callers to customers conservatively and retain match confidence/evidence.
- Create Action Inbox items for unresolved commitments, high-value opportunities, and sensitive escalations.
- Never autonomously respond to sensitive calls.

## Phase 5 — Owner dashboard and reporting engine

- Morning owner brief with quotes, bookings, booked revenue, completed revenue, cancellations, overdue follow-ups, recommendations, and data-quality warnings.
- Source/city/service conversion reporting.
- Forecasts must be labeled estimates and expose supporting assumptions.
- Store metric definitions and calculation versions so reports remain reproducible.
- Distinguish posted/confirmed revenue from estimates.

## Phase 6 — Customer 360 and expanded Jobber synchronization

- Read-only historical and incremental synchronization for clients, properties, jobs, visits, quotes, invoices, payments, line items, notes, tags, attachments, technicians, and supported custom fields.
- Exclude archived Jobber clients from recommendations and model learning.
- Customer 360 profile combining operational history, conversations, recommendations, attribution, value, cadence, and risks.
- Idempotent cursor-based backfills and webhook reconciliation.
- Jobber remains the operational system of record.

## Phase 7 — Admin center and production-readiness completion

- Owner-configurable service taxonomy, cadence priors, recommendation rules, suppression rules, templates, integrations, AI policies, and model activation.
- Progressive disclosure so routine controls remain simple while advanced configuration is available.
- Full audit trail for configuration and model changes.
- End-to-end security, privacy, RLS, failure recovery, observability, and data-retention audit.
- Production smoke testing and runbooks.
- No model or automation activation without an explicit owner-controlled state change.
