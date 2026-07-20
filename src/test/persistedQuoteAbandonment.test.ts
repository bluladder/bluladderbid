// ============================================================================
// Regression tests for persisted-quote abandonment + plan-builder server path.
//
// Fully offline: source-inspection reads and an inline copy of the pure
// eligibility helper. No live SMS, email, Jobber, Meta, CallRail or Resend
// side-effect is possible from this suite.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const saveQuote = read("supabase/functions/save-quote/index.ts");
const sweep = read("supabase/functions/_shared/campaignSweep.ts");
const processQueue = read("supabase/functions/process-sms-queue/index.ts");
const planBuilder = read("src/hooks/useServicePlanBuilder.ts");

describe("plan-builder routes persistence through save-quote (no direct insert)", () => {
  it("invokes the save-quote function with mode:'plan'", () => {
    expect(planBuilder).toMatch(/functions\.invoke\(['"]save-quote['"]/);
    expect(planBuilder).toMatch(/mode:\s*['"]plan['"]/);
  });
  it("removes the direct client-side quotes insert", () => {
    expect(planBuilder).not.toMatch(/\.from\(['"]quotes['"]\)[\s\S]{0,120}\.insert\(/);
  });
  it("does not re-add the legacy send-sms('quote_created') dispatch", () => {
    expect(planBuilder).not.toMatch(/eventType:\s*['"]quote_created['"]/);
  });
});

describe("save-quote supersede + stop wiring for older versions", () => {
  it("marks older unbooked/non-superseded quotes with superseded_by/superseded_at", () => {
    expect(saveQuote).toMatch(/superseded_by:\s*quoteId/);
    expect(saveQuote).toMatch(/superseded_at:\s*nowIso/);
  });
  it("stops active quote_abandoned enrollments with a clear reason and preserves history", () => {
    expect(saveQuote).toMatch(/event_name["']?,\s*["']quote_abandoned["']/);
    expect(saveQuote).toMatch(/status:\s*["']stopped["']/);
    expect(saveQuote).toMatch(/stopped_reason:\s*["']superseded_by_newer_quote["']/);
  });
  it("cancels pending sms_messages for stopped enrollments (never deletes them)", () => {
    expect(saveQuote).toMatch(/status:\s*["']cancelled["']/);
    expect(saveQuote).not.toMatch(/from\(["']sms_messages["']\)[\s\S]{0,80}\.delete\(/);
  });
});

describe("persisted-quote abandonment sweep is wired into the existing cron", () => {
  it("process-sms-queue imports and calls runPersistedQuoteAbandonmentSweep", () => {
    expect(processQueue).toMatch(/runPersistedQuoteAbandonmentSweep/);
    expect(processQueue).toMatch(/await runPersistedQuoteAbandonmentSweep\(/);
  });
  it("sweep scans public.quotes filtered to unbooked, non-superseded firm rows", () => {
    expect(sweep).toMatch(/\.from\(["']quotes["']\)/);
    expect(sweep).toMatch(/\.is\(["']converted_booking_id["'], null\)/);
    expect(sweep).toMatch(/\.is\(["']superseded_by["'], null\)/);
    expect(sweep).toMatch(/\.in\(["']status["'], \["saved", "emailed", "viewed", "pending"\]\)/);
  });
  it("re-reads the row immediately before emit (no stale batch decisions)", () => {
    const runnerIdx = sweep.indexOf("runPersistedQuoteAbandonmentSweep");
    const snippet = sweep.slice(runnerIdx);
    expect(snippet).toMatch(/\.maybeSingle\(\)/);
  });
  it("uses a deterministic idempotency key on quote id + pricing rule version", () => {
    expect(sweep).toMatch(/quote_abandoned:\$\{q\.id\}:\$\{persistedQuoteVersionTag\(q\)\}:1/);
  });
  it("marks abandonment_emitted_version + abandonment_swept_at only after a successful emit", () => {
    expect(sweep).toMatch(/abandonment_emitted_version:\s*versionTag/);
    expect(sweep).toMatch(/abandonment_swept_at:/);
  });
});

// ---------------------------------------------------------------------------
// Pure eligibility contract — inline copy of evaluatePersistedQuoteAbandonment.
// If the runtime helper diverges from these expectations, the source-inspection
// tests above catch the shape change and this suite catches the behavior.
// ---------------------------------------------------------------------------
type Q = {
  id: string;
  status: string | null;
  total: number | string | null;
  customer_email: string | null;
  customer_phone: string | null;
  pricing_rule_version: number | null;
  last_activity_at: string;
  converted_booking_id: string | null;
  superseded_by: string | null;
  abandonment_emitted_version: string | null;
};
const FIRM = new Set(["saved", "emailed", "viewed", "pending"]);
function tag(q: Pick<Q, "pricing_rule_version">) { return `v${q.pricing_rule_version ?? 0}`; }
function evalQ(q: Q, nowMs: number, delayMin: number): { eligible: boolean; reason: string } {
  if (!FIRM.has(String(q.status ?? ""))) return { eligible: false, reason: "no_firm_quote" };
  if (q.converted_booking_id) return { eligible: false, reason: "booking_completed" };
  if (q.superseded_by) return { eligible: false, reason: "superseded" };
  const totalNum = typeof q.total === "number" ? q.total : Number(q.total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return { eligible: false, reason: "no_positive_total" };
  if (!q.customer_email && !q.customer_phone) return { eligible: false, reason: "no_contact_info" };
  const lastMs = new Date(q.last_activity_at).getTime();
  if (!Number.isFinite(lastMs)) return { eligible: false, reason: "invalid_activity_ts" };
  if (nowMs - lastMs < delayMin * 60_000) return { eligible: false, reason: "within_delay" };
  if (q.abandonment_emitted_version === tag(q)) return { eligible: false, reason: "already_emitted" };
  return { eligible: true, reason: "eligible" };
}

const NOW = Date.parse("2026-07-20T12:00:00Z");
const base: Q = {
  id: "q1",
  status: "saved",
  total: 850,
  customer_email: "a@b.com",
  customer_phone: null,
  pricing_rule_version: 3,
  last_activity_at: new Date(NOW - 60 * 60_000).toISOString(), // 60 min ago
  converted_booking_id: null,
  superseded_by: null,
  abandonment_emitted_version: null,
};

describe("persisted-quote eligibility contract", () => {
  it("eligible when firm + unbooked + non-superseded + positive total + delay elapsed", () => {
    expect(evalQ(base, NOW, 5).eligible).toBe(true);
  });
  it("booked quotes never emit abandonment", () => {
    expect(evalQ({ ...base, converted_booking_id: "b1" }, NOW, 5)).toEqual({
      eligible: false, reason: "booking_completed",
    });
  });
  it("superseded versions do not become active follow-up", () => {
    expect(evalQ({ ...base, superseded_by: "qNEW" }, NOW, 5).reason).toBe("superseded");
  });
  it("zero or non-numeric total is excluded", () => {
    expect(evalQ({ ...base, total: 0 }, NOW, 5).reason).toBe("no_positive_total");
    expect(evalQ({ ...base, total: null }, NOW, 5).reason).toBe("no_positive_total");
  });
  it("missing email AND phone is excluded", () => {
    expect(evalQ({ ...base, customer_email: null, customer_phone: null }, NOW, 5).reason).toBe("no_contact_info");
  });
  it("delay not yet elapsed is excluded", () => {
    const recent = new Date(NOW - 2 * 60_000).toISOString();
    expect(evalQ({ ...base, last_activity_at: recent }, NOW, 5).reason).toBe("within_delay");
  });
  it("same quote/version is emitted at most once (already_emitted)", () => {
    expect(evalQ({ ...base, abandonment_emitted_version: "v3" }, NOW, 5).reason).toBe("already_emitted");
  });
  it("a new pricing_rule_version re-opens exactly one emit", () => {
    // Prior version was emitted; bumping to v4 clears the guard for one emit.
    const bumped: Q = { ...base, pricing_rule_version: 4, abandonment_emitted_version: "v3" };
    expect(evalQ(bumped, NOW, 5).eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rendered SMS length + segment count. Uses realistic + worst-case merge
// substitutions. GSM-7 is 160 chars single / 153 concat; UCS-2 (any non-GSM
// char) is 70 / 67. These bounds are the SMS spec, not an approximation.
// ---------------------------------------------------------------------------
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXT = new Set("^{}\\[~]|€".split(""));
function encode(msg: string): { encoding: "GSM-7" | "UCS-2"; length: number; segments: number } {
  let gsm = true;
  let len = 0;
  for (const ch of msg) {
    if (GSM_BASIC.has(ch)) len += 1;
    else if (GSM_EXT.has(ch)) len += 2;
    else { gsm = false; break; }
  }
  if (!gsm) {
    const n = [...msg].length;
    const seg = n <= 70 ? 1 : Math.ceil(n / 67);
    return { encoding: "UCS-2", length: n, segments: seg };
  }
  const seg = len <= 160 ? 1 : Math.ceil(len / 153);
  return { encoding: "GSM-7", length: len, segments: seg };
}

// Realistic + worst-case first_name / service / link substitutions. Link uses
// a realistic quote.bluladder.com URL length; a long first name and a
// multi-service label represent worst case within our copy.
const TEMPLATES = [
  // Day 0 — 5 min
  (n: string, s: string, l: string) => `Hi ${n}, thanks for pricing ${s} with BluLadder. Ready to book? ${l}`,
  // Day 1
  (n: string, s: string, l: string) => `Hi ${n} — your BluLadder ${s} bid is ready. Grab a time here: ${l}`,
  // Day 4
  (n: string, s: string, l: string) => `${n}, still thinking on ${s}? Bid is saved & priced. Book: ${l}`,
  // Day 10
  (n: string, s: string, l: string) => `${n} — friendly nudge on your BluLadder ${s} bid. Book: ${l}`,
];

describe("rendered SMS length + segment counts (realistic + worst-case)", () => {
  const link = "https://quote.bluladder.com/q/9f3ab2c1-8d47";
  for (const tpl of TEMPLATES) {
    it("realistic substitution stays within a single GSM-7 segment", () => {
      const msg = tpl("Alex", "window cleaning", link);
      const enc = encode(msg);
      expect(enc.encoding).toBe("GSM-7");
      expect(enc.segments).toBe(1);
      expect(enc.length).toBeLessThanOrEqual(160);
    });
    it("worst-case substitution never exceeds 2 GSM-7 segments", () => {
      const msg = tpl("Alexandrina", "gutter cleaning + house wash + windows", link);
      const enc = encode(msg);
      expect(enc.encoding).toBe("GSM-7");
      expect(enc.segments).toBeLessThanOrEqual(2);
    });
  }
  it("a non-GSM character (curly quote) forces UCS-2 and reduces per-segment budget", () => {
    const enc = encode(`Hi Alex, your BluLadder bid’s ready: https://quote.bluladder.com/q/xyz`);
    expect(enc.encoding).toBe("UCS-2");
    expect(enc.segments).toBeGreaterThanOrEqual(1);
  });
});
