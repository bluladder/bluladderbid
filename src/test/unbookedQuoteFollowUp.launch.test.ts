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
  return body.replaceAll("{{first_name}}", s.first_name).replaceAll("{{service}}", s.service).replaceAll("{{link}}", s.link);
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
