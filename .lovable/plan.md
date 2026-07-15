# Lead-Anchored Crew Scheduling

Customers book time — not people. Only crew leaders anchor availability; juniors are hidden capacity.

## 1. Schema (single migration, additive)

Extend `technicians` (no rename, no destructive change):
- `role` text: `crew_leader | junior_technician | inactive` (default `junior_technician`)
- `customer_bookable_lead` boolean (default false)
- `has_company_vehicle` boolean (default false)
- `max_crew_size` int (default 1, CHECK NULL or 1–5) — only meaningful when `customer_bookable_lead=true`
- `eligible_leader_ids` uuid[] (default `{}`) — which leaders a junior may support (empty = any leader)
- `public_display_name` text nullable
- `role_effective_at` timestamptz nullable (future role change)

New `crew_config` (single row, admin-editable) for global settings:
- `hide_technician_names` boolean (default true)
- `default_public_crew_label` text (default `"BluLadder Service Team"`)
- `productivity_multipliers` jsonb — default `{ "1": 1.0, "2": 1.8, "3": 2.5, "4": 3.1, "5": 3.6 }` (subject to your approval)
- `crew_size_min` / `crew_size_max` int (1 / 5)

New `service_staffing_requirements` (optional, empty by default — preserves current solo behavior):
- `service_key` text
- `min_technicians`, `preferred_technicians`, `max_technicians` int
- `lead_vehicle_required` boolean
- `solo_allowed` boolean

New `booking_crew_assignments`:
- `booking_id` fk, `leader_technician_id`, `supporting_technician_ids` uuid[]
- `staffing_segments` jsonb `[{ start, end, tech_ids[], count, productivity }]`
- `public_crew_label` text, `calculated_duration_minutes` int

Seed:
- Benjamin, Bryan → `crew_leader`, `customer_bookable_lead=true`, `has_company_vehicle=true`, max_crew_size 3 and 2
- Samuel, Michael → `junior_technician`, `customer_bookable_lead=false`, `has_company_vehicle=false`

All new tables get GRANTs + RLS (authenticated admins write, service_role full).

## 2. Availability engine (`supabase/functions/jobber-availability`)

New module `crewAssignment.ts`:
- `getEligibleLeaders(techs)` → only `customer_bookable_lead=true` AND active
- `buildStaffingSegments(leader, juniors, dayWindow, busyByTech)` → merges leader free window with juniors' free intervals into contiguous segments `{ start, end, techIds[], count }`, respecting `max_crew_size`, `eligible_leader_ids`, and no-overlap-across-crews
- `computeCrewAdjustedDuration(soloMinutes, segments, multipliers)` → walks segments, converts to work-units, returns `{ endTime, feasible }`
- `serviceMeetsStaffing(service, segments)` → enforces min technicians for services in `service_staffing_requirements`

Slot generation change (server-side, not UI filter):
1. Iterate leaders only.
2. For each candidate start time, build staffing segments starting there.
3. Compute crew-adjusted duration.
4. Reject if leader isn't free for full duration, service min-staffing unmet, or feasibility unproven → fall back to conservative solo duration.
5. Never surface a slot anchored by a junior.

Existing team-pairing logic (leader+leader) preserved but reframed: leader-anchored only.

## 3. Booking write (`jobber-create-booking`)

- Revalidate leader + segments immediately before Jobber call; fail closed on drift.
- Jobber: assign leader for full visit. For juniors present the full visit, add via existing team-assignment. For partial juniors, store segments in `booking_crew_assignments` + internal `schedule_blocks` note; do NOT split the customer visit. Report Jobber's partial-assignment limits in the admin UI.

## 4. Customer-facing UI

- Strip `technicianName` from all customer-visible components: `TimeSlotPicker`, `SmartScheduler`, `RecommendedSlots`, `DateFirstCalendar`, `BookingConfirmation`, `SelectedAppointmentSummary`, confirmation emails/SMS.
- Show only date, time, duration, and optional generic crew label from `crew_config`.
- Admin views still show internal names.

## 5. Admin UI (extend, don't fork)

`TechnicianManager` gains: role selector, `customer_bookable_lead` toggle, vehicle toggle, `max_crew_size` stepper (1–5, disabled unless leader), eligible-leaders multiselect for juniors, public display name, future effective date.

New `CrewSettings` panel (inside Crew tab): hide-names toggle, default public label, productivity multipliers editor, service staffing requirements editor.

New `DailyCrewAssignment` inside existing `AdminScheduleCalendar`: junior assignment ribbons, crew-size timeline, unstaffed/understaffed appointment flags.

Bookings that violate a newly reduced `max_crew_size` are flagged (not auto-modified).

## 6. Post-booking changes

Junior becoming unavailable → recalculate feasibility, flag booking for admin review, keep leader, no auto-cancel, no silent customer notification.

## 7. Tests

New unit tests in `crewAssignment_test.ts` and updates to `availability-core_test.ts` covering all 18 base tests + 10 crew-size tests you listed. Existing pricing/booking suites remain untouched and must stay green.

## Technical Details

```text
Availability pipeline (per candidate day):
  leaders ──► for each leader
                │
                ├─ leader busy blocks (Jobber + PTO + reservations)
                ├─ juniors' busy blocks + leader-eligibility filter
                │
                ▼
       buildStaffingSegments()
                │
                ▼
       computeCrewAdjustedDuration(soloMinutes, segments)
                │
                ▼
       serviceMeetsStaffing() ──► emit slot (leader-anchored)
```

Productivity multipliers stored in `crew_config.productivity_multipliers` — editable in admin, initial defaults `{1:1.0, 2:1.8, 3:2.5, 4:3.1, 5:3.6}` pending your approval.

## Decisions I need from you before building

1. **Productivity multipliers** — approve the initial defaults above, or provide your own.
2. **Service staffing minimums** — leave the table empty (all services stay solo-capable) unless you name specific services and their minimums.
3. **Jobber partial-team behavior** — confirm you're OK with the approach: full-visit juniors via Jobber team assignment; partial juniors internal-only until we verify Jobber supports partial windows.

Reply "approve and go" (with any answers above) and I'll implement in a single pass: migration → availability engine → booking write → customer UI name-stripping → admin controls → tests.
