// ============================================================================
// NurtureBackfillPanel — operations-admin-only backfill for persisted
// `quote_follow_up_completed` events into the long-term nurture destination
// campaign once it is activated.
//
// This panel is a THIN client for the `campaign-transition-replay` edge
// function. It does NOT insert enrollments, does NOT insert queue rows, and
// does NOT create a second scheduler — all writes go through
// campaign-event via the edge function.
// ============================================================================
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, PlayCircle } from "lucide-react";

interface Outcomes {
  eligible: number; already_replayed: number; already_enrolled: number;
  booked: number; no_consent: number; opted_out: number; suppressed: number;
  human_takeover: number; superseded: number; invalid_event: number;
}
interface Report {
  destination: { id: string; name: string; version: number; active: boolean };
  dry_run: boolean; scanned: number; submitted: number; outcomes: Outcomes;
}

const LABEL: Record<keyof Outcomes, string> = {
  eligible: "Eligible", already_replayed: "Already replayed",
  already_enrolled: "Already enrolled", booked: "Booked",
  no_consent: "No consent", opted_out: "Opted out", suppressed: "Suppressed",
  human_takeover: "Human takeover", superseded: "Superseded",
  invalid_event: "Invalid event",
};

export function NurtureBackfillPanel() {
  const [busy, setBusy] = useState<"dry" | "live" | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "live");
    try {
      const { data, error } = await supabase.functions.invoke("campaign-transition-replay", {
        body: { dry_run: dryRun },
      });
      if (error) throw error;
      setReport(data as Report);
      if (dryRun) toast.success(`Dry-run complete — ${(data as Report).outcomes.eligible} eligible`);
      else toast.success(`Replay submitted for ${(data as Report).submitted} contacts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Post-12-Month Nurture Backfill</CardTitle>
        <CardDescription>
          Historical <code>quote_follow_up_completed</code> events processed while the long-term
          nurture destination was inactive can be replayed here through the canonical
          campaign-event pipeline. Never inserts enrollments or queue rows directly.
          Dry-run reports outcomes without writing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => run(true)} disabled={busy !== null}>
            <RefreshCw className={`w-4 h-4 mr-1 ${busy === "dry" ? "animate-spin" : ""}`} /> Dry-run
          </Button>
          <Button size="sm" onClick={() => run(false)}
            disabled={busy !== null || !report?.destination.active}
            title={report?.destination.active ? "Submit eligible contacts to the destination campaign" : "Activate the destination campaign first"}>
            <PlayCircle className={`w-4 h-4 mr-1 ${busy === "live" ? "animate-pulse" : ""}`} /> Run replay
          </Button>
        </div>
        {report && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Destination: <strong>{report.destination.name}</strong>{" "}
              (v{report.destination.version}, {report.destination.active ? "active" : "inactive"}) ·
              scanned {report.scanned}, submitted {report.submitted}
              {report.dry_run && <span> · dry-run (no writes)</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(LABEL) as (keyof Outcomes)[]).map((k) => (
                <Badge key={k} variant={k === "eligible" ? "default" : "outline"}>
                  {LABEL[k]}: {report.outcomes[k]}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}