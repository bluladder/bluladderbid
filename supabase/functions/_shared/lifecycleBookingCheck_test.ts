// ============================================================================
// Pure tests for the source-lifecycle-scoped booking check.
// Hermetic — no DB, no network.
// ============================================================================
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  isLifecycleBlockingBooking,
  type LifecycleBookingRow,
} from "./lifecycleBookingCheck.ts";

const ANCHOR = "2026-07-01T00:00:00Z";
const BEFORE = "2025-01-01T00:00:00Z";
const AFTER  = "2026-08-15T00:00:00Z";

function row(o: Partial<LifecycleBookingRow>): LifecycleBookingRow {
  return {
    status: "completed", quote_id: null, created_at: AFTER,
    jobber_visit_id: null, jobber_job_id: null, ...o,
  };
}

// 1. First-time prospect: no bookings → the caller never enters this fn.
//    Sanity: an empty-status row created before the anchor never blocks.
Deno.test("historical (pre-anchor) completed job does NOT block — repeat customer stays eligible", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "completed", created_at: BEFORE, jobber_visit_id: "v-old" }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    false,
  );
});

Deno.test("booking linked to source quote_id BLOCKS", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ quote_id: "q-new", status: "confirmed", jobber_visit_id: "v-1", created_at: AFTER }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    true,
  );
});

Deno.test("authoritative Jobber booking created after anchor BLOCKS", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ quote_id: null, status: "scheduled", jobber_visit_id: "v-2", created_at: AFTER }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    true,
  );
});

Deno.test("confirmed booking after anchor without jobber id BLOCKS (status is authoritative)", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "completed", created_at: AFTER, jobber_visit_id: null, jobber_job_id: null }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    true,
  );
});

Deno.test("cancelled booking NEVER blocks — even when linked to source quote", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "cancelled", quote_id: "q-new", jobber_visit_id: "v-3", created_at: AFTER }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    false,
  );
});

Deno.test("invalid local pending booking (no Jobber id, no source link) does NOT block", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "pending", quote_id: null, jobber_visit_id: null, jobber_job_id: null, created_at: AFTER }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    false,
  );
});

Deno.test("pending booking linked to source quote WITHOUT Jobber confirmation does NOT block", () => {
  // An in-flight local pending row referencing the quote is not an
  // authoritative conversion until Jobber acknowledges it. Blocking on it
  // would create false positives on failed Jobber writes.
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "pending", quote_id: "q-new", jobber_visit_id: null, jobber_job_id: null, created_at: AFTER }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    false,
  );
});

Deno.test("booking via another channel (jobber_job_id set, no quote link) after anchor BLOCKS", () => {
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "scheduled", quote_id: null, jobber_job_id: "job-99", jobber_visit_id: null, created_at: AFTER }),
      { quoteId: "q-new", anchorIso: ANCHOR },
    ),
    true,
  );
});

Deno.test("no anchor and no quote link → cannot attribute → does NOT block", () => {
  // Fail-open guard: without lifecycle scope information, we do not fabricate
  // a lifetime block; the enrollment/backfill will re-evaluate on the next
  // pass once metadata catches up.
  assertEquals(
    isLifecycleBlockingBooking(
      row({ status: "completed", jobber_visit_id: "v-x", created_at: AFTER }),
      { quoteId: null, anchorIso: null },
    ),
    false,
  );
});