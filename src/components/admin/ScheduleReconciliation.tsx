import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ScanSearch,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wrench,
  Clock,
  Trash2,
  PlusCircle,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';

interface Discrepancy {
  type: 'missing' | 'orphan' | 'mismatch';
  day: string;
  technician: string;
  visitId: string;
  client: string | null;
  jobberStart?: string;
  jobberEnd?: string;
  mirrorStart?: string;
  mirrorEnd?: string;
}

interface ReconReport {
  totals: { missingCount: number; orphanCount: number; mismatchCount: number };
  applied?: { blocksAdded: number; blocksCorrected: number; blocksPruned: number };
  discrepancies: Discrepancy[];
}

interface ReconRun {
  id: string;
  started_at: string;
  mode: string;
  trigger: string;
  status: string;
  jobber_visits: number;
  mirror_blocks: number;
  missing_count: number;
  orphan_count: number;
  mismatch_count: number;
  blocks_added: number;
  blocks_corrected: number;
  blocks_pruned: number;
  report: ReconReport | null;
}

const TYPE_META = {
  missing: { label: 'Missing in mirror', icon: PlusCircle, className: 'text-amber-600' },
  orphan: { label: 'Stale (not in Jobber)', icon: Trash2, className: 'text-red-600' },
  mismatch: { label: 'Time mismatch', icon: Pencil, className: 'text-blue-600' },
} as const;

function fmtTime(iso?: string) {
  if (!iso) return '—';
  return format(new Date(iso), 'MMM d, h:mm a');
}

export function ScheduleReconciliation() {
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeReport, setActiveReport] = useState<ReconReport | null>(null);

  const fetchRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from('schedule_reconciliation_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(15);
    if (!error && data) {
      setRuns(data as unknown as ReconRun[]);
      const latestManual = (data as unknown as ReconRun[]).find((r) => r.trigger === 'manual');
      if (latestManual?.report) setActiveReport(latestManual.report);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const runReconcile = async (mode: 'report' | 'fix') => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-reconcile-schedule', {
        body: { mode, trigger: 'manual', horizonDays: 30 },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Reconciliation failed');

      setActiveReport(data.report as ReconReport);
      const total = data.missingCount + data.orphanCount + data.mismatchCount;

      if (data.throttled) {
        toast.warning('Jobber rate-limited the check — results may be partial. No data was changed.');
      } else if (total === 0) {
        toast.success('All clear — calendar perfectly matches Jobber.');
      } else if (mode === 'fix') {
        toast.success(
          `Fixed: +${data.blocksAdded} added, ${data.blocksCorrected} corrected, ${data.blocksPruned} stale removed.`,
        );
      } else {
        toast.info(`Found ${total} discrepancies. Review below, then auto-fix if correct.`);
      }
      await fetchRuns();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Reconciliation failed');
    } finally {
      setIsRunning(false);
    }
  };

  const grouped = (activeReport?.discrepancies || []).reduce<Record<string, Record<string, Discrepancy[]>>>(
    (acc, d) => {
      acc[d.day] ??= {};
      acc[d.day][d.technician] ??= [];
      acc[d.day][d.technician].push(d);
      return acc;
    },
    {},
  );
  const hasDiscrepancies = (activeReport?.discrepancies?.length || 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="w-5 h-5" />
              Schedule Reconciliation
            </CardTitle>
            <CardDescription>
              Compares live Jobber visits against the local availability mirror, day by day and
              technician by technician.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => runReconcile('report')} disabled={isRunning}>
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              <span className="ml-2">Run report</span>
            </Button>
            <Button onClick={() => runReconcile('fix')} disabled={isRunning}>
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              <span className="ml-2">Run &amp; auto-fix</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Auto-fix runs every 5 minutes</AlertTitle>
          <AlertDescription>
            The full 30-day schedule is swept every 5 minutes — stale blocks (cancelled or moved in
            Jobber) are removed and changed times are corrected automatically. Use the buttons above
            for an on-demand check.
          </AlertDescription>
        </Alert>

        {activeReport && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-lg border">
              <p className="text-2xl font-bold text-amber-600">{activeReport.totals.missingCount}</p>
              <p className="text-xs text-muted-foreground">Missing in mirror</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-2xl font-bold text-red-600">{activeReport.totals.orphanCount}</p>
              <p className="text-xs text-muted-foreground">Stale blocks</p>
            </div>
            <div className="p-3 rounded-lg border">
              <p className="text-2xl font-bold text-blue-600">{activeReport.totals.mismatchCount}</p>
              <p className="text-xs text-muted-foreground">Time mismatches</p>
            </div>
          </div>
        )}

        {activeReport && !hasDiscrepancies && (
          <Alert className="border-green-600/40">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertTitle>No discrepancies</AlertTitle>
            <AlertDescription>
              Every Jobber visit in the next 30 days has a matching block in the availability mirror.
              No double-bookable slots.
            </AlertDescription>
          </Alert>
        )}

        {hasDiscrepancies && (
          <Accordion type="multiple" className="w-full">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([day, byTech]) => {
                const dayCount = Object.values(byTech).reduce((n, items) => n + items.length, 0);
                return (
                  <AccordionItem key={day} value={day}>
                    <AccordionTrigger>
                      <span className="flex items-center gap-2">
                        {format(new Date(`${day}T12:00:00`), 'EEE, MMM d')}
                        <Badge variant="secondary">{dayCount}</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4">
                        {Object.entries(byTech).map(([tech, items]) => (
                          <div key={tech} className="space-y-2">
                            <p className="text-sm font-medium">{tech}</p>
                            {items.map((d, i) => {
                              const meta = TYPE_META[d.type];
                              const Icon = meta.icon;
                              return (
                                <div
                                  key={`${d.visitId}-${i}`}
                                  className="flex items-start gap-2 text-sm p-2 rounded-md border bg-muted/30"
                                >
                                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.className}`} />
                                  <div className="min-w-0">
                                    <p className="font-medium">
                                      {meta.label}
                                      {d.client ? ` — ${d.client}` : ''}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {d.type === 'orphan'
                                        ? `Mirror: ${fmtTime(d.mirrorStart)} – ${fmtTime(d.mirrorEnd)}`
                                        : d.type === 'missing'
                                          ? `Jobber: ${fmtTime(d.jobberStart)} – ${fmtTime(d.jobberEnd)}`
                                          : `Jobber: ${fmtTime(d.jobberStart)} – ${fmtTime(d.jobberEnd)} · Mirror: ${fmtTime(d.mirrorStart)} – ${fmtTime(d.mirrorEnd)}`}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
          </Accordion>
        )}

        {/* Recent runs */}
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Recent reconciliations
          </p>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reconciliation runs yet.</p>
          ) : (
            <div className="space-y-1">
              {runs.map((r) => {
                const total = r.missing_count + r.orphan_count + r.mismatch_count;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-sm py-1.5 px-2 rounded-md hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {r.status === 'failed' ? (
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                      ) : total === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      ) : (
                        <Wrench className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <span className="truncate">
                        {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {r.trigger === 'auto' ? 'auto' : 'manual'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {r.status === 'failed'
                        ? 'failed'
                        : `−${r.blocks_pruned} stale · +${r.blocks_added} · ✎${r.blocks_corrected}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}