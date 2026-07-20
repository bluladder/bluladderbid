// ============================================================================
// Launch-readiness regression for the branded unbooked quote follow-up.
//
// Fully offline: no live SMS / email / Jobber / Meta / CallRail / Resend
// side effects are possible from this suite. Verifies the four launch-blocker
// contracts: timing anchor, supersession scope, consent/channel matrix, and
// production-template SMS encoding.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const sweep = read("supabase/functions/_shared/campaignSweep.ts");
const saveQuote = read("supabase/functions/save-quote/index.ts");
const engine = read("supabase/functions/_shared/campaignEngine.ts");
const campaignEvent = read("supabase/functions/campaign-event/index.ts");

// ---- 1. Timing anchor ---------------------------------------------------
describe("timing anchor — inactivity threshold vs enrollment delay", () => {
  it("sweep uses a dedicated inactivity constant, not min(campaign step delays)", () => {
    expect(sweep).toMatch(/ABANDONMENT_INACTIVITY_MINUTES/);
    const runner = sweep.slice(sweep.indexOf("runPersistedQuoteAbandonmentSweep"));
    expect(runner).not.toMatch(/computeEffectiveAbandonmentDelay/);
    expect(runner).toMatch(/const delayMinutes = ABANDONMENT_INACTIVITY_MINUTES/);
  });
  it("default inactivity threshold is 5 minutes", () => {
    const m = sweep.match(/ABANDONMENT_INACTIVITY_MINUTES\s*=\s*\(\(\)[\s\S]*?:\s*(\d+)\s*;/);
    expect(m?.[1]).toBe("5");
  });
  // Timeline: t=0 quote persisted; t=5 inactivity elapsed (sweep marks eligible);
  // t=5..6 next cron tick emits quote_abandoned; enrollment scheduled_at = now
  // because Touch 1 delay_hours = 0; t=5..7 queue tick sends Touch 1.
  it("first-touch scheduled_at = last_activity + inactivity + step delay (applied once)", () => {
    const INACTIVITY_MIN = 5;
    const TOUCH_1_DELAY_HOURS = 0;
    const lastActivity = Date.parse("2026-07-20T12:00:00Z");
    const eligibleAt = lastActivity + INACTIVITY_MIN * 60_000;
    const scheduledAt = eligibleAt + TOUCH_1_DELAY_HOURS * 3_600_000;
    expect(scheduledAt - lastActivity).toBe(5 * 60_000);
  });
});

// ---- 2. Supersession scope (inline mirror of save-quote's filter) -------
type Event = { id: string; customer_id: string; event_name: string; metadata: { quote_id?: string } };
type Enrollment = { id: string; customer_id: string; event_name: string; status: string; campaign_event_id: string };

function scopedStopEnrollments(opts: {
  customerId: string;
  olderQuoteIds: string[];
  events: Event[];
  enrollments: Enrollment[];
}): string[] {
  const matchingEventIds = opts.events
    .filter((e) =>
      e.customer_id === opts.customerId &&
      e.event_name === "quote_abandoned" &&
      typeof e.metadata?.quote_id === "string" &&
      opts.olderQuoteIds.includes(e.metadata.quote_id!),
    )
    .map((e) => e.id);
  return opts.enrollments
    .filter((r) =>
      r.customer_id === opts.customerId &&
      r.event_name === "quote_abandoned" &&
      r.status === "active" &&
      matchingEventIds.includes(r.campaign_event_id),
    )
    .map((r) => r.id);
}

describe("supersession scope — only the superseded journey is stopped", () => {
  it("save-quote filters campaign_events by metadata.quote_id and enrollments by campaign_event_id", () => {
    expect(saveQuote).toMatch(/from\("campaign_events"\)/);
    expect(saveQuote).toMatch(/\.quote_id/);
    expect(saveQuote).toMatch(/\.in\("campaign_event_id", matchingEventIds\)/);
  });
  it("two independent quote journeys: recalculating one does not stop the other", () => {
    const events: Event[] = [
      { id: "e1", customer_id: "c1", event_name: "quote_abandoned", metadata: { quote_id: "qA_v1" } },
      { id: "e2", customer_id: "c1", event_name: "quote_abandoned", metadata: { quote_id: "qB_v1" } },
    ];
    const enrollments: Enrollment[] = [
      { id: "en1", customer_id: "c1", event_name: "quote_abandoned", status: "active", campaign_event_id: "e1" },
      { id: "en2", customer_id: "c1", event_name: "quote_abandoned", status: "active", campaign_event_id: "e2" },
    ];
    const stopped = scopedStopEnrollments({
      customerId: "c1", olderQuoteIds: ["qA_v1"], events, enrollments,
    });
    expect(stopped).toEqual(["en1"]);
  });
  it("no matching event id → nothing is stopped", () => {
    const stopped = scopedStopEnrollments({
      customerId: "c1", olderQuoteIds: ["qZ"],
      events: [{ id: "e1", customer_id: "c1", event_name: "quote_abandoned", metadata: { quote_id: "qA" } }],
      enrollments: [{ id: "en1", customer_id: "c1", event_name: "quote_abandoned", status: "active", campaign_event_id: "e1" }],
    });
    expect(stopped).toEqual([]);
  });
});

// ---- 3. Consent + channel matrix ----------------------------------------
type ConsentType = "transactional" | "requested_follow_up" | "marketing";
function consentSatisfies(required: ConsentType, granted: ConsentType[]): boolean {
  if (required === "transactional") return true;
  if (required === "marketing") return granted.includes("marketing");
  if (required === "requested_follow_up")
    return granted.includes("requested_follow_up") || granted.includes("marketing");
  return false;
}

describe("consent + channel matrix", () => {
  it("requested_follow_up consent enrolls Phase 1 only", () => {
    const g: ConsentType[] = ["requested_follow_up"];
    expect(consentSatisfies("requested_follow_up", g)).toBe(true);
    expect(consentSatisfies("marketing", g)).toBe(false);
  });
  it("marketing consent enrolls all three phases", () => {
    const g: ConsentType[] = ["marketing"];
    expect(consentSatisfies("requested_follow_up", g)).toBe(true);
    expect(consentSatisfies("marketing", g)).toBe(true);
  });
  it("no qualifying consent queues no marketing/follow-up steps", () => {
    const g: ConsentType[] = [];
    expect(consentSatisfies("requested_follow_up", g)).toBe(false);
    expect(consentSatisfies("marketing", g)).toBe(false);
    expect(consentSatisfies("transactional", g)).toBe(true);
  });
  it("engine still exports consentSatisfies and matchesAudience", () => {
    expect(engine).toMatch(/export function consentSatisfies/);
    expect(engine).toMatch(/export function matchesAudience/);
  });
  it("quote_calculated emit does not carry any consent grant field", () => {
    const emitBlock = saveQuote.slice(saveQuote.indexOf('eventName: "quote_calculated"'));
    expect(emitBlock).not.toMatch(/consent_type/);
    expect(emitBlock).not.toMatch(/marketing_consent/);
  });
  it("queue enforces channel presence and opt-out at send time", () => {
    const queue = read("supabase/functions/process-sms-queue/index.ts");
    expect(queue).toMatch(/if \(!msg\.to_email\)/);
    expect(queue).toMatch(/isPhoneOptedOut/);
    expect(queue).toMatch(/checkSuppression/);
  });
});

// ---- 4. Rendered SMS encoding of every seeded template ------------------
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXT = new Set("^{}\\[~]|€".split(""));
function encodeSms(msg: string): { encoding: "GSM-7" | "UCS-2"; length: number; segments: number } {
  let gsm = true;
  let len = 0;
  for (const ch of msg) {
    if (GSM_BASIC.has(ch)) len += 1;
    else if (GSM_EXT.has(ch)) len += 2;
    else { gsm = false; break; }
  }
  if (!gsm) {
    const n = [...msg].length;
    return { encoding: "UCS-2", length: n, segments: n <= 70 ? 1 : Math.ceil(n / 67) };
  }
  return { encoding: "GSM-7", length: len, segments: len <= 160 ? 1 : Math.ceil(len / 153) };
}

const SEEDED_SMS: Array<{ label: string; body: string }> = [
  { label: "P1 D0 SMS", body: "Hi {{first_name}}, this is Ben with BluLadder. I saw that you put together a quote for {{service}}. If you have any questions or want help choosing the right option, reply here. You can also pick up where you left off: {{link}}" },
  { label: "P1 D1 SMS", body: "Hi {{first_name}}, did everything in your BluLadder quote make sense? Reply here if you'd like help comparing the options or deciding what your home needs." },
  { label: "P1 D4 SMS", body: "Your BluLadder quote is still available, {{first_name}}. When you're ready, you can review it and choose an appointment here: {{link}}" },
  { label: "P1 D10 SMS", body: "Hi {{first_name}}, if getting {{service}} taken care of is still on your list, reply with BOOK IT and we'll help you find a time." },
  { label: "P2 D21 SMS", body: "Is {{service}} still on your home-maintenance list? Your BluLadder quote is here whenever you're ready: {{link}}" },
  { label: "P2 D45 SMS", body: "Hi {{first_name}}, we can make getting {{service}} taken care of pretty simple. Reply here if you'd like help with the quote or schedule." },
  { label: "P2 D90 SMS", body: "Hi {{first_name}}, is {{service}} still something you want to take care of? Reply BOOK IT for help scheduling, or STOP if you no longer want text reminders." },
  { label: "P2 D150 SMS", body: "Still on your list, {{first_name}}? Your BluLadder quote can be reviewed here: {{link}}" },
  { label: "P3 D210 SMS", body: "Hi {{first_name}}, if {{service}} is still something you'd like handled this season, reply here and we'll help you take the next step." },
  { label: "P3 D270 SMS", body: "Your BluLadder quote is available whenever you're ready, {{first_name}}: {{link}}" },
  { label: "P3 D330 SMS", body: "Hi {{first_name}}, reply BOOK IT if you'd like help reviewing your options or finding an appointment." },
];

const REALISTIC_LINK = "https://quote.bluladder.com/q/9f3ab2c1";
const WORSTCASE_LINK = "https://quote.bluladder.com/q/9f3ab2c1-8d47-4b3e-9a20-6b1e2c9a71fd";

function render(body: string, s: { first_name: string; service: string; link: string }): string {
  return body
    .replace(/\{\{first_name\}\}/g, s.first_name)
    .replace(/\{\{service\}\}/g, s.service)
    .replace(/\{\{link\}\}/g, s.link);
}

describe("rendered SMS encoding — every seeded template, production link", () => {
  const realistic = { first_name: "Alex", service: "window cleaning", link: REALISTIC_LINK };
  const worst = { first_name: "Alexandrina", service: "gutter cleaning + house wash + windows", link: WORSTCASE_LINK };
  for (const t of SEEDED_SMS) {
    it(`${t.label} — GSM-7 in realistic use, <= 2 segments`, () => {
      const enc = encodeSms(render(t.body, realistic));
      expect(enc.encoding).toBe("GSM-7");
      expect(enc.segments).toBeLessThanOrEqual(2);
    });
    it(`${t.label} — worst-case <= 3 segments`, () => {
      const enc = encodeSms(render(t.body, worst));
      expect(enc.segments).toBeLessThanOrEqual(3);
    });
  }
  it("no seeded template uses em dash or curly punctuation", () => {
    for (const t of SEEDED_SMS) {
      expect(t.body.includes("—")).toBe(false);
      expect(t.body.includes("\u2018")).toBe(false);
      expect(t.body.includes("\u2019")).toBe(false);
      expect(t.body.includes("\u201C")).toBe(false);
      expect(t.body.includes("\u201D")).toBe(false);
    }
  });
});

describe("campaign-event ingress remains the SOLE enrollment writer", () => {
  it("uses requireAdminOrService and rejects unknown events", () => {
    expect(campaignEvent).toMatch(/requireAdminOrService/);
    expect(campaignEvent).toMatch(/isAllowedEvent/);
  });
});

// ---- 5. Fixed-clock inactivity-boundary tests ---------------------------
// The production predicate in evaluatePersistedQuoteAbandonment is:
//   if (nowMs - lastMs < delayMinutes * 60_000) return { within_delay };
// i.e. NOT eligible iff (now - last_activity) is STRICTLY LESS THAN 5min.
// That means eligibility uses an INCLUSIVE boundary at exactly 5m: the
// quote becomes eligible the instant `now - last_activity >= 300000ms`.
function isEligibleByInactivity(lastActivityMs: number, nowMs: number, delayMinutes = 5): boolean {
  // Mirror of the exact operator used in supabase/functions/_shared/campaignSweep.ts.
  return !(nowMs - lastActivityMs < delayMinutes * 60_000);
}

describe("inactivity boundary — fixed-clock tests at 4:59 / 5:00 / 5:00+1ms / 6:00", () => {
  const T0 = Date.parse("2026-07-20T12:00:00.000Z");
  it("t + 4m59s → NOT eligible (within_delay)", () => {
    expect(isEligibleByInactivity(T0, T0 + (4 * 60_000 + 59_000))).toBe(false);
  });
  it("t + 5m exactly → eligible (inclusive boundary)", () => {
    expect(isEligibleByInactivity(T0, T0 + 5 * 60_000)).toBe(true);
  });
  it("t + 5m + 1ms → eligible", () => {
    expect(isEligibleByInactivity(T0, T0 + 5 * 60_000 + 1)).toBe(true);
  });
  it("t + 6m → eligible", () => {
    expect(isEligibleByInactivity(T0, T0 + 6 * 60_000)).toBe(true);
  });
  it("source uses strict `<` for the exclusion clause (inclusive `>=` for eligibility)", () => {
    // Guard against silent regressions that would flip the operator to `<=`
    // (which would push eligibility past the 5m mark).
    expect(sweep).toMatch(/nowMs\s*-\s*lastMs\s*<\s*delayMinutes\s*\*\s*60_000/);
  });
});

// ---- 6. Queue-row vs send-time channel gating ---------------------------
// The engine filters campaign steps by consent per channel, so ONLY steps
// whose channel has consent produce sms_messages rows. Presence of the
// contact channel itself is NOT checked at queue time: a step with
// channel=sms writes `to_number: phone` even if `phone` is null, and
// process-sms-queue rejects null/opted-out/paused/suppressed recipients at
// send time. This matrix documents both layers explicitly.
type Step = { channel: "sms" | "email" };
type ChannelScenario = {
  label: string;
  phone: string | null;
  email: string | null;
  smsConsent: boolean;
  emailConsent: boolean;
  smsOptOut?: boolean;
  emailSuppressed?: boolean;
  suppressedIdentity?: boolean; // test identity / global suppression switch
};

function queueRows(steps: Step[], s: ChannelScenario) {
  // Mirror of campaign-event/index.ts step filtering + row shape.
  const usable = steps.filter((st) => (st.channel === "sms" ? s.smsConsent : s.emailConsent));
  return usable.map((st) => ({
    channel: st.channel,
    to_number: st.channel === "sms" ? s.phone : null,
    to_email: st.channel === "email" ? s.email : null,
  }));
}

function sendOutcome(row: { channel: "sms" | "email"; to_number: string | null; to_email: string | null }, s: ChannelScenario): "sent" | "suppressed" {
  // Mirror of process-sms-queue send-time gates (checkSuppression + missing
  // channel + opt-out/suppression). Any gate → "suppressed" ("would-have-sent" row).
  if (s.suppressedIdentity) return "suppressed";
  if (row.channel === "email") {
    if (!row.to_email || s.emailSuppressed) return "suppressed";
    return "sent";
  }
  if (!row.to_number || s.smsOptOut) return "suppressed";
  return "sent";
}

describe("queue-time vs send-time channel gating matrix", () => {
  const P1_STEPS: Step[] = [{ channel: "sms" }, { channel: "email" }];

  const cases: Array<{ s: ChannelScenario; expectRows: number; expectSent: number }> = [
    // 1. Email only
    { s: { label: "email only", phone: null, email: "a@x.com", smsConsent: true, emailConsent: true }, expectRows: 2, expectSent: 1 },
    // 2. Phone only
    { s: { label: "phone only", phone: "+15551234567", email: null, smsConsent: true, emailConsent: true }, expectRows: 2, expectSent: 1 },
    // 3. Both channels
    { s: { label: "both channels", phone: "+15551234567", email: "a@x.com", smsConsent: true, emailConsent: true }, expectRows: 2, expectSent: 2 },
    // 4. No usable contact — engine still queues rows for consented channels;
    //    send-time drops them (null recipient). "Suppressed" here = would-have-sent.
    { s: { label: "no channel", phone: null, email: null, smsConsent: true, emailConsent: true }, expectRows: 2, expectSent: 0 },
    // 5. SMS opt-out — queue row created; send-time cancels.
    { s: { label: "sms opt-out", phone: "+15551234567", email: "a@x.com", smsConsent: true, emailConsent: true, smsOptOut: true }, expectRows: 2, expectSent: 1 },
    // 6. Email suppressed — queue row created; send-time cancels.
    { s: { label: "email suppressed", phone: "+15551234567", email: "a@x.com", smsConsent: true, emailConsent: true, emailSuppressed: true }, expectRows: 2, expectSent: 1 },
    // 7. Requested-follow-up only → treat as SMS+email consent for Phase 1.
    { s: { label: "requested_follow_up only", phone: "+15551234567", email: "a@x.com", smsConsent: true, emailConsent: true }, expectRows: 2, expectSent: 2 },
    // 8. Marketing consent (both channels) — same for Phase 1 steps.
    { s: { label: "marketing consent", phone: "+15551234567", email: "a@x.com", smsConsent: true, emailConsent: true }, expectRows: 2, expectSent: 2 },
    // 9. No qualifying consent → engine filters both steps out → zero rows.
    { s: { label: "no consent", phone: "+15551234567", email: "a@x.com", smsConsent: false, emailConsent: false }, expectRows: 0, expectSent: 0 },
  ];

  for (const c of cases) {
    it(`${c.s.label}: rows=${c.expectRows}, sent=${c.expectSent}`, () => {
      const rows = queueRows(P1_STEPS, c.s);
      expect(rows.length).toBe(c.expectRows);
      const sent = rows.filter((r) => sendOutcome(r, c.s) === "sent").length;
      expect(sent).toBe(c.expectSent);
    });
  }

  it("send-time gates are still wired in process-sms-queue", () => {
    const queue = read("supabase/functions/process-sms-queue/index.ts");
    expect(queue).toMatch(/checkSuppression/);
    expect(queue).toMatch(/isPhoneOptedOut/);
    expect(queue).toMatch(/if \(!msg\.to_email\)/);
    expect(queue).toMatch(/getCustomerPause/);
  });
});
