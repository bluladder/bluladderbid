
# Fix Booking Time & Conflict Detection

## Problem Summary
1. **Wrong appointment time**: 9:30am selection becomes 3:30pm in Jobber due to timezone conversion bug
2. **Double-bookings**: No real-time conflict check before creating appointments
3. **Stale cache**: Availability cache shows slots that are already booked

## Root Causes

### Timezone Bug
The booking function extracts time from `toISOString()` which returns UTC hours, then labels it as `America/Chicago`. For example:
- Customer selects: 9:30am Central
- Frontend sends: `2026-01-28T15:30:00.000Z` (correct UTC representation)
- Current code extracts: `15:30` from the ISO string
- Sends to Jobber: `{ date: "2026-01-28", time: "15:30", timezone: "America/Chicago" }`
- Jobber interprets: 3:30pm Central (wrong!)

### Missing Conflict Check
The `jobber-create-booking` function creates visits without verifying the technician is actually free at that moment.

---

## Solution

### Step 1: Fix Timezone Conversion
Update `parseToLocalDateTime` to properly convert UTC to Central time before extracting the time string.

```text
Before: Extract HH:MM from UTC ISO string
After:  Use Intl.DateTimeFormat with America/Chicago to get local hour/minute
```

### Step 2: Add Real-Time Conflict Detection
Before creating the visit, query Jobber for existing visits on that day for the assigned technician. If any overlap with the requested time window, return a 409 Conflict error.

### Step 3: Clean Up Stale Cache
Clear the seeded placeholder entries from `availability_cache` so the system fetches real data from Jobber.

### Step 4: Improve Calendar UX for 1-Year Horizon
Implement date-first loading: user picks a date, then we fetch slots for that specific date range only.

---

## Technical Changes

### Backend: `supabase/functions/jobber-create-booking/index.ts`

1. **Fix `parseToLocalDateTime` function**
   - Use `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'` to extract the correct local hour and minute
   - This ensures 9:30am selection becomes `{ time: "09:30" }` not `{ time: "15:30" }`

2. **Add conflict check before visit creation**
   - Query Jobber for visits on the scheduled day assigned to the same technician
   - Check for time overlap: `(newStart < existingEnd) AND (newEnd > existingStart)`
   - Return 409 Conflict with user-friendly message if overlap detected

### Database: Clear Cache
- Delete all rows from `availability_cache` to force fresh fetches

### Frontend: `src/components/booking/TimeSlotPicker.tsx`
- Handle 409 Conflict response with a user-friendly message
- Offer to refresh availability to show updated slots

---

## Expected Outcome
- Appointments will be created at the correct time (9:30am = 9:30am)
- Double-bookings will be blocked with a clear error message
- Availability will reflect the actual Jobber calendar
- Customers can book up to 1 year out with date-first loading
