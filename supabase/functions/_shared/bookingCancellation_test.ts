// Pure-function tests for the canonical cancellation helper's decision logic.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideCancellationOutcome } from "./bookingCancellation.ts";

Deno.test("null booking → not_found", () => {
  assertEquals(decideCancellationOutcome(null).kind, "not_found");
});

Deno.test("already-cancelled booking → idempotent no-op regardless of version", () => {
  const d = decideCancellationOutcome({
    id: "b1", status: "cancelled", booking_version: 3, cancellation_lifecycle_version: 3,
  });
  assertEquals(d.kind, "already_cancelled_same_or_newer");
});

Deno.test("completed booking → terminal no-op (never emits cancellation event)", () => {
  const d = decideCancellationOutcome({
    id: "b1", status: "completed", booking_version: 2, cancellation_lifecycle_version: null,
  });
  assertEquals(d.kind, "terminal_completed");
});

Deno.test("confirmed booking → apply with next_version = current+1", () => {
  const d = decideCancellationOutcome({
    id: "b1", status: "confirmed", booking_version: 4, cancellation_lifecycle_version: null,
  });
  if (d.kind !== "apply") throw new Error("expected apply");
  assertEquals(d.currentVersion, 4);
  assertEquals(d.nextVersion, 5);
});

Deno.test("null booking_version defaults to 1 → next is 2", () => {
  const d = decideCancellationOutcome({
    id: "b1", status: "confirmed", booking_version: null, cancellation_lifecycle_version: null,
  });
  if (d.kind !== "apply") throw new Error("expected apply");
  assertEquals(d.currentVersion, 1);
  assertEquals(d.nextVersion, 2);
});
