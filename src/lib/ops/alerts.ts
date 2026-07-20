// Pure anomaly detection + digest formatting on top of computeHealth().
// No I/O — safe to unit-test and to import from edge functions via a mirrored
// copy under supabase/functions/_shared/.
import type { HealthMetrics } from "./health";

export type AlertSeverity = "info" | "warning" | "critical";

export interface OpsAlert {
  /** Stable key so repeated detections dedupe in system_issues. */
  dedupeKey: string;
  issueType: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export interface AlertThresholds {
  failedDeliveryWarn: number;      // failed sms+email in last 24h
  failedDeliveryCritical: number;
  oldestQueuedWarnMin: number;     // pending sms age
  oldestQueuedCriticalMin: number;
  campaignBacklogWarn: number;
  humanEscalationsWarn: number;
  waitingWarn: number;
  zeroQuotesHoursCritical: number; // reserved for future
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  failedDeliveryWarn: 5,
  failedDeliveryCritical: 20,
  oldestQueuedWarnMin: 15,
  oldestQueuedCriticalMin: 60,
  campaignBacklogWarn: 100,
  humanEscalationsWarn: 5,
  waitingWarn: 10,
  zeroQuotesHoursCritical: 24,
};

export function detectAnomalies(
  m: HealthMetrics,
  t: AlertThresholds = DEFAULT_THRESHOLDS,
): OpsAlert[] {
  const alerts: OpsAlert[] = [];

  if (m.failedDeliveryLast24h >= t.failedDeliveryCritical) {
    alerts.push({
      dedupeKey: "ops.delivery_failures",
      issueType: "ops.delivery_failures",
      severity: "critical",
      title: "High message delivery failure rate",
      detail: `${m.failedDeliveryLast24h} failed messages in the last 24h (sms=${m.failedSms}, email=${m.failedEmail}). Check provider status and suppression lists.`,
    });
  } else if (m.failedDeliveryLast24h >= t.failedDeliveryWarn) {
    alerts.push({
      dedupeKey: "ops.delivery_failures",
      issueType: "ops.delivery_failures",
      severity: "warning",
      title: "Elevated message delivery failures",
      detail: `${m.failedDeliveryLast24h} failed messages in the last 24h (sms=${m.failedSms}, email=${m.failedEmail}).`,
    });
  }

  if (m.oldestQueuedAgeMinutes !== null) {
    if (m.oldestQueuedAgeMinutes >= t.oldestQueuedCriticalMin) {
      alerts.push({
        dedupeKey: "ops.queue_stalled",
        issueType: "ops.queue_stalled",
        severity: "critical",
        title: "SMS queue appears stalled",
        detail: `Oldest pending SMS is ${m.oldestQueuedAgeMinutes} minutes old. Check process-sms-queue cron.`,
      });
    } else if (m.oldestQueuedAgeMinutes >= t.oldestQueuedWarnMin) {
      alerts.push({
        dedupeKey: "ops.queue_stalled",
        issueType: "ops.queue_stalled",
        severity: "warning",
        title: "SMS queue lagging",
        detail: `Oldest pending SMS is ${m.oldestQueuedAgeMinutes} minutes old.`,
      });
    }
  }

  if (m.campaignQueueBacklog >= t.campaignBacklogWarn) {
    alerts.push({
      dedupeKey: "ops.campaign_backlog",
      issueType: "ops.campaign_backlog",
      severity: "warning",
      title: "Campaign SMS backlog building up",
      detail: `${m.campaignQueueBacklog} campaign SMS pending.`,
    });
  }

  if (m.humanEscalations >= t.humanEscalationsWarn) {
    alerts.push({
      dedupeKey: "ops.human_escalations",
      issueType: "ops.human_escalations",
      severity: "warning",
      title: "Human escalation queue growing",
      detail: `${m.humanEscalations} active conversations under staff takeover.`,
    });
  }

  if (m.waitingForResponse >= t.waitingWarn) {
    alerts.push({
      dedupeKey: "ops.waiting_response",
      issueType: "ops.waiting_response",
      severity: "info",
      title: "Conversations waiting on a reply",
      detail: `${m.waitingForResponse} conversations flagged as needing attention.`,
    });
  }

  return alerts;
}

export interface DigestInput {
  metrics: HealthMetrics;
  alerts: OpsAlert[];
  windowLabel: string; // "last 24h" / "yesterday"
  generatedAt: Date;
}

export function buildDigestText(input: DigestInput): string {
  const m = input.metrics;
  const lines = [
    `BluLadder Ops Digest — ${input.windowLabel}`,
    `Generated ${input.generatedAt.toISOString()}`,
    ``,
    `Quotes today:            ${m.quotesToday}`,
    `Bookings today:          ${m.bookingsToday}`,
    `Conversion rate:         ${(m.conversionRate * 100).toFixed(0)}%`,
    `Conversations today:     ${m.conversationsToday}`,
    `  AI-handled (active):   ${m.aiHandled}`,
    `  Under staff takeover:  ${m.humanEscalations}`,
    `  Waiting on response:   ${m.waitingForResponse}`,
    ``,
    `Delivery failures (24h): ${m.failedDeliveryLast24h} (sms=${m.failedSms}, email=${m.failedEmail})`,
    `Campaign backlog:        ${m.campaignQueueBacklog}`,
    `Oldest queued SMS:       ${m.oldestQueuedAgeMinutes === null ? "none" : `${m.oldestQueuedAgeMinutes} min`}`,
  ];
  if (input.alerts.length) {
    lines.push("", "Active anomalies:");
    for (const a of input.alerts) {
      lines.push(`  • [${a.severity.toUpperCase()}] ${a.title} — ${a.detail}`);
    }
  } else {
    lines.push("", "No anomalies detected.");
  }
  return lines.join("\n");
}

export function buildDigestHtml(input: DigestInput): string {
  const escape = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const m = input.metrics;
  const row = (label: string, value: string | number) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#4a5568">${escape(label)}</td><td style="padding:4px 0;font-weight:600">${escape(String(value))}</td></tr>`;
  const alertList = input.alerts.length
    ? `<ul style="padding-left:18px;margin:8px 0">${input.alerts.map((a) =>
        `<li style="margin:6px 0"><strong style="color:${a.severity === "critical" ? "#c53030" : a.severity === "warning" ? "#c05621" : "#2b6cb0"}">${escape(a.severity.toUpperCase())}</strong> — ${escape(a.title)}<br><span style="color:#4a5568">${escape(a.detail)}</span></li>`,
      ).join("")}</ul>`
    : `<p style="color:#2f855a;margin:8px 0">No anomalies detected.</p>`;
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1a202c">
    <h2 style="margin:0 0 4px 0">BluLadder Ops Digest</h2>
    <p style="margin:0 0 12px 0;color:#4a5568">${escape(input.windowLabel)} — generated ${escape(input.generatedAt.toISOString())}</p>
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