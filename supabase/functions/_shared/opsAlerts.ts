// Deno mirror of src/lib/ops/alerts.ts kept intentionally identical so the
// ops-alerts edge function shares the same anomaly logic the admin UI uses.
// If you change one, change the other.

export type AlertSeverity = "info" | "warning" | "critical";

export interface HealthMetrics {
  conversationsToday: number;
  quotesToday: number;
  bookingsToday: number;
  conversionRate: number;
  aiHandled: number;
  humanEscalations: number;
  waitingForResponse: number;
  failedSms: number;
  failedEmail: number;
  oldestQueuedAgeMinutes: number | null;
  campaignQueueBacklog: number;
  failedDeliveryLast24h: number;
}

export interface OpsAlert {
  dedupeKey: string;
  issueType: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export interface AlertThresholds {
  failedDeliveryWarn: number;
  failedDeliveryCritical: number;
  oldestQueuedWarnMin: number;
  oldestQueuedCriticalMin: number;
  campaignBacklogWarn: number;
  humanEscalationsWarn: number;
  waitingWarn: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  failedDeliveryWarn: 5,
  failedDeliveryCritical: 20,
  oldestQueuedWarnMin: 15,
  oldestQueuedCriticalMin: 60,
  campaignBacklogWarn: 100,
  humanEscalationsWarn: 5,
  waitingWarn: 10,
};

export function detectAnomalies(m: HealthMetrics, t: AlertThresholds = DEFAULT_THRESHOLDS): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  if (m.failedDeliveryLast24h >= t.failedDeliveryCritical) {
    alerts.push({ dedupeKey: "ops.delivery_failures", issueType: "ops.delivery_failures", severity: "critical",
      title: "High message delivery failure rate",
      detail: `${m.failedDeliveryLast24h} failed messages in 24h (sms=${m.failedSms}, email=${m.failedEmail}).` });
  } else if (m.failedDeliveryLast24h >= t.failedDeliveryWarn) {
    alerts.push({ dedupeKey: "ops.delivery_failures", issueType: "ops.delivery_failures", severity: "warning",
      title: "Elevated message delivery failures",
      detail: `${m.failedDeliveryLast24h} failed messages in 24h (sms=${m.failedSms}, email=${m.failedEmail}).` });
  }
  if (m.oldestQueuedAgeMinutes !== null) {
    if (m.oldestQueuedAgeMinutes >= t.oldestQueuedCriticalMin) {
      alerts.push({ dedupeKey: "ops.queue_stalled", issueType: "ops.queue_stalled", severity: "critical",
        title: "SMS queue appears stalled",
        detail: `Oldest pending SMS is ${m.oldestQueuedAgeMinutes} minutes old.` });
    } else if (m.oldestQueuedAgeMinutes >= t.oldestQueuedWarnMin) {
      alerts.push({ dedupeKey: "ops.queue_stalled", issueType: "ops.queue_stalled", severity: "warning",
        title: "SMS queue lagging",
        detail: `Oldest pending SMS is ${m.oldestQueuedAgeMinutes} minutes old.` });
    }
  }
  if (m.campaignQueueBacklog >= t.campaignBacklogWarn) {
    alerts.push({ dedupeKey: "ops.campaign_backlog", issueType: "ops.campaign_backlog", severity: "warning",
      title: "Campaign SMS backlog building up",
      detail: `${m.campaignQueueBacklog} campaign SMS pending.` });
  }
  if (m.humanEscalations >= t.humanEscalationsWarn) {
    alerts.push({ dedupeKey: "ops.human_escalations", issueType: "ops.human_escalations", severity: "warning",
      title: "Human escalation queue growing",
      detail: `${m.humanEscalations} conversations under staff takeover.` });
  }
  if (m.waitingForResponse >= t.waitingWarn) {
    alerts.push({ dedupeKey: "ops.waiting_response", issueType: "ops.waiting_response", severity: "info",
      title: "Conversations waiting on a reply",
      detail: `${m.waitingForResponse} conversations need attention.` });
  }
  return alerts;
}

