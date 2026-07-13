// Focused tests for the schedule-mirror freshness gate that guards all
// customer-facing availability and booking conflict checks.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getMirrorFreshness, STALE_THRESHOLD_MINUTES } from "./scheduleFreshness.ts";

// Minimal mock of the supabase client's chained query used by getMirrorFreshness.
function mockClient(row: Record<string, unknown> | null, error = false) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({ data: row, error: error ? { message: "boom" } : null });
                },
              };
            },
          };
        },
      };
    },
  };
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();

Deno.test("fresh schedule data is accepted", async () => {
  const c = mockClient({
    last_full_sync_completed_at: minsAgo(5),
    lock_holder_id: null,
    lock_acquired_at: null,
    last_run_status: "completed",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, true);
  assertEquals(f.reason, "fresh");
});

Deno.test("stale schedule data is rejected", async () => {
  const c = mockClient({
    last_full_sync_completed_at: minsAgo(STALE_THRESHOLD_MINUTES + 10),
    lock_holder_id: null,
    lock_acquired_at: null,
    last_run_status: "completed",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, false);
  assertEquals(f.reason, "stale");
});

Deno.test("routine in-progress refresh still serves a FRESH snapshot", async () => {
  // The near-term autosync holds the lock ~75s every 5 minutes. A fresh
  // completed snapshot must still be served during that routine refresh instead
  // of failing closed (the bug that surfaced during the live AI-chat test).
  const c = mockClient({
    last_full_sync_completed_at: minsAgo(5),
    lock_holder_id: "run-123",
    lock_acquired_at: minsAgo(2), // within lock TTL => actively running
    last_run_status: "running",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, true);
  assertEquals(f.reason, "fresh");
  assertEquals(f.syncInProgress, true); // still reported for admins/logs
});

Deno.test("in-progress sync with a STALE snapshot is rejected", async () => {
  const c = mockClient({
    last_full_sync_completed_at: minsAgo(STALE_THRESHOLD_MINUTES + 10),
    lock_holder_id: "run-123",
    lock_acquired_at: minsAgo(2), // within lock TTL => actively running
    last_run_status: "running",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, false);
  assertEquals(f.reason, "sync_in_progress");
});

Deno.test("in-progress FIRST sync (never completed) is rejected", async () => {
  const c = mockClient({
    last_full_sync_completed_at: null,
    lock_holder_id: "run-123",
    lock_acquired_at: minsAgo(2),
    last_run_status: "running",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, false);
  assertEquals(f.reason, "sync_in_progress");
});

Deno.test("never-synced data is rejected", async () => {
  const c = mockClient({
    last_full_sync_completed_at: null,
    lock_holder_id: null,
    lock_acquired_at: null,
    last_run_status: "idle",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, false);
  assertEquals(f.reason, "never_completed");
});

Deno.test("expired lock does not count as in-progress (fresh completes)", async () => {
  const c = mockClient({
    last_full_sync_completed_at: minsAgo(5),
    lock_holder_id: "crashed-run",
    lock_acquired_at: minsAgo(120), // stale lock beyond TTL
    last_run_status: "running",
  });
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, true);
  assertEquals(f.reason, "fresh");
});

Deno.test("unreadable config fails closed", async () => {
  const c = mockClient(null, true);
  const f = await getMirrorFreshness(c);
  assertEquals(f.ok, false);
  assertEquals(f.reason, "config_unavailable");
});
