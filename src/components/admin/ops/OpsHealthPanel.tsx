import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  computeHealth, type HealthMetrics,
  type ConversationRow, type QuoteRow, type BookingRow, type SmsRow,
} from "@/lib/ops/health";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Mail, MessageSquare,
  RefreshCw, TrendingUp, Users,
} from "lucide-react";

function Stat({
  label, value, hint, tone = "default", icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "good" ? "text-emerald-600"
    : tone === "warn" ? "text-amber-600"
    : tone === "bad" ? "text-destructive"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className={`text-2xl font-semibold mt-1 ${toneCls}`}>{value}</div>
            {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
          </div>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function toneForFailures(n: number): "default" | "warn" | "bad" {
  if (n === 0) return "default";
  if (n < 5) return "warn";
  return "bad";
}

function toneForQueueAge(mins: number | null): "default" | "warn" | "bad" {
  if (mins == null) return "default";
  if (mins > 30) return "bad";
  if (mins > 10) return "warn";
  return "default";
}

export function OpsHealthPanel() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    const startOfDayIso = (() => {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      return d.toISOString();
    })();
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [convosR, quotesR, bookingsR, smsR] = await Promise.all([
      supabase.from("chat_conversations")
        .select("id, staff_takeover_at, needs_attention, last_activity_at, last_error, resolved, booking_status")
        .gte("last_activity_at", startOfDayIso)
        .limit(1000),
      supabase.from("quotes")
        .select("id, status, saved_at, converted_at, superseded_at")
        .gte("saved_at", startOfDayIso)
        .limit(1000),
      supabase.from("bookings")
        .select("id, status, created_at, booking_completed_at, cancelled_at")
        .gte("created_at", startOfDayIso)
        .limit(1000),
      supabase.from("sms_messages")
        .select("id, channel, status, message_kind, created_at, sent_at, send_at, error")
        .gte("created_at", dayAgoIso)
        .limit(2000),
    ]);

    const errs: string[] = [];
    if (convosR.error) errs.push(`Conversations: ${convosR.error.message}`);
    if (quotesR.error) errs.push(`Quotes: ${quotesR.error.message}`);
    if (bookingsR.error) errs.push(`Bookings: ${bookingsR.error.message}`);
    if (smsR.error) errs.push(`SMS/Email: ${smsR.error.message}`);
    if (errs.length) setErrors(errs);

    const m = computeHealth({
      conversations: (convosR.data ?? []) as ConversationRow[],
      quotes: (quotesR.data ?? []) as QuoteRow[],
      bookings: (bookingsR.data ?? []) as BookingRow[],
      sms: (smsR.data ?? []) as SmsRow[],
    });
    setMetrics(m);
    setRefreshedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const refresh = () => { load().catch((e) => toast.error(String(e))); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Operational Health</h2>
          <p className="text-xs text-muted-foreground">
            Read-only view over existing canonical data. Refreshes every 60s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {refreshedAt.toLocaleTimeString()}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Some sources failed to load
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </CardContent>
        </Card>
      )}

      {metrics && (
        <>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Today
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Conversations" value={metrics.conversationsToday}
                icon={<MessageSquare className="w-4 h-4" />} />
              <Stat label="Quotes" value={metrics.quotesToday}
                icon={<Activity className="w-4 h-4" />} />
              <Stat label="Bookings" value={metrics.bookingsToday}
                icon={<CheckCircle2 className="w-4 h-4" />}
                tone={metrics.bookingsToday > 0 ? "good" : "default"} />
              <Stat label="Conversion" value={`${Math.round(metrics.conversionRate * 100)}%`}
                icon={<TrendingUp className="w-4 h-4" />}
                hint={metrics.quotesToday === 0 ? "No quotes yet today" : undefined} />
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Conversations right now
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Stat label="AI handling" value={metrics.aiHandled}
                icon={<Users className="w-4 h-4" />} />
              <Stat label="Human escalations" value={metrics.humanEscalations}
                icon={<AlertTriangle className="w-4 h-4" />}
                tone={metrics.humanEscalations > 0 ? "warn" : "default"} />
              <Stat label="Waiting for response" value={metrics.waitingForResponse}
                icon={<Clock className="w-4 h-4" />} />
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Delivery (last 24h)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Failed SMS" value={metrics.failedSms}
                icon={<MessageSquare className="w-4 h-4" />}
                tone={toneForFailures(metrics.failedSms)} />
              <Stat label="Failed email" value={metrics.failedEmail}
                icon={<Mail className="w-4 h-4" />}
                tone={toneForFailures(metrics.failedEmail)} />
              <Stat
                label="Oldest queued"
                value={metrics.oldestQueuedAgeMinutes == null
                  ? "—"
                  : `${metrics.oldestQueuedAgeMinutes}m`}
                icon={<Clock className="w-4 h-4" />}
                tone={toneForQueueAge(metrics.oldestQueuedAgeMinutes)}
                hint="Age of oldest pending outbound" />
              <Stat label="Campaign queue backlog" value={metrics.campaignQueueBacklog}
                tone={metrics.campaignQueueBacklog > 20 ? "warn" : "default"} />
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">External integrations</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Jobber sync freshness</span>
                <Badge variant="outline">See Integrations tab</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Availability mirror freshness</span>
                <Badge variant="outline">See Scheduling tab</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">CallRail webhook health</span>
                <Badge variant="outline">Surface via Conversations → failed delivery</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">AI provider errors / cost</span>
                <Badge variant="outline">Analytics tab</Badge>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                Existing surfaces stay canonical. This dashboard does not duplicate their charts;
                it links back to them.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}