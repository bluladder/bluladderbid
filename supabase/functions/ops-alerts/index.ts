// ops-alerts — anomaly detection + daily digest for BluLadder Bid ops.
//
// Modes (POST body { mode }):
//   "preview"  — compute metrics + alerts + digest, return them. No writes, no sends.
//   "check"    — compute + upsert into system_issues, dispatch SMS/email through
//                the existing escalation channel for NEW/high-severity issues
//                that exceed the cooldown window. Idempotent by dedupe_key.
//   "digest"   — send the daily digest email to escalation recipients.
//
// Auth: admin JWT OR shared cron header (OPS_ALERTS_CRON_SECRET) so pg_cron can
// invoke it without a user. Never sends any customer-visible message.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAdmin, getBearer } from "../_shared/auth.ts";
import {
  computeHealth, detectAnomalies, buildDigestText, buildDigestHtml,
  DEFAULT_THRESHOLDS, type OpsAlert,
} from "../_shared/opsAlerts.ts";
import { sendEmail } from "../_shared/emailConfig.ts";
import { checkSuppression } from "../_shared/suppression.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ops-cron",
};
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // re-alert same issue at most every 6h

async function authorize(req: Request): Promise<{ ok: boolean; via: "admin" | "cron" | null }> {
  const cronSecret = Deno.env.get("OPS_ALERTS_CRON_SECRET");
  const supplied = req.headers.get("x-ops-cron");
  if (cronSecret && supplied && supplied === cronSecret) return { ok: true, via: "cron" };
  const adminId = await verifyAdmin(getBearer(req), "operations_admin");
  if (adminId) return { ok: true, via: "admin" };
  return { ok: false, via: null };
}

// deno-lint-ignore no-explicit-any
async function loadCanonicalRows(sb: any) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [c, q, b, s] = await Promise.all([
    sb.from("chat_conversations")
      .select("id, staff_takeover_at, needs_attention, last_activity_at, last_error, resolved, booking_status")
      .gte("last_activity_at", startOfDay.toISOString()).limit(2000),
    sb.from("quotes").select("id, status, saved_at, converted_at, superseded_at")
      .gte("saved_at", startOfDay.toISOString()).limit(2000),
    sb.from("bookings").select("id, status, created_at, booking_completed_at, cancelled_at")
      .gte("created_at", startOfDay.toISOString()).limit(2000),
    sb.from("sms_messages")
      .select("id, channel, status, message_kind, created_at, sent_at, send_at, error")
      .gte("created_at", dayAgo.toISOString()).limit(5000),
  ]);
  return {
    conversations: c.data ?? [], quotes: q.data ?? [], bookings: b.data ?? [], sms: s.data ?? [],
    errors: [c.error, q.error, b.error, s.error].filter(Boolean).map((e) => e!.message),
  };
}

// deno-lint-ignore no-explicit-any
async function upsertIssues(sb: any, alerts: OpsAlert[]): Promise<Array<{ alert: OpsAlert; shouldAlert: boolean }>> {
  const now = new Date();
  const results: Array<{ alert: OpsAlert; shouldAlert: boolean }> = [];
  for (const a of alerts) {
    const { data: existing } = await sb.from("system_issues")
      .select("id, occurrence_count, last_alerted_at, severity, status")
      .eq("dedupe_key", a.dedupeKey).maybeSingle();
    if (existing) {
      const severityChanged = existing.severity !== a.severity;
      const cooledDown = !existing.last_alerted_at
        || (now.getTime() - new Date(existing.last_alerted_at).getTime()) >= ALERT_COOLDOWN_MS;
      const shouldAlert = existing.status === "open" && (severityChanged || cooledDown);
      await sb.from("system_issues").update({
        issue_type: a.issueType, severity: a.severity,
        last_seen_at: now.toISOString(),
        occurrence_count: (existing.occurrence_count ?? 0) + 1,
        details: { title: a.title, detail: a.detail },
        suggested_action: a.detail,
        status: existing.status === "resolved" ? "open" : existing.status,
      }).eq("id", existing.id);
      results.push({ alert: a, shouldAlert });
    } else {
      await sb.from("system_issues").insert({
        issue_type: a.issueType, dedupe_key: a.dedupeKey, severity: a.severity,
        details: { title: a.title, detail: a.detail }, suggested_action: a.detail, status: "open",
      });
      results.push({ alert: a, shouldAlert: true });
    }
  }
  return results;
}