/** Aggregate raw canonical rows into HealthMetrics. Mirrors src/lib/ops/health.ts. */
// deno-lint-ignore no-explicit-any
export function computeHealth(input: { conversations: any[]; quotes: any[]; bookings: any[]; sms: any[]; now?: Date }): HealthMetrics {
  const now = input.now ?? new Date();
  const HOUR = 60 * 60 * 1000;
  const isToday = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const within = (iso: string | null, ms: number) => !!iso && now.getTime() - new Date(iso).getTime() <= ms;

  const quotesToday = input.quotes.filter((q) => isToday(q.saved_at) && !q.superseded_at).length;
  const bookingsToday = input.bookings.filter((b) => isToday(b.booking_completed_at ?? b.created_at) && b.status !== "cancelled").length;
  const conversationsToday = input.conversations.filter((c) => isToday(c.last_activity_at)).length;
  const conversionRate = quotesToday > 0 ? Math.round((bookingsToday / quotesToday) * 100) / 100 : 0;
  const aiHandled = input.conversations.filter((c) => !c.staff_takeover_at && !c.resolved && within(c.last_activity_at, 24 * HOUR)).length;
  const humanEscalations = input.conversations.filter((c) => !!c.staff_takeover_at && !c.resolved).length;
  const waitingForResponse = input.conversations.filter((c) => !c.resolved && (c.needs_attention === true || c.booking_status === "scheduling")).length;
  const failedIn = (channel: string) => input.sms.filter((m) => (m.channel ?? "sms") === channel && (m.status === "failed" || m.status === "dlq") && within(m.created_at, 24 * HOUR)).length;
  const failedSms = failedIn("sms");
  const failedEmail = failedIn("email");
  const pending = input.sms.filter((m) => m.status === "pending");
  const oldestQueuedAgeMinutes = pending.length
    ? Math.floor((now.getTime() - Math.min(...pending.map((m) => new Date(m.send_at ?? m.created_at).getTime()))) / 60000)
    : null;
  const campaignQueueBacklog = input.sms.filter((m) => m.status === "pending" && m.message_kind === "campaign").length;
  return {
    conversationsToday, quotesToday, bookingsToday, conversionRate,
    aiHandled, humanEscalations, waitingForResponse,
    failedSms, failedEmail, oldestQueuedAgeMinutes, campaignQueueBacklog,
    failedDeliveryLast24h: failedSms + failedEmail,
  };
}

export function buildDigestText(m: HealthMetrics, alerts: OpsAlert[], windowLabel: string, generatedAt: Date): string {
  const lines = [
    `BluLadder Ops Digest — ${windowLabel}`,
    `Generated ${generatedAt.toISOString()}`, ``,
    `Quotes today:            ${m.quotesToday}`,
    `Bookings today:          ${m.bookingsToday}`,
    `Conversion rate:         ${(m.conversionRate * 100).toFixed(0)}%`,
    `Conversations today:     ${m.conversationsToday}`,
    `  AI-handled (active):   ${m.aiHandled}`,
    `  Under staff takeover:  ${m.humanEscalations}`,
    `  Waiting on response:   ${m.waitingForResponse}`, ``,
    `Delivery failures (24h): ${m.failedDeliveryLast24h} (sms=${m.failedSms}, email=${m.failedEmail})`,
    `Campaign backlog:        ${m.campaignQueueBacklog}`,
    `Oldest queued SMS:       ${m.oldestQueuedAgeMinutes === null ? "none" : `${m.oldestQueuedAgeMinutes} min`}`,
  ];
  if (alerts.length) {
    lines.push("", "Active anomalies:");
    for (const a of alerts) lines.push(`  • [${a.severity.toUpperCase()}] ${a.title} — ${a.detail}`);
  } else {
    lines.push("", "No anomalies detected.");
  }
  return lines.join("\n");
}

export function buildDigestHtml(m: HealthMetrics, alerts: OpsAlert[], windowLabel: string, generatedAt: Date): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const row = (l: string, v: string | number) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#4a5568">${esc(l)}</td><td style="padding:4px 0;font-weight:600">${esc(String(v))}</td></tr>`;
  const alertList = alerts.length
    ? `<ul style="padding-left:18px;margin:8px 0">${alerts.map((a) =>
        `<li style="margin:6px 0"><strong style="color:${a.severity === "critical" ? "#c53030" : a.severity === "warning" ? "#c05621" : "#2b6cb0"}">${esc(a.severity.toUpperCase())}</strong> — ${esc(a.title)}<br><span style="color:#4a5568">${esc(a.detail)}</span></li>`).join("")}</ul>`
    : `<p style="color:#2f855a;margin:8px 0">No anomalies detected.</p>`;
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1a202c">
    <h2 style="margin:0 0 4px 0">BluLadder Ops Digest</h2>
    <p style="margin:0 0 12px 0;color:#4a5568">${esc(windowLabel)} — generated ${esc(generatedAt.toISOString())}</p>
    <table style="border-collapse:collapse">
      ${row("Quotes today", m.quotesToday)}
      ${row("Bookings today", m.bookingsToday)}
      ${row("Conversion rate", `${(m.conversionRate * 100).toFixed(0)}%`)}
      ${row("Conversations today", m.conversationsToday)}
      ${row("AI-handled (active)", m.aiHandled)}
      ${row("Under staff takeover", m.humanEscalations)}
      ${row("Waiting on response", m.waitingForResponse)}
      ${row("Delivery failures (24h)", `${m.failedDeliveryLast24h} (sms=${m.failedSms}, email=${m.failedEmail})`)}
      ${row("Campaign backlog", m.campaignQueueBacklog)}
      ${row("Oldest queued SMS", m.oldestQueuedAgeMinutes === null ? "none" : `${m.oldestQueuedAgeMinutes} min`)}
    </table>
    ${alertList}
  </div>`;
}