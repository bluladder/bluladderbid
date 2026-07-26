import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Row = Database["public"]["Tables"]["action_inbox_items"]["Row"];
type Status = Database["public"]["Enums"]["action_inbox_status"];
type Priority = Database["public"]["Enums"]["action_inbox_priority"];
type ItemType = Database["public"]["Enums"]["action_inbox_type"];

const TYPE_LABELS: Record<ItemType, string> = {
  knowledge_gap: "Knowledge gap",
  low_confidence_answer: "Low-confidence answer",
  reported_bad_answer: "Reported bad answer",
  missed_call_followup: "Missed call",
  promised_callback: "Promised callback",
  email_draft_review: "Email draft",
  complaint_or_risk: "Complaint / risk",
  quote_followup: "Quote follow-up",
  content_recommendation: "Content idea",
  policy_conflict: "Policy conflict",
  integration_error: "Integration error",
};

const PRIORITY_TONE: Record<Priority, string> = {
  urgent: "bg-destructive text-destructive-foreground",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  normal: "bg-muted text-muted-foreground",
  low: "bg-muted/50 text-muted-foreground",
};

const STATUS_FILTERS: { value: "active" | Status; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "snoozed", label: "Snoozed" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

export function ActionInboxPanel() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"active" | Status>("active");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ItemType>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("action_inbox_items").select("*").order("created_at", { ascending: false }).limit(200);

    if (statusFilter === "active") q = q.in("status", ["open", "in_progress"]);
    else q = q.eq("status", statusFilter);

    if (priorityFilter !== "all") q = q.eq("priority", priorityFilter);
    if (typeFilter !== "all") q = q.eq("type", typeFilter);

    const { data, error } = await q;
    if (error) {
      toast({ title: "Failed to load inbox", description: error.message, variant: "destructive" });
    } else {
      setItems(data ?? []);
    }
    setLoading(false);
  }, [statusFilter, priorityFilter, typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.summary ?? "").toLowerCase().includes(q) ||
        (i.knowledge_key ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const selected = filtered.find((i) => i.id === selectedId) ?? null;

  const updateStatus = async (id: string, status: Status, note?: string) => {
    setBusy(id);
    const patch: Partial<Row> = { status };
    if (status === "resolved" || status === "dismissed") {
      patch.resolved_at = new Date().toISOString();
      if (note) patch.resolution_note = note;
    }
    const { error } = await supabase.from("action_inbox_items").update(patch).eq("id", id);
    setBusy(null);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Marked ${status.replace("_", " ")}` });
      load();
    }
  };

  const snooze = async (id: string, hours: number) => {
    setBusy(id);
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("action_inbox_items")
      .update({ status: "snoozed", snooze_until: until })
      .eq("id", id);
    setBusy(null);
    if (error) {
      toast({ title: "Snooze failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Snoozed for ${hours}h` });
      load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-display font-semibold flex items-center gap-2">
            <Inbox className="h-6 w-6" /> Action Inbox
          </h2>
          <p className="text-sm text-muted-foreground">
            Everything that needs your attention across knowledge, conversations, and follow-ups.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="py-4 flex flex-wrap gap-3 items-center">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as any)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {(Object.keys(TYPE_LABELS) as ItemType[]).map((t) => (
                <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="flex-1 min-w-[200px]"
            placeholder="Search title, summary, key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="space-y-2">
          {loading ? (
            <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center space-y-2">
                <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />
                <div className="font-medium">Inbox zero</div>
                <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
              </CardContent>
            </Card>
          ) : (
            filtered.map((item) => (
              <Card
                key={item.id}
                className={`cursor-pointer transition ${
                  selectedId === item.id ? "border-primary" : "hover:border-primary/40"
                }`}
                onClick={() => setSelectedId(item.id)}
              >
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      {item.summary && (
                        <div className="text-sm text-muted-foreground line-clamp-2">
                          {item.summary}
                        </div>
                      )}
                    </div>
                    <Badge className={`shrink-0 ${PRIORITY_TONE[item.priority]}`} variant="secondary">
                      {item.priority}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                    <Badge variant="outline">{TYPE_LABELS[item.type]}</Badge>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                    </span>
                    <span className="capitalize">{item.status.replace("_", " ")}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="lg:sticky lg:top-4 h-fit">
          {selected ? (
            <ActionDetail
              item={selected}
              busy={busy === selected.id}
              onResolve={(note) => updateStatus(selected.id, "resolved", note)}
              onDismiss={(note) => updateStatus(selected.id, "dismissed", note)}
              onStart={() => updateStatus(selected.id, "in_progress")}
              onReopen={() => updateStatus(selected.id, "open")}
              onSnooze={(h) => snooze(selected.id, h)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select an item to see full context and take action.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionDetail(props: {
  item: Row;
  busy: boolean;
  onResolve: (note?: string) => void;
  onDismiss: (note?: string) => void;
  onStart: () => void;
  onReopen: () => void;
  onSnooze: (hours: number) => void;
  onClose: () => void;
}) {
  const { item, busy, onResolve, onDismiss, onStart, onReopen, onSnooze, onClose } = props;
  const [note, setNote] = useState("");
  const isActive = item.status === "open" || item.status === "in_progress";

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[item.type]}
            </div>
            <div className="font-display font-semibold text-lg">{item.title}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {item.summary && (
          <div className="text-sm whitespace-pre-wrap">{item.summary}</div>
        )}

        {item.recommended_action && (
          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 space-y-1">
            <div className="text-xs font-medium text-primary flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Recommended action
            </div>
            <div className="text-sm">{item.recommended_action}</div>
          </div>
        )}

        {item.suggested_response && (
          <div className="rounded-md bg-muted p-3 space-y-1">
            <div className="text-xs font-medium">Suggested response</div>
            <div className="text-sm whitespace-pre-wrap">{item.suggested_response}</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          {item.knowledge_key && <div><span className="font-medium text-foreground">Key:</span> {item.knowledge_key}</div>}
          {item.source_channel && <div><span className="font-medium text-foreground">Source:</span> {item.source_channel}</div>}
          {item.customer_id && <div><span className="font-medium text-foreground">Customer:</span> {item.customer_id.slice(0, 8)}…</div>}
          {item.due_at && <div><span className="font-medium text-foreground">Due:</span> {new Date(item.due_at).toLocaleString()}</div>}
        </div>

        <Textarea
          placeholder="Resolution note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />

        <div className="flex flex-wrap gap-2">
          {isActive ? (
            <>
              <Button size="sm" onClick={() => onResolve(note || undefined)} disabled={busy}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Resolve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDismiss(note || undefined)} disabled={busy}>
                Dismiss
              </Button>
              {item.status === "open" && (
                <Button size="sm" variant="outline" onClick={onStart} disabled={busy}>
                  Start
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onSnooze(4)} disabled={busy}>Snooze 4h</Button>
              <Button size="sm" variant="ghost" onClick={() => onSnooze(24)} disabled={busy}>Snooze 1d</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={onReopen} disabled={busy}>Reopen</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}