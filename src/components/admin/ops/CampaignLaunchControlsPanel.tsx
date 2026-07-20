import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldAlert, Loader2 } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

interface Controls {
  enrollment_paused: boolean;
  delivery_paused: boolean;
  note: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * Global launch controls for the campaign system.
 *
 * Kill-switches:
 *  - Enrollment: honored inside campaign-event/index.ts. STOP events (opt-outs,
 *    cancellations, replies) still process while paused.
 *  - Delivery: honored inside process-sms-queue/index.ts. Queued rows remain
 *    'pending' and resume automatically once the pause is lifted.
 *
 * Only operations admins can view or modify this row (RLS enforced).
 */
export function CampaignLaunchControlsPanel() {
  const [c, setC] = useState<Controls | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await db.from("campaign_launch_controls").select("*").eq("id", 1).maybeSingle();
    if (error) toast.error(error.message);
    setC(data ?? null);
    setNote((data?.note as string) ?? "");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (patch: Partial<Controls>) => {
    if (!c) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await db.from("campaign_launch_controls").update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: userData?.user?.id ?? null,
    }).eq("id", 1);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Launch controls updated");
    load();
  };

  const anyPaused = !!(c?.enrollment_paused || c?.delivery_paused);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" />
              Campaign Launch Controls
            </CardTitle>
            <CardDescription>
              Global kill-switches for the campaign engine. Stop events (opt-outs, replies, cancellations) always process, even while paused.
            </CardDescription>
          </div>
          {anyPaused ? (
            <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Paused</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Live</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading || !c ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Pause enrollment</Label>
                <p className="text-xs text-muted-foreground max-w-md">
                  Blocks all new campaign enrollments. In-flight follow-ups continue to send; stop events still terminate active enrollments.
                </p>
              </div>
              <Switch
                checked={c.enrollment_paused}
                disabled={saving}
                onCheckedChange={(v) => save({ enrollment_paused: v })}
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Pause delivery</Label>
                <p className="text-xs text-muted-foreground max-w-md">
                  Stops the queue processor from sending any queued campaign SMS / email. Pending rows resume automatically when the pause is lifted. Operational transactional writes are unaffected.
                </p>
              </div>
              <Switch
                checked={c.delivery_paused}
                disabled={saving}
                onCheckedChange={(v) => save({ delivery_paused: v })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Reason / note</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional context for the current setting (visible to admins only)"
                rows={2}
              />
              <div className="flex justify-end">
                <Button size="sm" variant="outline" disabled={saving || note === (c.note ?? "")} onClick={() => save({ note: note.trim() || null })}>
                  Save note
                </Button>
              </div>
            </div>
            {c.updated_at && (
              <p className="text-xs text-muted-foreground">
                Last updated {new Date(c.updated_at).toLocaleString()}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}