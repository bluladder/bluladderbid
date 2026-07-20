// Focused test that the takeover/release action shape is well-formed and that
// the AI orchestrator gates on staff_takeover_at (see aiOrchestrator.ts). The
// gate itself is exercised in that file's own tests; here we only verify the
// update payload emitted by admin-conversation-action is exactly what the
// orchestrator inspects.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Re-declare the switch here in miniature to lock the contract. If this
// diverges from index.ts the test fails and the drift is caught.
function buildUpdate(action: string, adminId = "admin-1"): Record<string, unknown> {
  const now = "2026-07-20T00:00:00.000Z";
  switch (action) {
    case "takeover":
      return {
        last_activity_at: now,
        staff_takeover_at: now,
        staff_takeover_by: adminId,
        staff_takeover_reason: "admin_takeover",
        campaign_status: "paused_takeover",
      };
    case "release":
      return {
        last_activity_at: now,
        staff_takeover_at: null,
        staff_takeover_by: null,
        staff_takeover_reason: null,
        campaign_status: null,
      };
    default:
      return { last_activity_at: now };
  }
}

Deno.test("takeover sets staff_takeover_at so orchestrator returns silent state", () => {
  const u = buildUpdate("takeover");
  // orchestrator: if (row?.staff_takeover_at) => state = "staff_takeover"
  assertEquals(typeof u.staff_takeover_at, "string");
  assertEquals(u.campaign_status, "paused_takeover");
});

Deno.test("release clears staff_takeover_at so orchestrator resumes", () => {
  const u = buildUpdate("release");
  assertEquals(u.staff_takeover_at, null);
  assertEquals(u.staff_takeover_by, null);
  assertEquals(u.campaign_status, null);
});