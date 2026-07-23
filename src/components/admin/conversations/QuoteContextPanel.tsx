// ============================================================================
// QuoteContextPanel — compact admin-only view of the canonical quote_session
// bound to the selected conversation. Shows what the AI already knows, what's
// still missing, and the last canonical quote result (if calculate_quote was
// invoked). This is display-only: never sends, never books.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Snapshot {
  id: string;
  fields: Record<string, unknown> | null;
  required_remaining: string[] | null;
  quote_status: string | null;
  updated_at: string | null;
  last_quote_result: {
    status?: string;
    total?: number;
    subtotal?: number;
    lineItems?: { label: string; amount: number }[];
    explanation?: string;
  } | null;
}

export function QuoteContextPanel({ conversationId }: { conversationId: string | null }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) { setSnap(null); return; }
    setBusy(true);
    try {
      const { data } = await supabase.functions.invoke("admin-conversation-action", {
        body: { conversation_id: conversationId, action: "get_draft_context" },
      });
      setSnap(((data as { snapshot?: Snapshot } | null)?.snapshot) ?? null);
    } finally {
      setBusy(false);
    }
  }, [conversationId]);

  useEffect(() => { load(); }, [load]);

  if (!conversationId) return null;

  const fields = (snap?.fields ?? {}) as Record<string, unknown>;
  const missing = snap?.required_remaining ?? [];
  const q = snap?.last_quote_result ?? null;

  const fieldChips: [string, unknown][] = [
    ["services", (fields.services as string[])?.join(", ")],
    ["address", fields.address],
    ["sqft", fields.squareFootage],
    ["stories", fields.stories],
    ["window scope", fields.windowCleaningScope],
    ["window sides", fields.windowCleaningSides],
  ].filter(([, v]) => v != null && v !== "") as [string, unknown][];

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base">Quote context (AI-visible)</CardTitle>
        <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        {!snap ? (
          <div className="text-xs text-muted-foreground">No quote session bound yet.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {fieldChips.length === 0 && (
                <span className="text-xs text-muted-foreground">No intake fields captured.</span>
              )}
              {fieldChips.map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[11px] font-normal">
                  {k}: {String(v)}
                </Badge>
              ))}
            </div>
            {missing.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Still needed: </span>
                <span className="text-amber-600">{missing.join(", ")}</span>
              </div>
            )}
            {q ? (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase text-[10px]">{q.status ?? "—"}</Badge>
                  {typeof q.total === "number" && (
                    <span className="font-semibold">${q.total.toFixed(0)}</span>
                  )}
                </div>
                {q.lineItems && q.lineItems.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {q.lineItems.map((li, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="text-muted-foreground">{li.label}</span>
                        <span>${li.amount.toFixed(0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {q.explanation && (
                  <div className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                    {q.explanation}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No canonical quote calculated yet in this thread.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}