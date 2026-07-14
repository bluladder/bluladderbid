// ============================================================================
// Controlled AI-chat booking test runner (admin-guided).
// Placement: Admin → Integrations → AI Conversations.
//
// Rendered only for operations admins. It drives the run-booking-test edge
// function in phases and presents a single explicit human authorization
// checkpoint before the live Jobber write. It never bypasses:
//   * authorize_live_jobber_test
//   * Permanent test suppression
//   * Slot reservations
//   * Idempotency
//   * Availability freshness
//   * Server-authoritative pricing
//   * Cancellation safeguards
// ============================================================================
import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  FlaskConical, CheckCircle2, XCircle, Loader2, ShieldCheck, RotateCcw,
  Play, ClipboardCopy, ExternalLink, AlertTriangle,
} from "lucide-react";
import { APPROVED_TEST_EMAIL } from "./liveJobberTest";

type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "requires_admin_action";
interface RunStep { key: string; label: string; status: StepStatus; reason?: string }
interface Checkpoint {
  testIdentity: { name: string; email: string; phone: string };
  conversationId: string;
  slotId: string;
  appointment: string;
  appointmentStart: string;
  technician: string;
  quoteTotal: number | null;
  engineVersion: string | null;
  ruleVersion: number | null;
  idempotencyKey: string;
  authKey: string;
  suppressionActive: boolean;
  warning: string;
}

const STATUS_TONE: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-amber-600",
  passed: "text-green-600",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
  requires_admin_action: "text-amber-600",
};

function StepIcon({ s }: { s: StepStatus }) {
  if (s === "passed") return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
  if (s === "failed") return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
  if (s === "running") return <Loader2 className="w-4 h-4 text-amber-600 shrink-0 animate-spin" />;
  if (s === "requires_admin_action") return <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />;
  return <div className="w-4 h-4 rounded-full border border-border shrink-0" />;
}

