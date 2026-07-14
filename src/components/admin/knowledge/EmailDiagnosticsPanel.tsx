import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { Mail, RefreshCw, CheckCircle2, XCircle, Send, ExternalLink, AlertTriangle, ShieldAlert } from 'lucide-react';

// Approved, owner-authorized escalation test recipient (email-only test target).
const TEST_RECIPIENT = 'blmillen@gmail.com';

interface ResendDomain { name: string; status: string; region?: string | null }
interface DiagHealth {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  issueId: string | null;
  lastEmailSendAt: string | null;
}
interface DiagResult {
  ok: boolean;
  correlationId?: string;
  sender: { fromName: string; fromEmail: string; fromHeader: string; replyTo: string; fromDomain: string; apiKeyPresent: boolean };
  provider: { reachedProvider: boolean; httpStatus: number | null; apiKeyPresent: boolean; error: string | null; domains: ResendDomain[] };
  fromDomainVerified: boolean;
  readyToSend: boolean;
  failureReason: string | null;
  health: DiagHealth;
}
interface DiagError { message: string; correlationId?: string; issueId?: string | null; retryable: boolean }

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-xs text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

export function EmailDiagnosticsPanel({ onOpenAiConversations }: { onOpenAiConversations?: () => void }) {
  // operations-admin gate: canOverrideBookings === isAtLeast('operations_admin').
  const { canOverrideBookings, loading: permsLoading } = useAdminPermissions();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagResult | null>(null);
  const [error, setError] = useState<DiagError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const runDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('email-diagnostics', { body: {} });
      if (fnError) {
        let message = 'Diagnostics unavailable';
        let correlationId: string | undefined;
        if (fnError instanceof FunctionsHttpError) {
          const status = fnError.context?.status;
          if (status === 401) message = 'Operations-admin authentication required';
          else if (status === 403) message = 'Session expired';
          try {
            const parsed = JSON.parse(await fnError.context.text());
            correlationId = parsed?.correlationId;
          } catch { /* keep generic */ }
        }
        setResult(null);
        setError({ message, correlationId, retryable: true });
        return;
      }
      const d = data as DiagResult;
      setResult(d);
      if (!d.readyToSend) {
        setError({ message: d.failureReason ?? 'Diagnostics unavailable', correlationId: d.correlationId, issueId: d.health?.issueId, retryable: true });
      }
    } catch {
      setError({ message: 'Diagnostics unavailable', retryable: true });
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run the no-send diagnostic once for operations admins to populate fields.
  useEffect(() => {
    if (!permsLoading && canOverrideBookings) runDiagnostics();
  }, [permsLoading, canOverrideBookings, runDiagnostics]);

  const sendEscalationTest = async () => {
    setSending(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('escalation-test-notify', {
        body: { confirm: true, emailOnly: true },
      });
      if (fnError) {
        toast({ title: 'Test email failed', description: fnError.message, variant: 'destructive' });
        return;
      }
      const d = data as { email?: { status?: string; error?: string; from?: string; providerMessageId?: string; to?: string } } | null;
      const ok = d?.email?.status === 'sent';
      toast({
        title: ok ? 'Escalation test email sent' : 'Escalation test email not sent',
        description: ok
          ? `To ${d?.email?.to ?? TEST_RECIPIENT}${d?.email?.providerMessageId ? ` · ID ${d.email.providerMessageId}` : ''}`
          : `${d?.email?.status ?? '—'}${d?.email?.error ? ` — ${d.email.error}` : ''}`,
        variant: ok ? undefined : 'destructive',
      });
      setConfirmOpen(false);
      runDiagnostics();
    } finally {
      setSending(false);
    }
  };

  // Non-admins must never see the panel.
  if (permsLoading) return null;
  if (!canOverrideBookings) return null;

  const verifiedDomains = result?.provider.domains.filter((d) => d.status.toLowerCase() === 'verified') ?? [];
  const ready = !!result?.readyToSend;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Mail className="w-4 h-4" /> Email Delivery Diagnostics</CardTitle>
            <CardDescription>No-send verification of the centralized email sender configuration.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={runDiagnostics} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Running…' : 'Run Email Diagnostics'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Ready / not-ready summary */}
        {result && (
          <div className="flex items-center gap-2">
            {ready ? (
              <Badge className="gap-1"><CheckCircle2 className="w-3 h-3" /> Ready to send</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" /> Not ready</Badge>
            )}
            <Badge variant={result.fromDomainVerified ? 'secondary' : 'outline'} className="text-[10px]">
              {result.fromDomainVerified ? 'From domain verified' : 'From domain unverified'}
            </Badge>
          </div>
        )}

        {/* Sanitized error with correlation id, retry, and health link */}
        {error && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{error.message}</AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              {error.correlationId && <p>Correlation ID: <span className="font-mono">{error.correlationId}</span></p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={runDiagnostics} disabled={loading}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => document.getElementById('system-health-issues')?.scrollIntoView({ behavior: 'smooth' })}>
                  <ExternalLink className="w-3.5 h-3.5 mr-1" /> View System Health issue
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Configuration fields */}
        {result && (
          <div className="rounded-lg border p-3">
            <Field label="From display name" value={result.sender.fromName} />
            <Field label="From address" value={result.sender.fromEmail} mono />
            <Field label="Reply-To" value={result.sender.replyTo} mono />
            <Field
              label="Verified Resend domains"
              value={verifiedDomains.length
                ? verifiedDomains.map((d) => d.name).join(', ')
                : 'None'}
              mono
            />
            <Field
              label="From address in verified domain"
              value={result.fromDomainVerified ? <span className="text-green-600 dark:text-green-400">Yes</span> : <span className="text-destructive">No</span>}
            />
            <Field
              label="Resend configuration"
              value={result.provider.reachedProvider
                ? (result.provider.error ? 'Reachable — error' : 'Connected')
                : (result.sender.apiKeyPresent ? 'Unreachable' : 'API key unavailable')}
            />
            <Field label="readyToSend" value={ready ? <span className="text-green-600 dark:text-green-400">true</span> : <span className="text-destructive">false</span>} mono />
            <Field label="Last successful diagnostic" value={fmt(result.health?.lastSuccessAt)} />
            {result.health?.lastError && (
              <Field label="Last diagnostic error" value={<span className="text-destructive">{result.health.lastError} ({fmt(result.health.lastErrorAt)})</span>} />
            )}
            {result.health?.lastEmailSendAt && (
              <Field label="Last successful email send" value={fmt(result.health.lastEmailSendAt)} />
            )}
          </div>
        )}

        {!result && !error && (
          <p className="text-sm text-muted-foreground">Run the no-send diagnostic to view the current email sender configuration.</p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {ready && (
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={sending}>
              <Send className="w-3.5 h-3.5 mr-1" /> Send one real escalation test email
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onOpenAiConversations}>
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Send staff-reply test email
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Staff-reply testing uses the existing one-message authorization inside AI Conversations — open a taken-over test
          conversation, then authorize and send a single staff reply. No second implementation is created here.
        </p>
      </CardContent>

      {/* Confirmation gate for the one real escalation email */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> Send one real escalation test email?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-2 space-y-1 font-mono text-xs">
                  <div>To: {TEST_RECIPIENT}</div>
                  <div>From: BluLadder Alerts &lt;alerts@admin.bluladder.com&gt;</div>
                  <div>Reply-To: info@bluladder.com</div>
                </div>
                <p className="text-amber-600 dark:text-amber-400 font-medium">
                  Exactly one real email will be sent. No SMS will be sent.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); sendEscalationTest(); }} disabled={sending}>
              {sending ? 'Sending…' : 'Send test email'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}