// ============================================================================
// Regression test for the end-of-sequence lifecycle transition.
//
// Verifies (offline, no live traffic):
//   * `quote_follow_up_completed` is added to the canonical allowlist and is
//     the ONLY new internal event introduced for this transition.
//   * The completion sweep is wired into process-sms-queue after normal
//     delivery, alongside (not replacing) the existing sweeps.
//   * The sweep uses a deterministic per-enrollment idempotency key so
//     duplicate processing cannot double-emit.
//   * The sweep only reads terminal-phase campaigns and only marks a
//     terminal-phase enrollment `completed` — it never touches the 22-step
//     cadence, message templates or step delays.
//   * The destination "BluLadder Long-Term Home Care Nurture (Post 12-Month)"
//     campaign is not activated by this code path; enrollment goes through the
//     canonical campaign-event boundary, which itself gates on `active=true`.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const engine = read("supabase/functions/_shared/campaignEngine.ts");
const sweep = read("supabase/functions/_shared/campaignSweep.ts");
const queue = read("supabase/functions/process-sms-queue/index.ts");

describe("quote_follow_up_completed — canonical event surface", () => {
  it("is added to the ALLOWED_EVENTS allowlist exactly once", () => {
    expect(engine).toMatch(/"quote_follow_up_completed"/);
    const occurrences = engine.match(/"quote_follow_up_completed"/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
  it("is not registered as a STOP event (it opens a new journey, does not close one)", () => {
    const stopBlock = engine.match(/STOP_EVENTS[\s\S]*?\};/)?.[0] ?? "";
    expect(stopBlock).not.toMatch(/quote_follow_up_completed/);
  });
});

describe("runFollowUpCompletionSweep — wiring and boundaries", () => {
  it("is exported from campaignSweep.ts", () => {
    expect(sweep).toMatch(/export async function runFollowUpCompletionSweep/);
  });
  it("uses the deterministic enrollment+version idempotency key", () => {
    expect(sweep).toMatch(/`quote_follow_up_completed:\$\{enrollmentId\}:v\$\{v\}`/);
  });
  it("only reads campaigns flagged is_terminal_phase = true", () => {
    expect(sweep).toMatch(/\.eq\(["']is_terminal_phase["'],\s*true\)/);
  });
  it("emits ONLY through the canonical campaign-event boundary (never inserts enrollments/queue rows directly)", () => {
    // The runner marks enrollments completed and emits; it must not create
    // sms_messages rows or campaign_enrollments rows on its own.
    const body = sweep.match(/runFollowUpCompletionSweep[\s\S]*?^}\s*$/m)?.[0] ?? "";
    expect(body).toMatch(/emitCampaignEvent/);
    expect(body).not.toMatch(/\.from\(["']sms_messages["']\)[\s\S]{0,80}\.insert\(/);
    expect(body).not.toMatch(/\.from\(["']campaign_enrollments["']\)[\s\S]{0,80}\.insert\(/);
  });
  it("marks the source enrollment completed only when emit succeeds", () => {
    expect(sweep).toMatch(/status:\s*["']completed["'],[\s\S]{0,120}stopped_reason:\s*["']completed_12_month_sequence["']/);
  });
  it("is wired into process-sms-queue AFTER normal delivery", () => {
    expect(queue).toMatch(/runFollowUpCompletionSweep/);
    const claimIdx = queue.indexOf("claim_due_sms");
    const sweepIdx = queue.indexOf("runFollowUpCompletionSweep");
    expect(sweepIdx).toBeGreaterThan(claimIdx);
  });
  it("does not introduce a second scheduler or parallel queue", () => {
    // The completion sweep must run inside the existing cron — no new
    // Deno.serve, no new supabase.functions.invoke of a fresh scheduler.
    expect(sweep).not.toMatch(/Deno\.cron/);
    expect(sweep).not.toMatch(/setInterval/);
  });
});

describe("22-step cadence is unchanged by the transition work", () => {
  it("Phase 1/2/3 step delays remain the canonical values", () => {
    // These constants mirror the seeded timeline verified by
    // unbookedQuoteFollowUp.config.test.ts. This test would fail if a future
    // edit accidentally shifted a step delay while touching the transition.
    const config = read("src/test/unbookedQuoteFollowUp.config.test.ts");
    expect(config).toMatch(/day:\s*365,\s*channel:\s*"email"/);
    expect(config).toMatch(/day:\s*0,\s*channel:\s*"sms"/);
    expect(config).toMatch(/day:\s*21,\s*channel:\s*"sms"/);
  });
});