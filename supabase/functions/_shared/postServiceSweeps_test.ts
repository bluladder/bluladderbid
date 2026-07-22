import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { educationDueKeys, maintenanceDueKeys } from "./postServiceSweeps.ts";

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

Deno.test("educationDueKeys: only active configs whose send_after_days has elapsed", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  const contents = [
    { service_key: "window_cleaning", send_after_days: 7, channel: "email", is_active: true },
    { service_key: "house_wash", send_after_days: 10, channel: "email", is_active: true },
    { service_key: "gutter_cleaning", send_after_days: 14, channel: "email", is_active: false },
  ];
  const booking = {
    id: "b1",
    service_completed_at: daysAgoIso(11, now),
    service_types: ["window_cleaning", "house_wash", "gutter_cleaning"],
  };
  assertEquals(educationDueKeys(booking, contents, now).sort(), ["house_wash", "window_cleaning"]);
});

Deno.test("educationDueKeys: not due when not enough time has passed", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  const contents = [{ service_key: "window_cleaning", send_after_days: 7, channel: "email", is_active: true }];
  const booking = { id: "b1", service_completed_at: daysAgoIso(3, now), service_types: ["window_cleaning"] };
  assertEquals(educationDueKeys(booking, contents, now), []);
});

Deno.test("educationDueKeys: missing service_completed_at returns []", () => {
  const now = new Date();
  const contents = [{ service_key: "window_cleaning", send_after_days: 7, channel: "email", is_active: true }];
  assertEquals(educationDueKeys({ id: "b1", service_types: ["window_cleaning"] }, contents, now), []);
});

Deno.test("maintenanceDueKeys: due when interval passed and not recently notified", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  const intervals = [
    { service_key: "window_cleaning", interval_days: 120, is_active: true },
    { service_key: "house_wash", interval_days: 365, is_active: true },
  ];
  const booking = {
    id: "b1",
    service_completed_at: daysAgoIso(200, now),
    service_types: ["window_cleaning", "house_wash"],
  };
  assertEquals(maintenanceDueKeys(booking, intervals, now), ["window_cleaning"]);
});

Deno.test("maintenanceDueKeys: suppressed when maintenance_last_notified_at is inside the interval window", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  const intervals = [{ service_key: "window_cleaning", interval_days: 120, is_active: true }];
  const booking = {
    id: "b1",
    service_completed_at: daysAgoIso(200, now),
    maintenance_last_notified_at: daysAgoIso(30, now),
    service_types: ["window_cleaning"],
  };
  assertEquals(maintenanceDueKeys(booking, intervals, now), []);
});

Deno.test("maintenanceDueKeys: falls back to scheduled_start_at when completion is unknown", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  const intervals = [{ service_key: "window_cleaning", interval_days: 90, is_active: true }];
  const booking = {
    id: "b1",
    scheduled_start_at: daysAgoIso(100, now),
    service_types: ["window_cleaning"],
  };
  assertEquals(maintenanceDueKeys(booking, intervals, now), ["window_cleaning"]);
});

Deno.test("maintenanceDueKeys: inactive interval configs are ignored", () => {
  const now = new Date();
  const intervals = [{ service_key: "window_cleaning", interval_days: 30, is_active: false }];
  const booking = { id: "b1", service_completed_at: daysAgoIso(400, now), service_types: ["window_cleaning"] };
  assertEquals(maintenanceDueKeys(booking, intervals, now), []);
});

