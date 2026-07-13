import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  ShieldCheck, ShieldAlert, Copy, ExternalLink, XCircle, CheckCircle2,
  Clock, AlertTriangle, FlaskConical, Loader2,
} from "lucide-react";
import {
  APPROVED_TEST_EMAIL, AUTH_STATUS_LABELS, buildAuthKey, canAuthorize,
  deriveAuthStatus, evaluatePreconditions, parseAuthorizedResult, readQuote,
  shouldShowPanel, type AuthStatus, type ConvoLike, type TestIdentityLike,
} from "./liveJobberTest";

interface OfferedSlot {
  slotId: string;
  startTime?: string;
  displayTime?: string;
  durationMinutes?: number;
  __technicianId?: string | null;
  __isTeamJob?: boolean;
  __teamTechnicianIds?: string[] | null;
}

interface LinkedBooking {
  id: string;
  status: string;
  scheduled_start: string | null;
  jobber_job_id: string | null;
  jobber_visit_id: string | null;
  technician_id: string | null;
}

const AUTH_STATUS_TONE: Record<AuthStatus, "default" | "secondary" | "destructive" | "outline"> = {
  not_authorized: "outline",
  authorized: "secondary",
  expired: "outline",
  consumed: "default",
  mismatch: "destructive",
  failed: "destructive",
};

// Never surface a raw DB/edge error to the browser.
function safeMessage(fallback: string): string {
  return fallback;
}

