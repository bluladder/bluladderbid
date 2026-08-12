import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type JobberVisitBlockSnapshot,
  projectCustomerPortalBookings,
  selectFreshestJobberVisitBlocks,
} from "./customerPortalAppointments.ts";

const originalStart = "2026-08-13T14:00:00.000Z";
const originalEnd = "2026-08-13T16:00:00.000Z";
const jobberStart = "2026-08-20T15:00:00.000Z";
const jobberEnd = "2026-08-20T17:00:00.000Z";

function block(
  overrides: Partial<JobberVisitBlockSnapshot> = {},
): JobberVisitBlockSnapshot {
  return {
    jobber_visit_id: "visit-1",
    client_address: "Jobber service address",
    start_at: jobberStart,
    end_at: jobberEnd,
    status: "scheduled",
    updated_at: "2026-08-12T15:00:00.000Z",
    ...overrides,
  };
}

Deno.test("customer portal: freshest active Jobber schedule replaces the original booking date", () => {
  const result = projectCustomerPortalBookings(
    [{
      id: "booking-1",
      jobber_visit_id: "visit-1",
      scheduled_start: originalStart,
      scheduled_end: originalEnd,
      home_details_json: { address: "Original intake address" },
    }],
    [
      block({
        start_at: "2026-08-18T15:00:00.000Z",
        end_at: "2026-08-18T17:00:00.000Z",
        updated_at: "2026-08-11T15:00:00.000Z",
      }),
      block(),
    ],
    "Customer fallback address",
  );

  assertEquals(result[0].scheduled_start, jobberStart);
  assertEquals(result[0].scheduled_end, jobberEnd);
  assertEquals(result[0].address, "Jobber service address");
  assertEquals(result[0].id, "booking-1");
});

Deno.test("customer portal: cancelled mirror rows never override an active visit", () => {
  const selected = selectFreshestJobberVisitBlocks([
    block(),
    block({
      status: "cancelled",
      start_at: "2026-09-01T15:00:00.000Z",
      updated_at: "2026-08-13T15:00:00.000Z",
    }),
  ]);
  assertEquals(selected.get("visit-1")?.start_at, jobberStart);
});

Deno.test("customer portal: appointments are re-sorted by the projected Jobber date", () => {
  const result = projectCustomerPortalBookings(
    [
      {
        id: "booking-1",
        jobber_visit_id: "visit-1",
        scheduled_start: originalStart,
      },
      {
        id: "booking-2",
        jobber_visit_id: "visit-2",
        scheduled_start: "2026-08-19T15:00:00.000Z",
      },
    ],
    [block()],
    null,
    "asc",
  );
  assertEquals(result.map((row) => row.id), ["booking-2", "booking-1"]);
});

Deno.test("customer portal: bookings without a Jobber mirror retain server booking values", () => {
  const result = projectCustomerPortalBookings(
    [{
      id: "booking-2",
      jobber_visit_id: null,
      scheduled_start: originalStart,
      scheduled_end: originalEnd,
      home_details_json: null,
    }],
    [],
    "Customer fallback address",
  );
  assertEquals(result[0].scheduled_start, originalStart);
  assertEquals(result[0].scheduled_end, originalEnd);
  assertEquals(result[0].address, "Customer fallback address");
});
