# Multi-Channel Lifecycle Campaigns

Turn the current text-only campaign system into a unified **text + email** campaign engine driven by a per-customer lifecycle status, with automatic and manual switching, and full admin editing of every message.

## Lifecycle statuses (per customer)

A single status lives on each customer and drives which lifecycle campaign(s) they're enrolled in:

```text
Open      -> requested a bid, no package/service chosen yet
Pending   -> chose a package/service/subscription, not yet scheduled or approved
Approved  -> subscription quote approved
Booked    -> booked bid or booked appointment
Declined  -> rejected / declined
```

- **Auto-switch:** when quotes/bookings change, the customer's status is recomputed automatically.
- **Manual switch:** an admin can override status on any customer at any time.
- **Cancel old, start new:** on any switch, still-unsent campaign messages from the old status are cancelled and the new status's sequences begin.
- **Multiple campaigns allowed:** more than one active campaign can target the same status; the customer enrolls in all of them. Manual/transactional one-off messages still send independently.

## What the admin can do

In Admin -> Integrations -> Text Messaging (renamed to **Campaigns & Messaging**):

1. **Campaign list** grouped by trigger: lifecycle-status campaigns (Open/Pending/Approved/Booked/Declined) and the existing event campaigns (quote created, appointment scheduled, etc.).
2. **Build new custom campaigns** keyed to a status or an event.
3. **Per-step control inside a campaign:** each step is either a **Text** or an **Email**; add, remove, reorder, edit, and **pause/resume** individual steps. Email steps get a subject line; both support `{{name}} {{service}} {{date}} {{time}} {{link}} {{total}}` variables.
4. **Lead board:** a customers/leads view showing each person's current status with a dropdown to manually move them to another status (which re-enrolls them).

## How auto-switching maps

```text
quote created (no real services)      -> Open
quote with package/subscription saved -> Pending
subscription quote approved           -> Approved
booking created / appointment booked  -> Booked
quote declined / booking cancelled    -> Declined
```

Five starter campaigns (one per status) are seeded with sensible default text + email steps that you can fully edit afterward.

---

## Technical details

### Database
- New enum `lead_lifecycle_status` (open, pending, approved, booked, declined).
- `customers`: add `lifecycle_status` (nullable), `lifecycle_changed_at`, `lifecycle_source` ('auto' | 'admin').
- `sms_campaigns`: add `campaign_kind` ('event' | 'lifecycle') and `lifecycle_status` (nullable enum). Existing rows default to 'event'.
- `sms_campaign_steps`: add `channel` ('sms' | 'email', default 'sms') and `subject` (text, email only).
- `sms_messages`: add `channel` ('sms' | 'email', default 'sms'), `to_email`, `subject` so the queue can carry both channels.
- New `campaign_enrollments` (customer_id, campaign_id, status active/superseded/completed) for switch bookkeeping.
- GRANTs + RLS: admin-managed tables stay admin-only; service_role full access for edge functions.
- DB trigger on `quotes` and `bookings` (insert/update) recomputes the customer's `lifecycle_status` and, on change, calls the enrollment edge function via `net.http_post` (pg_net already enabled).

### Edge functions
- **`manage-lifecycle`** (new): given `customerId` + `newStatus` + `source`, cancels unsent lifecycle campaign messages for that customer, updates the status, finds active lifecycle campaigns for the new status, and schedules their steps into `sms_messages` (text and email). Used by the DB trigger (auto) and the admin UI (manual).
- **`process-sms-queue`** (extend): when a queued row has `channel = 'email'`, send via the existing Resend integration (wrapping the rendered template in the branded BluLadder email shell); text rows keep using CallRail. Opt-out suppression still applies to text.
- **`send-sms`** (extend): event-campaign enrollment now also schedules email steps.
- Reuse existing `RESEND_API_KEY` and `noreply@bluladder.com` sender; no new secrets.

### Admin UI
- Rework `SmsCampaignManager.tsx` into a channel-aware campaign editor (per-step channel toggle, subject field for email, pause switch, reorder, delete; campaign keyed to status or event).
- New `LeadStatusBoard.tsx`: list customers with current status + manual switch control (calls `manage-lifecycle`).
- Update `SmsMessageLog.tsx` to show channel (Text/Email) and recipient.

### Notes / limits
- Email uses your current Resend sender, so deliverability matches today's appointment emails.
- Status is per customer; a customer with multiple bids shows a single status (latest action wins).
