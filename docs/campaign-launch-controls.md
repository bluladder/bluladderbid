# Campaign Launch Controls (§12)

Two global kill-switches provide a final safety net for the campaign engine.
They are stored in a singleton row in `public.campaign_launch_controls` and
enforced server-side by the two components that could otherwise deliver
outbound messages.

## Switches

| Switch              | Enforced in                          | Effect                                                                                          |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `enrollment_paused` | `supabase/functions/campaign-event`  | New enrollments are refused for every campaign. Stop events (opt-outs, cancellations, replies) still process. |
| `delivery_paused`   | `supabase/functions/process-sms-queue` | The queue processor short-circuits before claiming rows. Queued messages remain `pending` and resume automatically once the pause is lifted. Transactional non-campaign sends are unaffected. |

## Admin surface

`Admin → Ops → Campaign Launch Controls` (`CampaignLaunchControlsPanel`) exposes
both toggles plus an optional note explaining the current setting. Only
operations admins can view or change the row (RLS-enforced).

## Activation gates

In addition to the global switches, individual campaign activation is guarded
by `SmsCampaignManager`:

1. `validateActivation` blocks activation unless the campaign has a trigger
   event, at least one active step, a valid consent requirement, and
   consistent effective window.
2. The activation dialog requires the admin to **type the campaign name
   exactly** before the confirm button unlocks.
3. Every status change is written to `campaign_audit_log` by the existing
   trigger.

## Recovery playbook

- **Runaway sends**: flip `delivery_paused = true` in the Ops panel. Queue
  rows freeze. Investigate; then untoggle to resume.
- **Bad enrollment logic**: flip `enrollment_paused = true`. Existing
  enrollments continue their scheduled cadence unless you also stop them
  individually or via `manual_staff_takeover` / `consent_revoked`.
- **Full stop**: both switches on. Only stop events and transactional
  operational messages continue.

No code changes are required to pause or resume — flipping the switch in the
admin UI takes effect on the next event/cron tick.