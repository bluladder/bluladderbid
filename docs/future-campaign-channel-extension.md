# Future Campaign Channel Extension

**Status:** Design note. Nothing in this document is implemented. It exists to
preserve an obvious extension path so that a future channel (for example
`voicemail_drop` / ringless voicemail) can be added without creating a second,
parallel campaign system.

> Do not implement any of the items below as part of an unrelated change.
> Ringless voicemail — the provider, consent category, templates, and channel
> constant — is intentionally **not** built today.

## Guiding principle

Every campaign lifecycle event flows through **one** canonical ingress:
`supabase/functions/campaign-event`, reached from feature code via
`supabase/functions/_shared/campaignEmitter.ts` (`emitCampaignEvent`). Every
queued message row lives in a **single** delivery queue
(`sms_messages` — the name is historical; the table is the general message
queue). The `channel` column on each `sms_campaigns.sms_campaign_steps` row and
on each queued message determines which provider adapter delivers the payload.

A new channel must slot into that existing shape. It must not introduce a new
ingress, a new enrollment engine, or a new queue.

## What already exists (reusable as-is)

| Concern | Where it lives | Status for a 3rd channel |
|---|---|---|
| Allowlisted event names | `_shared/campaignEngine.ts` → `ALLOWED_EVENTS` | Reusable. No change required unless the new channel raises new events. |
| Audience matching | `_shared/campaignEngine.ts` → `matchesAudience` | Reusable. |
| Consent tier check | `_shared/campaignEngine.ts` → `consentSatisfies` | Reusable. Needs a new consent *category* only if regulation demands a distinct grant (see below). |
| Suppression | `_shared/suppression.ts` → `checkSuppression` | Reusable. |
| Stop-scope logic | `campaign-event/index.ts` → `applyStop` + `STOP_EVENTS` | Reusable. Stops already cancel queued rows by `enrollment_id` regardless of channel. |
| Idempotency | `emitCampaignEvent` + `campaign_events.idempotency_key` unique index | Reusable. |
| Queue processor | `process-sms-queue/index.ts` | Needs a new branch that dispatches `channel === "voicemail_drop"` to the new adapter. |
| Campaign step shape | `sms_campaign_steps.channel` column | Reusable — the column is already a free-form text field storing the channel key. |
| Queue row shape | `sms_messages.channel` column | Reusable — same rationale. |
| Admin campaign editor | `src/components/admin/sms/*` | Needs a new option in the channel picker and template/recording selector. |

## What a new channel (e.g. `voicemail_drop`) would need

1. **Provider adapter.** New file in `supabase/functions/_shared/` mirroring
   `sms.ts`'s `sendCallRailSms` shape: one `send*` function returning
   `{ ok, messageId?, error? }` and one `get*Config` helper reading a
   dedicated secret. All retry/backoff continues to live in
   `process-sms-queue`.
2. **Dispatch branch in the queue processor.** `process-sms-queue` today
   branches on `channel === "email"` vs SMS. A `voicemail_drop` branch is
   added there, calling the new adapter. The row lifecycle
   (`pending → sent → failed`, `attempts`, `next_retry_at`) does not change.
3. **Delivery-status mapping.** The adapter returns the same `{ ok, error }`
   shape as the CallRail/Resend adapters; the processor writes the same
   status columns. No new columns are required.
4. **Provider webhook (optional).** If the provider posts delivery receipts,
   add one new edge function following `callrail-inbound-sms`'s pattern that
   updates `sms_messages.status` by `callrail_message_id`-equivalent id.
5. **Channel-specific consent check.** Reuse `consentSatisfies` with the
   existing `marketing` / `requested_follow_up` / `transactional` tiers if
   the legal analysis says voice falls under the same grants. A **new
   consent category** is only required if regulation (e.g. TCPA prerecorded
   voice) demands an explicit voice-specific grant — in which case add one
   enum value to `communication_consent.consent_type`, one column to the
   consent UI, and extend `grantedTypes()` / `consentSatisfies()`. The
   canonical enrollment path does not otherwise change.
6. **Channel-specific suppression.** Reuse `checkSuppression` with the
   existing phone / email keys — voicemail is phone-keyed and already
   covered. Add a phone-scoped opt-out reason string only if the product
   wants a separate "no voicemail" preference distinct from "no SMS".
7. **Quiet-hour handling.** Enforced in `process-sms-queue` where SMS quiet
   hours are enforced today. A voicemail branch reads the same quiet-hour
   config and reschedules `send_at` identically.
8. **Template / recording selection.** For text channels the step stores
   `body_template`. For voicemail add either a `recording_url` column or
   store the URL in the existing `body_template` field (as an ID/URL
   reference resolved by the adapter). No new template engine required.
9. **Admin campaign editor.** Extend the channel select in
   `SmsCampaignManager.tsx` / `MessageTemplateManager.tsx` to include
   `voicemail_drop`, and swap the body-template textarea for a recording
   picker when that channel is selected.
10. **Reporting.** The dashboard groups by `channel` already. A new value
    surfaces automatically once rows exist.

## Explicit answers to the extension audit

- **Database enum or constraint migration?** Not strictly required today —
  `channel` is stored as text on both `sms_campaign_steps` and
  `sms_messages`. If a CHECK constraint or enum is later introduced for
  safety, the migration is trivial: add the new value in one migration.
- **Queue schema change?** No changes needed for a text-only channel. A
  voicemail-style channel may want an optional `recording_url` column on
  the step table; it is additive, nullable, and does not affect existing
  rows.
- **New provider adapter only?** Yes — this is the dominant cost.
- **New consent category?** Only if legal review requires a distinct
  prerecorded-voice grant. Otherwise the existing tiers apply.
- **Admin UI changes?** Small: a new channel option and a
  channel-dependent template/recording input.
- **Additional webhook processing?** Only if the provider emits delivery
  receipts. Follows the existing inbound-webhook pattern.

## Summary sizing

Adding ringless voicemail later is expected to be a **provider adapter plus
small schema/UI enhancement** — not a new campaign system, and not
significant infrastructure work. The single-ingress / single-queue design
documented above is the reason.

## Non-goals

- No two-channel assumption should be baked into new code. Where practical,
  new code should branch on `channel` rather than on a boolean like
  `isEmail` / `isSms`. Existing stable code is intentionally **not**
  refactored merely to generalize.
- This document does not authorize building any voicemail feature. Any
  future work must be requested and scoped explicitly.