import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authoritativeBookingDurationMinutes,
  scheduledIntervalMinutes,
} from "./bookingDuration.ts";

Deno.test("authoritative duration matches launch service rules", () => {
  assertEquals(authoritativeBookingDurationMinutes(["window_cleaning"]), 90);
  assertEquals(
    authoritativeBookingDurationMinutes([
      "window_cleaning",
      "house_wash",
      "gutter_cleaning",
    ]),
    195,
  );
  assertEquals(
    authoritativeBookingDurationMinutes([
      "screen_repair",
      "screen_repair",
    ]),
    60,
  );
});

Deno.test("scheduled interval rejects malformed or reversed input", () => {
  assertEquals(
    scheduledIntervalMinutes(
      "2026-07-30T14:00:00.000Z",
      "2026-07-30T16:00:00.000Z",
    ),
    120,
  );
  assertEquals(scheduledIntervalMinutes("bad", "also-bad"), null);
  assertEquals(
    scheduledIntervalMinutes(
      "2026-07-30T16:00:00.000Z",
      "2026-07-30T14:00:00.000Z",
    ),
    null,
  );
});