export function LiveJobberTestPanel({
  convo,
  isOperationsAdmin,
  adminUserId,
  onChanged,
}: {
  convo: ConvoLike;
  isOperationsAdmin: boolean;
  adminUserId: string | null;
  onChanged: () => void;
}) {
  const [identity, setIdentity] = useState<TestIdentityLike | null>(null);
  const [globalSuppressionOn, setGlobalSuppressionOn] = useState(false);
  const [offeredSlot, setOfferedSlot] = useState<OfferedSlot | null>(null);
  const [technicianName, setTechnicianName] = useState<string | null>(null);
  const [linkedBooking, setLinkedBooking] = useState<LinkedBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Refresh clock so "expires in" and expired state stay accurate.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const loadContext = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: idRows }, { data: cfg }, { data: toolMsgs }] = await Promise.all([
        supabase.from("test_identities").select("*").eq("email", APPROVED_TEST_EMAIL).eq("protected", true).limit(1),
        supabase.from("system_test_config").select("suppress_all").eq("id", "default").maybeSingle(),
        supabase.from("chat_messages").select("tool_result").eq("conversation_id", convo.id)
          .eq("tool_name", "get_bluladder_availability").order("created_at", { ascending: false }).limit(1),
      ]);
      const id = (idRows?.[0] ?? null) as TestIdentityLike | null;
      setIdentity(id);
      setGlobalSuppressionOn(cfg?.suppress_all === true);

      const offered = (toolMsgs?.[0]?.tool_result as { offered?: OfferedSlot[] } | null)?.offered ?? [];
      const slotId = convo.selected_slot_id ?? convo.facts?.selectedSlotId ?? null;
      const slot = slotId ? offered.find((s) => s.slotId === slotId) ?? null : null;
      setOfferedSlot(slot);

      if (slot?.__technicianId) {
        const { data: tech } = await supabase.from("technicians").select("name").eq("id", slot.__technicianId).maybeSingle();
        setTechnicianName(tech?.name ?? null);
      } else {
        setTechnicianName(slot?.__isTeamJob ? "Team / crew" : null);
      }

      // Post-booking: link a local booking by the recorded Jobber visit id.
      const parsed = parseAuthorizedResult(id?.authorized_result);
      if (parsed?.jobberVisitId) {
        const { data: bk } = await supabase.from("bookings")
          .select("id, status, scheduled_start, jobber_job_id, jobber_visit_id, technician_id")
          .eq("jobber_visit_id", parsed.jobberVisitId).maybeSingle();
        setLinkedBooking((bk as LinkedBooking | null) ?? null);
      } else {
        setLinkedBooking(null);
      }
    } catch {
      // Keep the panel usable; never surface a raw error.
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }, [convo.id, convo.selected_slot_id, convo.facts?.selectedSlotId]);

  useEffect(() => { void loadContext(); }, [loadContext]);

  const authStatus = useMemo(() => deriveAuthStatus(identity, now), [identity, now]);
  const preconditions = useMemo(
    () => evaluatePreconditions({ isOperationsAdmin, convo, identity, globalSuppressionOn, authStatus }),
    [isOperationsAdmin, convo, identity, globalSuppressionOn, authStatus],
  );
  const quote = useMemo(() => readQuote(convo), [convo]);
  const authKey = useMemo(
    () => buildAuthKey(convo.id, convo.selected_slot_id ?? convo.facts?.selectedSlotId ?? ""),
    [convo.id, convo.selected_slot_id, convo.facts?.selectedSlotId],
  );
  const result = useMemo(() => parseAuthorizedResult(identity?.authorized_result), [identity?.authorized_result]);

  // Visibility gate (belt-and-suspenders; parent also gates).
  if (!shouldShowPanel({ isOperationsAdmin, convo, identity })) return null;

  const slotId = convo.selected_slot_id ?? convo.facts?.selectedSlotId ?? "";
  const canAuth = canAuthorize(preconditions, authStatus);
  const consumed = authStatus === "consumed" || authStatus === "mismatch" || authStatus === "failed";
  const clearable = identity?.live_jobber_test_enabled === true;

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value);
    toast({ title: `${label} copied` });
  };

  const doAuthorize = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("authorize_live_jobber_test", {
        p_email: APPROVED_TEST_EMAIL,
        p_conversation_id: convo.id,
        p_slot_id: slotId,
        p_idempotency_key: authKey,
        p_ttl_minutes: 20,
      });
      if (error) { toast({ title: "Authorization failed", description: safeMessage("The authorization could not be issued."), variant: "destructive" }); return; }
      toast({ title: "One live Jobber test booking authorized", description: "Expires automatically. Messages stay suppressed." });
      setAuthorizeOpen(false);
      await loadContext();
      onChanged();
    } finally { setBusy(false); }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("clear_live_jobber_authorization", { p_email: APPROVED_TEST_EMAIL });
      if (error) { toast({ title: "Clear failed", description: safeMessage("The authorization could not be cleared."), variant: "destructive" }); return; }
      toast({ title: "Live test authorization cleared", description: "Protected identity and suppression are preserved." });
      setClearOpen(false);
      await loadContext();
      onChanged();
    } finally { setBusy(false); }
  };

  const doCancel = async () => {
    if (!linkedBooking) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-appointment-actions", {
        body: { action: "cancel", bookingId: linkedBooking.id, isAdminOverride: true, adminUserId },
      });
      if (error || (data as { error?: string } | null)?.error) {
        toast({ title: "Cancellation failed", description: safeMessage("The cancellation could not be completed."), variant: "destructive" });
        return;
      }
      const d = data as { status?: string; needsAttention?: boolean } | null;
      if (d?.needsAttention || d?.status === "needs_attention") {
        toast({ title: "Cancellation pending", description: "The scheduling system still needs to confirm removal." });
      } else {
        toast({ title: "Controlled test appointment cancelled" });
      }
      setCancelOpen(false);
      await loadContext();
      onChanged();
    } finally { setBusy(false); }
  };

  const expiresAt = identity?.authorization_expires_at ? new Date(identity.authorization_expires_at) : null;
  const consumedAt = identity?.authorization_consumed_at ? new Date(identity.authorization_consumed_at) : null;

  return (
    <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold">Controlled live Jobber test</span>
        </div>
        <Badge variant={AUTH_STATUS_TONE[authStatus]}>{AUTH_STATUS_LABELS[authStatus]}</Badge>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading authorization context…</p>
      ) : (
        <>
          {/* Scoped identifiers (read-only, derived) */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Kv label="Conversation ID" value={convo.id} onCopy={() => copy("Conversation ID", convo.id)} />
            <Kv label="Test identity" value={APPROVED_TEST_EMAIL} />
            <Kv label="Selected slot ID" value={slotId} />
            <Kv label="Appointment" value={offeredSlot?.displayTime ?? offeredSlot?.startTime ?? "—"} />
            <Kv label="Technician / crew" value={technicianName ?? "—"} />
            <Kv label="Quote total" value={quote.total != null ? `$${quote.total}` : "—"} />
            <Kv label="Engine / rule" value={`${quote.engineVersion ?? "—"} / ${quote.ruleVersion ?? "—"}`} />
            <Kv label="Idempotency key" value={authKey} onCopy={() => copy("Idempotency key", authKey)} />
          </div>

          <Separator />

          {/* Preconditions */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Preconditions</p>
            {preconditions.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-xs">
                {p.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span className={p.ok ? "" : "text-muted-foreground"}>{p.label}{p.detail ? ` (${p.detail})` : ""}</span>
              </div>
            ))}
          </div>

          {/* Audit visibility */}
          {identity?.live_jobber_test_enabled && (
            <div className="rounded-md bg-muted/50 p-2 text-xs space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Authorization audit</p>
              <p>Authorized by: <span className="font-mono">{identity.authorized_by === adminUserId ? "you" : identity.authorized_by ?? "—"}</span></p>
              <p className="flex items-center gap-1"><Clock className="w-3 h-3" /> Expires: {expiresAt ? expiresAt.toLocaleString() : "—"}</p>
              {consumedAt && <p className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Consumed: {consumedAt.toLocaleString()}</p>}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!canAuth || busy} onClick={() => setAuthorizeOpen(true)}>
              <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Authorize one live Jobber test booking
            </Button>
            <Button size="sm" variant="outline" disabled={!clearable || busy} onClick={() => setClearOpen(true)}>
              <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Clear authorization
            </Button>
          </div>

          {/* Guided final-test checklist (after a fresh, unconsumed authorization) */}
          {authStatus === "authorized" && (
            <div className="rounded-md border border-border bg-background p-2 text-xs space-y-1.5">
              <p className="font-medium">Guided final test</p>
              <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                <li>Open this exact conversation in the customer chat (this conversation ID).</li>
                <li>At the final summary, send: <span className="font-medium text-foreground">“That sounds good.”</span> — confirm no booking occurs (ambiguous confirmation).</li>
                <li>Then send: <span className="font-medium text-foreground">“Yes, book this appointment.”</span></li>
                <li>Return here to verify the result. All messages remain suppressed.</li>
              </ol>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => copy("Conversation ID", convo.id)}>
                  <Copy className="w-3 h-3 mr-1" /> Copy conversation ID
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="/" target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 mr-1" /> Open customer chat</a>
                </Button>
              </div>
            </div>
          )}

          {/* Post-booking verification panel */}
          {consumed && result && (
            <div className="rounded-md border border-green-600/30 bg-green-600/5 p-2 text-xs space-y-2">
              <p className="font-medium flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Post-booking verification</p>
              <div className="grid grid-cols-2 gap-2">
                <Kv label="Result status" value={result.status ?? "—"} />
                <Kv label="Confirmed time" value={result.confirmedTime ?? "—"} />
                <Kv label="Jobber visit" value={result.jobberVisitId ?? "—"} />
                <Kv label="Jobber job #" value={linkedBooking?.jobber_job_id ?? "—"} />
                <Kv label="Local booking" value={linkedBooking?.status ?? "not linked"} />
                <Kv label="Conversation state" value={convo.conversation_state ?? "—"} />
                <Kv label="Suppression" value="active (all messages suppressed)" />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {linkedBooking && (
                  <Button size="sm" variant="outline" asChild>
                    <a href="/admin?tab=bookings" target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 mr-1" /> Open linked booking</a>
                  </Button>
                )}
                {linkedBooking && linkedBooking.status !== "cancelled" && (
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => setCancelOpen(true)}>
                    <XCircle className="w-3 h-3 mr-1" /> Cancel controlled test appointment
                  </Button>
                )}
              </div>
              {!linkedBooking && result.jobberVisitId && (
                <p className="flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3 h-3" /> A Jobber visit ({result.jobberVisitId}) exists but no local booking was linked — it may require manual deletion in Jobber.</p>
              )}
            </div>
          )}
        </>
      )}

      {/* Authorize confirmation */}
      <AlertDialog open={authorizeOpen} onOpenChange={setAuthorizeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Authorize one live Jobber test booking?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>This authorizes <strong>exactly one</strong> live Jobber booking for this conversation and slot.</p>
                <ul className="list-disc ml-4">
                  <li>All customer messages (SMS, email, CallRail, campaigns, internal alerts) remain suppressed.</li>
                  <li>The authorization expires automatically (15–30 minutes).</li>
                  <li>Any resulting visit-less Jobber job may require manual deletion.</li>
                </ul>
                <p className="text-xs text-muted-foreground">Scope: <span className="font-mono break-all">{authKey}</span></p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doAuthorize(); }} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Authorize one booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear confirmation */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear live test authorization?</AlertDialogTitle>
            <AlertDialogDescription>
              This revokes the one-time authorization. It does not delete the protected test identity,
              does not disable message suppression, and does not modify any booking or other conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doClear(); }} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Clear authorization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancellation confirmation */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel controlled test appointment?</AlertDialogTitle>
            <AlertDialogDescription>
              This uses the standard production cancellation workflow to remove the Jobber visit, cancel the
              local booking, release the busy block and reservation, and return the slot to availability.
              Suppressed messages remain undelivered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep appointment</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void doCancel(); }} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null} Cancel test appointment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kv({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <p className="truncate font-mono text-[11px]" title={value}>{value || "—"}</p>
        {onCopy && value && (
          <button onClick={onCopy} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Copy ${label}`}>
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}