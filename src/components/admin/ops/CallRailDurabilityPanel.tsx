import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface Diag {
  app_url: string;
  environment: string;
  deployment_id?: string | null;
  release_identity?: {
    project_ref: string | null;
    expected_project_ref_configured: boolean;
    project_ref_verified: boolean;
    expected_deployment_id_configured: boolean;
    deployment_id_verified: boolean;
  };
  scheduling_model: string;
  orchestrator_version: string;
  public_booking_launch_gate?: {
    enabled: boolean;
    reason: 'enabled' | 'operator_paused' | 'not_configured' | 'invalid_configuration';
  };
  generated_at?: string;
  secrets: Record<string, boolean>;
  callrail_durability: {
    pending_count: number;
    retry_pending_count: number;
    failed_count: number;
    processed_count: number;
    last_processed_at: string | null;
    oldest_unprocessed_received_at: string | null;
    next_retry_at?: string | null;
    auto_retries_enabled?: boolean | null;
  };
}
interface EventRow {
  id: string;
  provider_message_id: string;
  status: string;
  attempts: number;
  from_phone: string | null;
  received_at: string;
  last_error_category: string | null;
  last_attempted_at?: string | null;
  next_attempt_at?: string | null;
  replay_count?: number | null;
  replay_requested_by?: string | null;
  replay_requested_at?: string | null;
}