export function RunControlledBookingTest({ isOperationsAdmin }: { isOperationsAdmin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("idle");
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [safeStage, setSafeStage] = useState<string | null>(null);
  const [manualNote, setManualNote] = useState<{ jobberJobId: string | null; note: string } | null>(null);
  const [correlationId] = useState<string>(() => crypto.randomUUID());

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("run-booking-test", { body });
    if (error) throw error;
    return data as {
      ok?: boolean; runId?: string; phase?: string; steps?: RunStep[];
      checkpoint?: Checkpoint; safeStage?: string; error?: string;
      manualJobDeletion?: { jobberJobId: string | null; note: string } | null;
      jobberVisitId?: string; jobberJobId?: string | null;
    };
  }, []);

  const applyResult = useCallback((r: Awaited<ReturnType<typeof invoke>>) => {
    if (r.runId) setRunId(r.runId);
    if (r.phase) setPhase(r.phase);
    if (r.steps) setSteps(r.steps);
    if (r.checkpoint) setCheckpoint(r.checkpoint);
    if (r.safeStage) setSafeStage(r.safeStage);
    if (r.manualJobDeletion !== undefined) setManualNote(r.manualJobDeletion);
  }, []);

  const runPrepare = async () => {
    setBusy(true);
    setSteps([]); setCheckpoint(null); setSafeStage(null); setManualNote(null);
    try {
      const r = await invoke({ action: "prepare" });
      applyResult(r);
      if (r.ok === false) toast({ title: "Preparation failed", description: r.safeStage ?? "See step details.", variant: "destructive" });
    } catch (e) {
      toast({ title: "Could not start test run", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const authorizeAndRun = async () => {
    if (!runId || !checkpoint) return;
    setBusy(true);
    try {
      // 1) Human authorization via the existing RPC (admin JWT).
      const { error } = await supabase.rpc("authorize_live_jobber_test", {
        p_email: APPROVED_TEST_EMAIL,
        p_conversation_id: checkpoint.conversationId,
        p_slot_id: checkpoint.slotId,
        p_idempotency_key: checkpoint.authKey,
        p_ttl_minutes: 20,
      });
      if (error) {
        toast({ title: "Authorization failed", description: error.message, variant: "destructive" });
        return;
      }
      setAuthorizeOpen(false);

      // 2) Live execute
      let r = await invoke({ action: "execute", runId });
      applyResult(r);
      if (r.ok === false) return;

      // 3) Duplicate replay
      r = await invoke({ action: "duplicate", runId });
      applyResult(r);
      if (r.ok === false) return;

      // 4) Cancel + cleanup
      r = await invoke({ action: "cancel_cleanup", runId });
      applyResult(r);
      if (r.ok !== false) {
        toast({ title: "Controlled booking test completed" });
      }
    } catch (e) {
      toast({ title: "Run halted", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const resume = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      const r = await invoke({ action: "resume", runId });
      applyResult(r);
    } catch (e) {
      toast({ title: "Resume failed", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const canResume = useMemo(() => phase === "duplicate" || phase === "cancel_cleanup", [phase]);
  const canAuthorize = useMemo(() => phase === "checkpoint" && !!checkpoint, [phase, checkpoint]);
  const failed = useMemo(() => steps.some((s) => s.status === "failed"), [steps]);

  if (!isOperationsAdmin) return null;

  return (
    <Card className="border-2 border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="w-4 h-4 text-amber-600" /> Controlled AI-chat booking test
            </CardTitle>
            <CardDescription>
              Automates preparation, verification, one authorized Jobber write, duplicate check, and cancellation for the approved test identity.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">run {correlationId.slice(0, 8)}</Badge>
            <Button size="sm" onClick={runPrepare} disabled={busy}>
              <Play className="w-3.5 h-3.5 mr-1" /> Run controlled booking test
            </Button>
            {canResume && (
              <Button size="sm" variant="outline" onClick={resume} disabled={busy}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Resume from safe checkpoint
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {safeStage && failed && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Halted safely at: {safeStage}</p>
              <p className="text-muted-foreground">Diagnostic records preserved. Fix the underlying condition; the runner never auto-retries a live write.</p>
            </div>
          </div>
        )}

        {steps.length > 0 && (
          <div className="space-y-1 max-h-[420px] overflow-auto pr-1">
            {steps.map((s) => (
              <div key={s.key} className="flex items-start gap-2 text-xs">
                <StepIcon s={s.status} />
                <div className="flex-1 min-w-0">
                  <span className={STATUS_TONE[s.status]}>{s.label}</span>
                  {s.reason && <span className="text-muted-foreground"> — {s.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {canAuthorize && checkpoint && (
          <>
            <Separator />
            <div className="rounded-md border-2 border-amber-500/50 bg-amber-500/5 p-3 space-y-2 text-xs">
              <p className="font-semibold flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-amber-600" /> Awaiting operations-admin authorization</p>
              <div className="grid grid-cols-2 gap-2">
                <Kv label="Test identity" value={`${checkpoint.testIdentity.name} · ${checkpoint.testIdentity.email}`} />
                <Kv label="Phone" value={checkpoint.testIdentity.phone} />
                <Kv label="Conversation ID" value={checkpoint.conversationId} copy />
                <Kv label="Selected slot" value={checkpoint.slotId} copy />
                <Kv label="Appointment" value={checkpoint.appointment} />
                <Kv label="Technician / crew" value={checkpoint.technician} />
                <Kv label="Quote total" value={checkpoint.quoteTotal != null ? `$${checkpoint.quoteTotal}` : "—"} />
                <Kv label="Engine / rule" value={`${checkpoint.engineVersion ?? "—"} / ${checkpoint.ruleVersion ?? "—"}`} />
                <Kv label="Idempotency key" value={checkpoint.idempotencyKey} copy />
                <Kv label="Authorization key" value={checkpoint.authKey} copy />
                <Kv label="Auth expiry" value="20 minutes from confirmation" />
                <Kv label="Message suppression" value="active (SMS/email/campaign/CallRail/alerts all suppressed)" />
              </div>
              <p className="text-amber-800 dark:text-amber-300">{checkpoint.warning}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setAuthorizeOpen(true)} disabled={busy}>
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Authorize and run one live Jobber test
                </Button>
              </div>
            </div>
          </>
        )}

        {manualNote && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Manual step required</p>
              <p className="text-muted-foreground">{manualNote.note}{manualNote.jobberJobId ? ` Jobber job #: ${manualNote.jobberJobId}` : ""}</p>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={authorizeOpen} onOpenChange={setAuthorizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Authorize one live Jobber test booking?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm space-y-2">
                <p>This will issue a strictly-scoped one-time authorization and then automatically:</p>
                <ul className="list-disc ml-4">
                  <li>Submit the explicit "Yes, book this appointment." confirmation.</li>
                  <li>Create ONE Jobber job and ONE visit for the protected test identity.</li>
                  <li>Verify the booking, replay for idempotency, cancel, and clean up.</li>
                </ul>
                <p>All customer messages remain suppressed. This is the only human action for the entire run.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={authorizeAndRun} disabled={busy}>
              Authorize and run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Kv({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] truncate">{value}</span>
        {copy && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => { navigator.clipboard?.writeText(value); toast({ title: `${label} copied` }); }}
            aria-label={`Copy ${label}`}
          >
            <ClipboardCopy className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}