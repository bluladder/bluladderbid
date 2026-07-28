# BluLadder Bid — Phases 4–7 Roadmap

## Execution contract

- Finish, validate, and merge each phase before beginning the next production branch.
- GitHub is the default engineering surface.
- Lovable is reserved for managed-database, managed-edge-function, preview, or deployment work that cannot be completed correctly through GitHub.
- Additive migrations only unless an explicitly reviewed corrective migration is required.
- No automatic customer-facing email. Gmail remains draft-only.
- Approved low-risk SMS automation must remain allowlisted, configurable, and auditable.
- Complaints, damage, refunds, legal matters, and safety issues always escalate to the owner.

## Mandatory post-phase hardening gate

After each phase, and before beginning the next phase:

1. Review the complete phase diff and integration surface for bugs, regressions, missing edge cases, security concerns, performance problems, UX friction, data-quality risks, and practical enhancements.
2. Run all relevant automated checks, including focused unit tests, repository CI, lint, typecheck, build, migration review, secret scanning, and applicable integration tests.
3. Inspect failed or flaky tests and distinguish newly introduced failures from pre-existing repository failures.
4. Fix all phase-related defects and reasonable in-scope enhancements before the phase is considered complete.
5. Perform managed-environment validation only when it cannot be done correctly through GitHub, while minimizing Lovable credit usage.
6. Record unresolved external dependencies, manual validation requirements, and deferred enhancements in the phase PR and implementation documentation.
7. Do not merge or advance to the next phase until the phase-specific hardening gate is complete.

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

## Final program-wide audit and corrective pass

After all seven phases are complete:

1. Perform a full-system review across booking, chat, SMS, voice, Jobber, CallRail, Gmail drafts, customer intelligence, recommendations, reporting, admin controls, security, observability, and recovery workflows.
2. Search for cross-phase defects, duplicated logic, inconsistent business rules, stale assumptions, broken integrations, missing audit trails, performance bottlenecks, confusing UX, and data-quality gaps.
3. Address identified bugs and reasonable high-value enhancements immediately before declaring the program complete.
4. Re-run the complete automated validation suite and all available integration checks.
5. Minimize Lovable credit use; use Lovable only where managed-environment verification or deployment is technically required.
6. Produce a final implementation report containing:
   - completed capabilities;
   - bugs and enhancements resolved during hardening;
   - remaining known limitations or external dependencies;
   - optional future additions that could materially improve the platform;
   - a manual validation checklist, including AI voice calls, chatbot quoting and booking, SMS quoting and booking, rescheduling, cancellations, human transfer, Jobber record verification, CallRail linkage, email draft review, mobile testing, permission testing, failure recovery, and production smoke tests.
