# Unified Smart Scheduling — Admin Portal + Customer Booking

## Goal
Present available appointments the same way in the **Admin Scheduling Portal** and the **customer booking flow**, with a clear, labeled hierarchy:

1. **Best Recommended** — the single highest-value slot (optimizes location/route + fills schedule gaps, e.g. a 2‑hr job dropped into a 3–5pm gap instead of a lone 9am).
2. **Next Available** — the soonest slot that is large enough to fit the selected service.
3. **5 More Options** — the next best-ranked appointments.
4. **Browse All** — day / week / month calendar showing every available appointment.

The scoring engine that decides "best" already exists in the `jobber-availability` function (gap 35% / recency 30% / route 15% / technician 20%). This work surfaces more of that ranking and reuses it on both ends so the experience is identical.

## What already exists (reused, not rebuilt)
- `jobber-availability` edge function with `recommended` mode (scores + sorts all valid slots) and `dayGrid` mode (all slots for one day).
- `useSmartAvailability` hook (recommendations + day slots + fully-booked days).
- `DateFirstCalendar` (day/week/month browsing) and `TimeSlotList`.
- Engine already guarantees every returned slot fits the service duration.

## Changes

### 1. Edge function `jobber-availability` (small, additive)
In `recommended` mode, in addition to the current `recommendations` (kept for backward compatibility), return:
- `bestRecommended`: the top-scored slot (highest combined score).
- `nextAvailable`: the earliest slot by start time (soonest that fits).
- `rankedSlots`: a de-duplicated, score-ordered list (~12) so the UI can show "5 more" without extra round-trips.

No scoring logic changes — purely exposing the already-computed `scoredSlots`.

### 2. Hook `useSmartAvailability`
Expose the new fields: `bestRecommended`, `nextAvailable`, `rankedSlots` (typed). Keep existing return values intact.

### 3. New shared component `src/components/scheduling/SmartScheduler.tsx`
A presentation component driven by the hook. Sections, clearly labeled with helper text:
- **Best Recommended** card — prominent, with a plain-English reason ("Fills a gap in the route — keeps the day efficient"). Star/“Top Pick” treatment.
- **Next Available** card — "Soonest opening that fits your service" with date/time/tech/duration.
- **5 More Options** — compact selectable list (dedupes the best/next already shown).
- **Browse the calendar** — collapsible region using `DateFirstCalendar` (day/week/month toggle) → on date select, loads that day's slots via `dayGrid` and lists them with `TimeSlotList`.
- Selection state is lifted via `selectedSlot` / `onSelectSlot` props so both hosts control booking.

Props: `services`, `customerAddress`, `numStories`, `selectedSlot`, `onSelectSlot`, `horizonDays`, and an optional `compact` flag for the narrower customer column.

### 4. Wire into Admin Scheduling Portal (`SchedulingPortal.tsx`)
Replace the current "View Slots → AdminAvailabilityViewer" booking selection with `SmartScheduler` (Best / Next / 5 more / calendar). The existing **Availability Inspector** (excluded-slot debugging + override mode) stays available as a separate advanced view so admins keep the override capability.

### 5. Wire into Customer Booking (`TimeSlotPicker.tsx`)
Render `SmartScheduler` in place of the current recommendations + day-picker steps so the customer sees the same Best / Next / 5 more / calendar layout. Keep the AM/PM preference filter and all existing booking handlers and analytics tracking.

## Clarity / labeling
- Every section has a one-line plain-English helper.
- Reason badges: “⚡ Soonest”, “🛣️ Best for route”, “📅 Gap filler”, “Fits your service”.
- Duration shown on every slot so it's obvious it fits.

## Technical notes
- Engine response stays backward compatible (additive fields); existing `RecommendedSlots` consumers keep working during/after the change.
- `rankedSlots` de-duped by display time + technician + day to avoid near-identical entries.
- No database/schema changes. No pricing/booking-creation logic changes — booking still flows through `jobber-create-booking` unchanged.

## Out of scope
- No changes to scoring weights, drive-time math, or team-job thresholds.
- No new booking statuses or notifications.