// deno-lint-ignore no-explicit-any
async function dispatchAlerts(sb: any, toAlert: OpsAlert[]): Promise<{ smsQueued: number; emailSent: number; skipped: string[] }> {
  const skipped: string[] = [];
  if (!toAlert.length) return { smsQueued: 0, emailSent: 0, skipped };

  const { data: settings } = await sb.from("escalation_settings").select("*").eq("singleton", true).maybeSingle();
  if (!settings?.internal_alerts_enabled) {
    skipped.push("internal_alerts_disabled"); return { smsQueued: 0, emailSent: 0, skipped };
  }
  const { data: recipients } = await sb.from("escalation_recipients").select("*").eq("is_enabled", true);
  const pick = (recipients ?? []).sort((a: { role?: string }, b: { role?: string }) =>
    (a.role === "primary" ? -1 : 1) - (b.role === "primary" ? -1 : 1));

  const highest = toAlert.reduce((acc, a) => (a.severity === "critical" ? "critical" : acc), "warning" as string);
  const body = ["BluLadder Ops Alert", ...toAlert.map((a) => `• [${a.severity.toUpperCase()}] ${a.title} — ${a.detail}`)].join("\n").slice(0, 900);

  let smsQueued = 0, emailSent = 0;
  for (const r of pick) {
    if (r.phone) {
      const sup = await checkSuppression(sb, { phone: r.phone });
      if (!sup.suppressed) {
        const { error } = await sb.from("sms_messages").insert({
          to_number: r.phone, body, message_kind: "internal_escalation",
          status: "pending", send_at: new Date().toISOString(),
        });
        if (!error) smsQueued++;
      }
    }
    const emailTarget = r.email || settings.notify_email || null;
    if (settings.email_alerts_enabled && emailTarget) {
      const sup = await checkSuppression(sb, { email: emailTarget });
      if (!sup.suppressed) {
        const res = await sendEmail({
          to: emailTarget,
          subject: `BluLadder Ops Alert (${highest}) — ${toAlert.length} issue${toAlert.length === 1 ? "" : "s"}`,
          html: `<pre style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}</pre>`,
          fromNameOverride: "BluLadder Ops",
        });
        if (res.ok) emailSent++;
      }
    }
  }
  const now = new Date().toISOString();
  for (const a of toAlert) {
    await sb.from("system_issues").update({ last_alerted_at: now }).eq("dedupe_key", a.dedupeKey);
  }
  return { smsQueued, emailSent, skipped };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const auth = await authorize(req);
  if (!auth.ok) return j({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({})) as { mode?: "preview" | "check" | "digest"; test_email?: string };
  const mode = body.mode ?? "preview";

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rows = await loadCanonicalRows(sb);
  const metrics = computeHealth(rows);
  const alerts = detectAnomalies(metrics, DEFAULT_THRESHOLDS);
  const now = new Date();

  if (mode === "preview") {
    return j({
      metrics, alerts,
      digest_text: buildDigestText(metrics, alerts, "last 24h", now),
      load_errors: rows.errors,
    });
  }

  if (mode === "check") {
    const upserts = await upsertIssues(sb, alerts);
    const toAlert = upserts.filter((u) => u.shouldAlert).map((u) => u.alert);
    const dispatch = await dispatchAlerts(sb, toAlert);
    return j({
      metrics, alerts, dispatched: toAlert.map((a) => a.dedupeKey),
      sms_queued: dispatch.smsQueued, email_sent: dispatch.emailSent, skipped: dispatch.skipped,
    });
  }

  if (mode === "digest") {
    const { data: settings } = await sb.from("escalation_settings").select("*").eq("singleton", true).maybeSingle();
    const { data: recipients } = await sb.from("escalation_recipients").select("email, is_enabled");
    const targets = new Set<string>();
    if (body.test_email) targets.add(body.test_email);
    else {
      if (settings?.notify_email) targets.add(settings.notify_email);
      for (const r of recipients ?? []) if (r.is_enabled && r.email) targets.add(r.email);
    }
    if (!targets.size) return j({ error: "no_digest_recipients" }, 400);

    const html = buildDigestHtml(metrics, alerts, "last 24h", now);
    const text = buildDigestText(metrics, alerts, "last 24h", now);
    const results: Record<string, string> = {};
    for (const to of targets) {
      const sup = await checkSuppression(sb, { email: to });
      if (sup.suppressed) { results[to] = `suppressed:${sup.reason ?? "unknown"}`; continue; }
      const r = await sendEmail({ to, subject: "BluLadder Ops Digest — last 24h", html, fromNameOverride: "BluLadder Ops" });
      results[to] = r.ok ? "sent" : (r.failure?.message ?? "failed");
    }
    return j({ metrics_summary: { quotes: metrics.quotesToday, bookings: metrics.bookingsToday, alerts: alerts.length }, digest_preview: text.slice(0, 400), results });
  }

  return j({ error: "invalid_mode" }, 400);
});