// Compact ops panel showing CallRail durability + diagnostics. Never renders
// secret values — only the presence booleans returned by admin-diagnostics.
export function CallRailDurabilityPanel() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [rowsAvailable, setRowsAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDiagBusy(true);
    const { data, error } = await supabase.functions.invoke('admin-diagnostics');
    if (error || !data) {
      setDiag(null);
      setDiagError('Launch-control status unavailable — treat public booking state as UNKNOWN and block release.');
    } else {
      setDiag(data as Diag);
      setDiagError(null);
    }
    const { data: events, error: eventsError } = await supabase
      .from('callrail_inbound_events')
      .select('id, provider_message_id, status, attempts, from_phone, received_at, last_error_category, last_attempted_at, next_attempt_at, replay_count, replay_requested_by, replay_requested_at')
      .in('status', ['received', 'retry_pending', 'failed'])
      .order('received_at', { ascending: false })
      .limit(25);
    if (eventsError) {
      setRows([]);
      setRowsAvailable(false);
    } else {
      setRows((events ?? []) as EventRow[]);
      setRowsAvailable(true);
    }
    setDiagBusy(false);
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const replay = async (id: string, mode: 'dry_run' | 'replay') => {
    setBusy(true);
    try {
      await supabase.functions.invoke('callrail-event-replay', { body: { event_id: id, mode } });
      await load();
    } finally { setBusy(false); }
  };

  const dur = diag?.callrail_durability;
  const generatedAt = diag?.generated_at ? Date.parse(diag.generated_at) : NaN;
  const diagnosticAgeMs = Date.now() - generatedAt;
  const diagnosticFresh =
    Number.isFinite(generatedAt) &&
    diagnosticAgeMs >= -30_000 &&
    diagnosticAgeMs <= 120_000;
  const gateIdentityVerified =
    diag?.environment === 'production' &&
    !!diag.deployment_id &&
    diag.release_identity?.project_ref_verified === true &&
    diag.release_identity?.deployment_id_verified === true;
  const gateVerified = diagnosticFresh && gateIdentityVerified;
  const gateEnabled = gateVerified && diag?.public_booking_launch_gate?.enabled === true;
  const gateDisabled = gateVerified && diag?.public_booking_launch_gate?.enabled === false;
  return (
    <Card>
      <CardHeader>
        <CardTitle>CallRail Durability & Diagnostics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-3 rounded border p-3 text-sm">
          <div>
            <span className="text-muted-foreground">Public booking launch control:</span>{' '}
            <Badge
              variant={
                gateEnabled
                  ? 'default'
                  : gateDisabled
                    ? 'destructive'
                    : 'outline'
              }
            >
              {gateEnabled
                ? 'ENABLED'
                : gateDisabled
                  ? `VERIFIED DISABLED — ${diag.public_booking_launch_gate.reason}`
                  : 'UNKNOWN — RELEASE BLOCKED'}
            </Badge>
            <div className="mt-1 text-xs text-muted-foreground">
              Diagnostic generated: {diag?.generated_at ?? 'unavailable'}
              {' · '}
              Identity: {gateIdentityVerified ? 'verified production deployment' : 'unverified'}
              {' · '}
              Freshness: {diagnosticFresh ? 'current' : 'stale/unavailable'}
            </div>
            {diagError && <div className="mt-1 text-xs text-destructive">{diagError}</div>}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={diagBusy}>
            Refresh status
          </Button>
        </div>

        {diag && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <div><span className="text-muted-foreground">App URL:</span> {diag.app_url}</div>
              <div><span className="text-muted-foreground">Environment:</span> {diag.environment}</div>
              <div><span className="text-muted-foreground">Diagnostics deployment:</span> {diag.deployment_id ?? 'unavailable'}</div>
              <div><span className="text-muted-foreground">Scheduling model:</span> {diag.scheduling_model}</div>
              <div><span className="text-muted-foreground">Orchestrator:</span> {diag.orchestrator_version}</div>
            </div>
            <div className="space-y-1">
              {Object.entries(diag.secrets).map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted-foreground">{k}:</span>{' '}
                  <Badge variant={v ? 'default' : 'destructive'}>{v ? 'configured' : 'missing'}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {dur && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded border p-3">
              <div className="text-muted-foreground">Pending</div>
              <div className="text-2xl font-semibold">{dur.pending_count}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-muted-foreground">Retry pending</div>
              <div className="text-2xl font-semibold">{dur.retry_pending_count}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-muted-foreground">Dead-lettered</div>
              <div className="text-2xl font-semibold">{dur.failed_count}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-muted-foreground">Processed</div>
              <div className="text-2xl font-semibold">{dur.processed_count}</div>
            </div>
            <div className="col-span-2 md:col-span-4 text-xs text-muted-foreground">
              Retry scheduler state is not inferred here; verify cron through
              the protected launch preflight. Manual replay is available for
              dead-lettered rows or for verifying processed events.
              <div className="mt-1">
                Last successful inbound: {dur.last_processed_at ?? '—'} ·
                Oldest unprocessed: {dur.oldest_unprocessed_received_at ?? '—'} ·
                Next automatic retry: {dur.next_retry_at ?? '—'}
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium mb-2">Recent unprocessed / failed events</div>
          {!rowsAvailable && (
            <div className="text-sm text-destructive">
              Event diagnostics unavailable — release status is unknown.
            </div>
          )}
          {rowsAvailable && rows.length === 0 && (
            <div className="text-sm text-muted-foreground">No unprocessed inbound events.</div>
          )}
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between rounded border p-2 text-xs">
                <div className="space-y-0.5">
                  <div className="font-mono">{r.provider_message_id}</div>
                  <div className="text-muted-foreground">
                    from {r.from_phone ?? 'unknown'} · {new Date(r.received_at).toLocaleString()} ·
                    attempts {r.attempts}
                    {r.last_error_category && <> · <span className="text-destructive">{r.last_error_category}</span></>}
                  </div>
                  <div className="text-muted-foreground">
                    {r.last_attempted_at && <>last attempt {new Date(r.last_attempted_at).toLocaleString()} · </>}
                    {r.next_attempt_at
                      ? <>next auto-retry {new Date(r.next_attempt_at).toLocaleString()}</>
                      : r.status === 'failed'
                        ? <>auto-retries exhausted — manual replay available</>
                        : <>awaiting first processing</>}
                    {(r.replay_count ?? 0) > 0 && (
                      <> · replays {r.replay_count}
                        {r.replay_requested_at && <> (last {new Date(r.replay_requested_at).toLocaleString()})</>}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === 'failed' ? 'destructive' : 'secondary'}>{r.status}</Badge>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => replay(r.id, 'dry_run')}>Dry run</Button>
                  <Button size="sm" disabled={busy} onClick={() => replay(r.id, 'replay')}>Replay</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
