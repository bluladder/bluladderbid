import { describe, it, expect } from "vitest";
import { detectAnomalies, buildDigestText, DEFAULT_THRESHOLDS } from "./alerts";
import type { HealthMetrics } from "./health";

const base: HealthMetrics = {
  conversationsToday: 0,
  quotesToday: 0,
  bookingsToday: 0,
  conversionRate: 0,
  aiHandled: 0,
  humanEscalations: 0,
  waitingForResponse: 0,
  failedSms: 0,
  failedEmail: 0,
  oldestQueuedAgeMinutes: null,
  campaignQueueBacklog: 0,
  failedDeliveryLast24h: 0,
};

describe("detectAnomalies", () => {
  it("returns no alerts on a healthy snapshot", () => {
    expect(detectAnomalies(base)).toEqual([]);
  });

  it("escalates delivery failures to critical past the critical threshold", () => {
    const alerts = detectAnomalies({ ...base, failedSms: 15, failedEmail: 10, failedDeliveryLast24h: 25 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].dedupeKey).toBe("ops.delivery_failures");
  });

  it("flags stalled queue at critical when older than the critical threshold", () => {
    const alerts = detectAnomalies({ ...base, oldestQueuedAgeMinutes: DEFAULT_THRESHOLDS.oldestQueuedCriticalMin + 1 });
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].dedupeKey).toBe("ops.queue_stalled");
  });

  it("uses stable dedupe keys so repeated detection merges in system_issues", () => {
    const a = detectAnomalies({ ...base, humanEscalations: 20 });
    const b = detectAnomalies({ ...base, humanEscalations: 30 });
    expect(a[0].dedupeKey).toBe(b[0].dedupeKey);
  });
});

describe("buildDigestText", () => {
  it("includes core metrics and lists anomalies", () => {
    const alerts = detectAnomalies({ ...base, failedDeliveryLast24h: 6, failedSms: 6 });
    const txt = buildDigestText({
      metrics: { ...base, quotesToday: 3, bookingsToday: 1, conversionRate: 0.33, failedDeliveryLast24h: 6, failedSms: 6 },
      alerts,
      windowLabel: "last 24h",
      generatedAt: new Date("2026-07-20T15:00:00Z"),
    });
    expect(txt).toContain("Quotes today:");
    expect(txt).toContain("Active anomalies");
    expect(txt).toContain("delivery failures");
  });

  it("says 'no anomalies detected' when clean", () => {
    const txt = buildDigestText({
      metrics: base, alerts: [], windowLabel: "last 24h", generatedAt: new Date(),
    });
    expect(txt).toContain("No anomalies detected.");
  });
});