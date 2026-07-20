import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, BellRing, Mail, Send, ShieldCheck } from "lucide-react";

type OpsAlert = {
  dedupeKey: string;
  issueType: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
};

type PreviewResponse = {
  alerts: OpsAlert[];
  digest_text: string;
  load_errors?: string[];
};

type OpenIssue = {
  id: string;
  issue_type: string;
  severity: string;
  status: string;
  occurrence_count: number;
  last_seen_at: string;
  last_alerted_at: string | null;
  suggested_action: string | null;
};

function severityBadge(sev: string) {
  const map: Record<string, string> = {
    critical: "bg-destructive text-destructive-foreground",
    warning: "bg-amber-500 text-white",
    info: "bg-blue-500 text-white",
  };
  return <Badge className={map[sev] ?? ""}>{sev}</Badge>;
}

export function OpsAlertsPanel() {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [testEmail, setTestEmail] = useState("");

  const loadIssues = useCallback(async () => {
    const { data, error } = await supabase
      .from("system_issues")
      .select("id, issue_type, severity, status, occurrence_count, last_seen_at, last_alerted_at, suggested_action")
      .like("issue_type", "ops.%")
      .eq("status", "open")
      .order("last_seen_at", { ascending: false })
      .limit(50);
    if (error) { toast.error(`Failed to load issues: ${error.message}`); return; }
    setIssues(data as OpenIssue[]);
  }, []);

  const invoke = useCallback(
    async (mode: "preview" | "check" | "digest", extra?: Record<string, unknown>) => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("ops-alerts", {
        body: { mode, ...(extra ?? {}) },
      });
      setLoading(false);
      if (error) {
        toast.error(`ops-alerts ${mode} failed: ${error.message}`);
        return null;
      }
      return data as any;
    },
    [],
  );

  const runPreview = async () => {
    const data = await invoke("preview");
    if (data) {
      setPreview(data as PreviewResponse);
      toast.success(`${(data.alerts?.length ?? 0)} anomal${(data.alerts?.length ?? 0) === 1 ? "y" : "ies"} detected`);
    }
  };

  const runCheck = async () => {
    const data = await invoke("check");
    if (data) {
      toast.success(
        `Check complete — dispatched ${data.dispatched?.length ?? 0}, SMS queued ${data.sms_queued ?? 0}, email sent ${data.email_sent ?? 0}`,
      );
      await loadIssues();
    }
  };

  const sendDigest = async () => {
    const data = await invoke("digest", testEmail ? { test_email: testEmail } : {});
    if (data) {
      const sent = Object.values(data.results ?? {}).filter((v) => v === "sent").length;
      toast.success(`Digest sent to ${sent} recipient${sent === 1 ? "" : "s"}`);
    }
  };

  useEffect(() => { loadIssues(); }, [loadIssues]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Alerts & Daily Digest</h2>
        <p className="text-xs text-muted-foreground">
          Detects anomalies on top of the Ops metrics, dedupes into system_issues,
          and dispatches through the existing escalation channel. Digest sends to
          configured escalation recipients (or a test address).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={runPreview} disabled={loading}>
          <ShieldCheck className="w-3 h-3 mr-1" /> Preview (no send)
        </Button>
        <Button size="sm" onClick={runCheck} disabled={loading}>
          <BellRing className="w-3 h-3 mr-1" /> Run check &amp; dispatch
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Input
            className="h-8 w-56"
            placeholder="test@address (optional)"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
          />
          <Button size="sm" variant="secondary" onClick={sendDigest} disabled={loading}>
            <Send className="w-3 h-3 mr-1" /> Send digest
          </Button>
        </div>
      </div>

      {preview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {preview.alerts.length === 0 ? (
              <p className="text-emerald-600">No anomalies right now.</p>
            ) : (
              <ul className="space-y-2">
                {preview.alerts.map((a) => (
                  <li key={a.dedupeKey} className="flex items-start gap-2">
                    {severityBadge(a.severity)}
                    <div>
                      <div className="font-medium">{a.title}</div>
                      <div className="text-muted-foreground text-xs">{a.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap font-mono">
              {preview.digest_text}
            </pre>
            {preview.load_errors && preview.load_errors.length > 0 && (
              <div className="text-xs text-destructive">
                Load warnings: {preview.load_errors.join(" · ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Open ops issues
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {issues.length === 0 ? (
            <p className="text-muted-foreground">No open ops issues.</p>
          ) : (
            <div className="space-y-2">
              {issues.map((i) => (
                <div key={i.id} className="flex items-start gap-2 border-b pb-2 last:border-0">
                  {severityBadge(i.severity)}
                  <div className="flex-1">
                    <div className="font-medium">{i.issue_type}</div>
                    {i.suggested_action && (
                      <div className="text-xs text-muted-foreground">{i.suggested_action}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      Seen {i.occurrence_count}× · last {new Date(i.last_seen_at).toLocaleString()} ·{" "}
                      {i.last_alerted_at
                        ? <>alerted {new Date(i.last_alerted_at).toLocaleString()}</>
                        : <span className="text-amber-600">not yet alerted</span>}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    onClick={async () => {
                      const { error } = await supabase.from("system_issues")
                        .update({ status: "resolved", resolution_notes: "Cleared from Ops panel" })
                        .eq("id", i.id);
                      if (error) toast.error(error.message);
                      else { toast.success("Resolved"); loadIssues(); }
                    }}
                  >
                    Resolve
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="w-4 h-4" /> Scheduling the digest
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>To send the daily digest and periodic anomaly check on a schedule, wire pg_cron to hit ops-alerts with the shared <code>x-ops-cron</code> secret:</p>
          <pre className="bg-muted p-2 rounded font-mono text-[11px]">{`select cron.schedule('ops-daily-digest', '0 13 * * *', $$
  select net.http_post(
    url:='https://<project>.functions.supabase.co/ops-alerts',
    headers:='{"Content-Type":"application/json","x-ops-cron":"<OPS_ALERTS_CRON_SECRET>"}'::jsonb,
    body:='{"mode":"digest"}'::jsonb);
$$);
select cron.schedule('ops-exception-check', '*/15 * * * *', $$
  select net.http_post(
    url:='https://<project>.functions.supabase.co/ops-alerts',
    headers:='{"Content-Type":"application/json","x-ops-cron":"<OPS_ALERTS_CRON_SECRET>"}'::jsonb,
    body:='{"mode":"check"}'::jsonb);
$$);`}</pre>
          <p>Set <code>OPS_ALERTS_CRON_SECRET</code> as a project secret, then run the SQL above from the admin SQL surface.</p>
        </CardContent>
      </Card>
    </div>
  );
}