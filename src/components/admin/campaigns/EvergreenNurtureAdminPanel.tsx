import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Eye, Mail, ShieldCheck, Users } from "lucide-react";
import {
  NURTURE_ENTRY_REASON_LABELS,
  NURTURE_RECENT_BOOKING_WINDOW_DAYS,
} from "@/lib/campaigns/nurtureEntryGate";

// ============================================================================
// EvergreenNurtureAdminPanel
//
// Compact operations panel for the "Evergreen Service Education Nurture"
// campaign. It surfaces the extra launch-readiness controls the owner asked
// for WITHOUT altering the shared SmsCampaignManager (which every campaign
// uses). All actions are read-only or preview/test-send only — this panel
// NEVER activates the campaign or enrolls real customers.
//
// Controls:
//  • Historical-backfill disabled indicator (live from sms_campaigns row)
//  • Duplicate-campaign warning (any OTHER active campaign on same event)
//  • Estimated recipient count / audience preview (via campaign-send-test)
//  • Delivery + suppression reporting (bounded enrollment counts)
//  • Per-step: email preview + test-recipient override send
//  • Entry / pause / stop rulebook shown inline
//  • Manual-activation reminder — owner sign-off gate
// ============================================================================

const EVERGREEN_ID = "55555555-5555-4555-9555-555555555555";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  event_name: string | null;
  active: boolean | null;
  historical_backfill_enabled: boolean | null;
  required_consent: string | null;
}
interface StepRow {
  id: string;
  step_order: number;
  delay_hours: number;
  channel: string;
  active: boolean;
  subject: string | null;
  body_template: string | null;
}

