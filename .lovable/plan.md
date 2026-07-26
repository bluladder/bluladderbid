# Customer Intelligence + Admin Portal — Staged Plan

## Reality check

The scope you sent spans 11 major systems (admin shell, action inbox, knowledge-gap automation, lead attribution end-to-end, CallRail intelligence + webhooks, missed-call/promise tracking, Gmail assistant with OAuth, KPI reporting engine, content recommendations, customer 360, policy conflict detector) plus tests. Every one of those is a multi-day slice on this codebase (63-column bookings table, 90+ tables, dozens of edge functions already in flight).

Doing it "in one coherent pass" would produce thin scaffolding everywhere and near-guaranteed regressions in the live booking, SMS, and campaign flows. I want to build this well, not everywhere-at-once.

I'm asking for approval on staged delivery. Each phase is a single implementation pass with tests, ends in a working state, and doesn't block the ones after it.

## Proposed phases

**Phase 1 — Admin shell + Overview + Action Inbox (data model + UI)**
- New `/admin` shell with left nav (Overview, Action Inbox, Leads, Conversations, Knowledge, Email Drafts, Reports, Integrations, Settings). Existing tabs move into the shell — no capability removed.
- `action_inbox_items` table (all 11 types, priority/status/snooze/owner/metadata, admin RLS).
- Overview cards wired to real counts (leads, bookings, close rate, open actions, unresolved gaps).
- Action Inbox list + detail with filters, bulk resolve, source links.

**Phase 2 — Lead attribution end-to-end**
- Schema: `self_reported_source`, `self_reported_source_detail`, `attribution_*`, first/last touch on `quote_sessions`, `quotes`, `bookings`, `customers`.
- `lead_sources` admin table (aliases, grouping, active flag, seed defaults).
- Booking flow: required-with-skip lead source step + "Other" custom text.
- Jobber sync audit + safest mapping (custom field or note), sync status surfaced in Admin.
- Tests: capture, normalization, Jobber idempotency, fallback.

**Phase 3 — Knowledge-gap automation + notification routing**
- `knowledge_gaps` classification (7 reasons), dedup, escalation.
- Hook into orchestrator low-confidence path → creates gap + Action Inbox item.
- Notification service using existing SMS/email infra, admin preferences, safe-disabled state.
- Immediate vs digest routing rules.

**Phase 4 — CallRail conversation intelligence**
- `callrail_calls`, `conversation_transcripts`, `conversation_insights`, `promises` (idempotent on CallRail call ID).
- Webhook ingestion + reconciliation cron for late transcripts.
- Insights extraction (intent, objections, promises, risk flags) via existing AI orchestrator.
- Conversations admin page with actions ("Create knowledge record", etc.).

**Phase 5 — Missed-call recovery + promise tracking**
- Missed-call → Action Inbox item + suggested SMS draft (no auto-send).
- Overdue promise flagging.

**Phase 6 — Gmail draft assistant (code-complete, gated)**
- Integrations > Gmail setup screen; verifies mailbox == ben@bluladder.com.
- `email_threads`, `email_drafts` schema; classification + draft generation service.
- Email Drafts admin page (edit/approve/dismiss/owner-needed).
- Full functional path behind "Connect ben@bluladder.com" disabled state until OAuth secrets provided. I'll list exact secrets needed.

**Phase 7 — Reporting + KPIs + scheduling**
- `marketing_spend`, `report_runs`, `report_artifacts`.
- Aggregation service for all listed KPIs, channel breakdown, WoW/MoM/QoQ/YoY.
- Weekly + monthly cron; archived Reports page; email to ben@bluladder.com when email is configured.

**Phase 8 — Content recommendations + Customer 360 + policy-conflict detector**
- `content_recommendations` with clustering/dedup.
- Customer timeline view combining calls, texts, emails, quotes, bookings, appointments, AI chats, actions.
- Policy-conflict detector across transcripts, templates, KB, website-synced knowledge → Action Inbox items.

## Cross-cutting rules (applied every phase)

- Idempotent migrations; no data loss; no infra migration; no publish/deploy.
- **Auto-send policy (Ben's clarification):**
  - **Email:** draft-only, always. Create a Gmail draft in the original thread for ben@bluladder.com and notify Ben. Never auto-send customer email.
  - **SMS + operational follow-ups:** automatic by default for approved, low-risk workflows — missed-call recovery, quote follow-up, appointment reminders/follow-up, promised callbacks, knowledge-gap escalation to Ben. Enforce consent/opt-out, quiet hours, rate limits, idempotency, and stop conditions.
  - **Never auto-send substantive customer replies** for complaints, damage claims, refunds, legal/safety, pricing exceptions, or unusual jobs. Create urgent owner Action Inbox items + internal notifications; only a safe acknowledgment from an approved template is allowed.
  - **Per-workflow admin config:** enabled, delay, cadence, max attempts, channel, template, quiet hours, escalation. Preserve existing approved transactional automation.
- Admin RLS on every new table; rate limits + idempotency on all webhooks/ingestion.
- Typecheck + production build + focused tests must stay green.
- Final honest audit each phase: what works, what's awaiting credentials, exact manual setup steps.

## Ask

Reply with one of:
1. **"Go phase 1"** — I start on the admin shell + Action Inbox now, ship it end-to-end with tests, then stop and wait for your review before phase 2.
2. **"Reorder to X first"** — tell me which phase to lead with (e.g., attribution is the highest business ROI; CallRail intelligence is the biggest unlock).
3. **"Compress to N phases"** — I'll merge and tell you exactly what gets thinner.
4. **"Just do everything, thin is fine"** — I'll do one shallow pass across all 11 areas with schema + skeleton UI + no deep logic, and be explicit that most of it is scaffolding.

Default recommendation: **Go phase 1**, then attribution (phase 2), then CallRail (phase 4) — those three unlock the Action Inbox, the reporting numbers, and the intelligence feed everything else depends on.