export function EvergreenNurtureAdminPanel() {
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ active: number; total: number; suppressed: number } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase
        .from("sms_campaigns")
        .select("id, name, status, event_name, active, historical_backfill_enabled, required_consent")
        .eq("id", EVERGREEN_ID)
        .maybeSingle();
      const { data: s } = await supabase
        .from("sms_campaign_steps")
        .select("id, step_order, delay_hours, channel, active, subject, body_template")
        .eq("campaign_id", EVERGREEN_ID)
        .order("step_order", { ascending: true });
      let dup: string | null = null;
      if (c?.event_name) {
        const { data: dups } = await supabase
          .from("sms_campaigns")
          .select("id, name, status")
          .eq("event_name", c.event_name)
          .neq("id", EVERGREEN_ID)
          .eq("active", true);
        if (dups && dups.length > 0) {
          dup = `Another active campaign shares event "${c.event_name}": ${dups.map((d) => d.name).join(", ")}`;
        }
      }
      const { data: est } = await supabase.functions.invoke("campaign-send-test", {
        body: { action: "audience_estimate", campaign_id: EVERGREEN_ID },
      });
      if (cancelled) return;
      setCampaign((c as CampaignRow) ?? null);
      setSteps((s as StepRow[]) ?? []);
      setDupWarning(dup);
      setCounts((est as typeof counts) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const activationLocked = useMemo(() => {
    if (!campaign) return true;
    return campaign.status !== "active" || campaign.active !== true;
  }, [campaign]);

  async function openPreview(step: StepRow) {
    setBusyStepId(step.id);
    try {
      const { data, error } = await supabase.functions.invoke("campaign-send-test", {
        body: { action: "preview", step_id: step.id },
      });
      if (error) throw error;
      setPreviewSubject(data?.subject ?? "");
      setPreviewHtml(data?.html ?? "");
      setPreviewOpen(true);
    } catch (e) {
      toast({ title: "Preview failed", description: String((e as Error).message ?? e), variant: "destructive" });
    } finally {
      setBusyStepId(null);
    }
  }

  async function sendTest(step: StepRow) {
    const to = testEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast({ title: "Enter a test recipient", description: "Provide a valid email above before sending a test.", variant: "destructive" });
      return;
    }
    setBusyStepId(step.id);
    try {
      const { data, error } = await supabase.functions.invoke("campaign-send-test", {
        body: { action: "send_test", step_id: step.id, to },
      });
      if (error) throw error;
      if (data?.ok) toast({ title: "Test email sent", description: `Delivered to ${to}` });
      else toast({ title: "Send failed", description: data?.failure?.message ?? "Provider rejected the send.", variant: "destructive" });
    } catch (e) {
      toast({ title: "Send failed", description: String((e as Error).message ?? e), variant: "destructive" });
    } finally {
      setBusyStepId(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Evergreen Nurture — Launch Readiness</CardTitle></CardHeader>
        <CardContent>Loading…</CardContent>
      </Card>
    );
  }

  if (!campaign) {
    return (
      <Card>
        <CardHeader><CardTitle>Evergreen Nurture — Launch Readiness</CardTitle></CardHeader>
        <CardContent>Evergreen campaign row not found. Run the seed migration first.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-xl">{campaign.name} — Launch Readiness</CardTitle>
          <Badge variant={activationLocked ? "outline" : "destructive"}>
            {activationLocked ? "Inactive (owner sign-off required)" : "ACTIVE"}
          </Badge>
          {campaign.historical_backfill_enabled === false && (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Historical backfill: disabled
            </Badge>
          )}
        </div>
        <CardDescription>
          Read-only launch controls specific to the year-long educational nurture.
          Content editing lives in the campaign editor above; this panel adds
          preview, test-send, audience estimate, delivery reporting, and the
          canonical entry/pause/stop rulebook.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {dupWarning && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Duplicate-campaign warning</AlertTitle>
            <AlertDescription>{dupWarning}</AlertDescription>
          </Alert>
        )}

        {/* Audience + delivery reporting */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> Active enrollments
            </div>
            <div className="text-2xl font-semibold">{counts?.active ?? 0}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Total ever enrolled</div>
            <div className="text-2xl font-semibold">{counts?.total ?? 0}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Suppressed at enrollment</div>
            <div className="text-2xl font-semibold">{counts?.suppressed ?? 0}</div>
          </div>
        </div>

        {/* Entry / Pause / Stop rulebook */}
        <div className="rounded-md border p-4 text-sm space-y-3">
          <div>
            <div className="font-semibold mb-1">Entry rules</div>
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              <li>Approved canonical event only (post-service completion, manual admin enrollment, or future dormant-lead / past-customer events).</li>
              <li>No active appointment.</li>
              <li>No booking created in the last {NURTURE_RECENT_BOOKING_WINDOW_DAYS} days.</li>
              <li>No other active campaign enrollment.</li>
              <li>Valid marketing email consent, no complaint / decline / opt-out.</li>
              <li>Email address not on the suppression list.</li>
              <li>No unresolved escalation (complaint, damage, billing, safety).</li>
              <li>No active human takeover on the customer's conversation.</li>
              <li>No newer quote lifecycle taking precedence.</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-1">Pause rules</div>
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              <li>Pauses for 72 hours when the customer replies (active AI conversation begins).</li>
              <li>Pauses when a new quote is under discussion or an unresolved question is open.</li>
              <li>Resumes from the next unsent touch only — sent touches are never repeated.</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-1">Permanent stop rules</div>
            <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
              <li>Booking completed, opt-out (STOP), consent revoked, suppression event, explicit decline, complaint or escalation, human takeover, invalid customer record.</li>
            </ul>
          </div>
          <div className="text-xs text-muted-foreground pt-1">
            Reason codes surfaced by the entry gate:&nbsp;
            {Object.entries(NURTURE_ENTRY_REASON_LABELS).filter(([k]) => k !== "eligible").map(([k, v]) => (
              <span key={k} className="inline-block mr-2">• {v}</span>
            ))}
          </div>
        </div>

        {/* Test recipient override */}
        <div className="space-y-2">
          <div className="font-semibold text-sm flex items-center gap-2">
            <Mail className="h-4 w-4" /> Test recipient override
          </div>
          <div className="flex gap-2">
            <Input
              value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@bluladder.com"
              type="email"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Test sends go through the standard email path and are still blocked
            by the global suppression list. They never create an enrollment.
          </div>
        </div>

        {/* Per-step controls */}
        <div className="space-y-2">
          <div className="font-semibold text-sm">Steps</div>
          <div className="space-y-2">
            {steps.map((step) => (
              <div key={step.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                <Badge variant="outline">Step {step.step_order}</Badge>
                <Badge variant={step.active ? "default" : "secondary"}>
                  {step.active ? "Enabled" : "Disabled"}
                </Badge>
                <div className="text-sm">
                  Send at day {Math.round(step.delay_hours / 24)} · <span className="text-muted-foreground">{step.channel}</span>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" disabled={busyStepId === step.id} onClick={() => openPreview(step)}>
                    <Eye className="h-3 w-3 mr-1" /> Preview
                  </Button>
                  <Button size="sm" variant="outline" disabled={busyStepId === step.id} onClick={() => sendTest(step)}>
                    <Mail className="h-3 w-3 mr-1" /> Send test
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Manual activation reminder */}
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Manual activation required</AlertTitle>
          <AlertDescription>
            This campaign remains in <strong>draft</strong> with all steps inactive and
            historical backfill disabled. Activation requires explicit owner sign-off in
            the main campaign editor above — this panel intentionally cannot flip status.
          </AlertDescription>
        </Alert>

        {/* Preview dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Email preview</DialogTitle>
              <DialogDescription>{previewSubject}</DialogDescription>
            </DialogHeader>
            <div className="border rounded-md p-4 bg-background max-h-[60vh] overflow-auto">
              {/* eslint-disable-next-line react/no-danger */}
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </DialogContent>
        </Dialog>

      </CardContent>
    </Card>
  );
}
