import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  classify, filterConversations, isHumanTakeover, isAiHandling,
  recommendNextAction, mergeTimeline,
  type ConversationRow, type FilterBucket, type TimelineEvent,
} from "@/lib/conversations/aggregate";
import {
  MessageSquare, Mail, Phone, Bot, User, AlertTriangle, CheckCircle2, PauseCircle,
} from "lucide-react";

const BUCKETS: { key: FilterBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "ai_handling", label: "AI handling" },
  { key: "waiting_customer", label: "Waiting on customer" },
  { key: "scheduling", label: "Scheduling" },
  { key: "booked", label: "Booked" },
  { key: "escalated", label: "Escalated" },
  { key: "failed_delivery", label: "Failed delivery" },
  { key: "campaign_paused", label: "Campaign paused" },
  { key: "recently_active", label: "Recently active" },
];

function timeAgo(iso: string): string {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); }
  catch { return ""; }
}

function ChannelIcon({ channel }: { channel: string }) {
  const cls = "w-3.5 h-3.5 text-muted-foreground";
  if (channel === "sms") return <Phone className={cls} />;
  if (channel === "email") return <Mail className={cls} />;
  return <MessageSquare className={cls} />;
}

function StatusPills({ c }: { c: ConversationRow }) {
  const buckets = classify(c);
  return (
    <>
      {isHumanTakeover(c) && (
        <Badge variant="destructive" className="text-[10px] py-0 h-4">
          <User className="w-3 h-3 mr-1" /> Staff
        </Badge>
      )}
      {isAiHandling(c) && (
        <Badge variant="secondary" className="text-[10px] py-0 h-4">
          <Bot className="w-3 h-3 mr-1" /> AI
        </Badge>
      )}
      {buckets.includes("needs_attention") && (
        <Badge variant="outline" className="text-[10px] py-0 h-4 border-amber-500 text-amber-600">
          <AlertTriangle className="w-3 h-3 mr-1" /> Attention
        </Badge>
      )}
      {buckets.includes("booked") && (
        <Badge variant="outline" className="text-[10px] py-0 h-4 border-emerald-500 text-emerald-600">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Booked
        </Badge>
      )}
      {buckets.includes("failed_delivery") && (
        <Badge variant="destructive" className="text-[10px] py-0 h-4">Failed</Badge>
      )}
      {buckets.includes("campaign_paused") && (
        <Badge variant="outline" className="text-[10px] py-0 h-4">
          <PauseCircle className="w-3 h-3 mr-1" /> Paused
        </Badge>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b py-1 gap-4">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground truncate">{value}</span>
    </div>
  );
}

function ConversationDetail({
  conversationId, row, onChanged,
}: {
  conversationId: string | null;
  row: ConversationRow | null;
  onChanged: () => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!conversationId) { setTimeline([]); return; }
    (async () => {
      const [chats, smses, inbound] = await Promise.all([
        supabase.from("chat_messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        supabase.from("sms_messages")
          .select("id, body, status, channel, message_kind, error, sent_at, created_at, subject")
          .order("created_at", { ascending: true })
          .limit(200),
        supabase.from("email_inbound_messages")
          .select("id, from_email, subject, text_body, received_at")
          .eq("conversation_id", conversationId)
          .order("received_at", { ascending: true }),
      ]);
      const chatEvents: TimelineEvent[] = (chats.data ?? []).map((m: any) => ({
        id: `chat:${m.id}`, ts: m.created_at, channel: "chat",
        direction: m.role === "user" ? "in" : "out",
        actor: m.role, body: m.content ?? "",
      }));
      const smsEvents: TimelineEvent[] = (smses.data ?? []).map((m: any) => ({
        id: `sms:${m.id}`, ts: m.created_at,
        channel: (m.channel === "email" ? "email" : "sms") as TimelineEvent["channel"],
        direction: "out", actor: "system",
        subject: m.subject ?? undefined,
        body: m.body, status: m.status, error: m.error ?? undefined,
      }));
      const inboundEvents: TimelineEvent[] = (inbound.data ?? []).map((m: any) => ({
        id: `email-in:${m.id}`, ts: m.received_at, channel: "email",
        direction: "in", actor: m.from_email,
        subject: m.subject ?? undefined, body: m.text_body ?? "",
      }));
      setTimeline(mergeTimeline(chatEvents, smsEvents, inboundEvents));
    })();
  }, [conversationId, row]);

  const invoke = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!conversationId) return;
    setActing(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-conversation-action", {
        body: { conversation_id: conversationId, action, ...extra },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Action: ${action}`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally {
      setActing(false);
    }
  }, [conversationId, onChanged]);

  if (!conversationId || !row) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Select a conversation to see its unified timeline.
        </CardContent>
      </Card>
    );
  }

  const takenOver = isHumanTakeover(row);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">
                {row.prospect_name || row.prospect_email || row.prospect_phone || "Unknown customer"}
              </CardTitle>
              <div className="text-xs text-muted-foreground mt-1">
                {[row.prospect_email, row.prospect_phone, row.service_address]
                  .filter(Boolean).join(" · ")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 items-center">
                <StatusPills c={row} />
                {row.quote_result?.total ? (
                  <Badge variant="outline" className="text-xs">
                    Quote: ${Number(row.quote_result.total).toFixed(0)}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {takenOver ? (
                <Button size="sm" onClick={() => invoke("release")} disabled={acting}>
                  Release to AI
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => invoke("takeover")} disabled={acting}>
                  Take over
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => invoke("pause_campaign")} disabled={acting}>
                Pause campaign
              </Button>
              <Button size="sm" variant="outline" onClick={() => invoke("resume_campaign")} disabled={acting}>
                Resume
              </Button>
              <Button size="sm" variant="outline" onClick={() => invoke("stop_campaign")} disabled={acting}>
                Stop campaign
              </Button>
              <Button size="sm" variant="outline" onClick={() => invoke("request_callback")} disabled={acting}>
                Request callback
              </Button>
              <Button size="sm" variant="outline" onClick={() => invoke("mark_resolved")} disabled={acting}>
                Mark resolved
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="grid gap-2 md:grid-cols-2">
            <Fact label="Recommended next action" value={recommendNextAction(row)} />
            <Fact label="Conversation state" value={row.conversation_state} />
            <Fact label="Booking status" value={row.booking_status} />
            <Fact label="Campaign status" value={row.campaign_status ?? "—"} />
            <Fact label="Last activity" value={timeAgo(row.last_activity_at)} />
            <Fact label="Last error" value={row.last_error ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Unified timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[420px] pr-3">
            {timeline.length === 0 ? (
              <div className="text-sm text-muted-foreground">No messages yet.</div>
            ) : (
              <ol className="space-y-3">
                {timeline.map((e) => (
                  <li key={e.id} className="border rounded-md p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="uppercase tracking-wide">
                        {e.channel} · {e.direction}
                      </span>
                      <span>{new Date(e.ts).toLocaleString()}</span>
                    </div>
                    {e.subject && <div className="text-xs font-medium mt-1">{e.subject}</div>}
                    <div className="whitespace-pre-wrap text-sm mt-1">{e.body}</div>
                    {(e.status || e.error) && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {e.status ? `Status: ${e.status}` : ""}
                        {e.error ? ` · Error: ${e.error}` : ""}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Approved manual reply</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!takenOver && (
            <div className="text-xs text-amber-600">
              Take over first — otherwise the AI may respond in parallel.
            </div>
          )}
          <Textarea
            rows={3}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Type your approved reply. It is queued into the transcript for review; live send happens through the existing SMS/email path."
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={acting || !replyBody.trim()}
              onClick={() => invoke("send_reply", { reply_body: replyBody.trim() }).then(() => setReplyBody(""))}
            >
              Queue reply
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ConversationsTabContent() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<FilterBucket>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_conversations")
      .select(`
        id, prospect_name, prospect_email, prospect_phone, channel, status,
        conversation_state, booking_status, campaign_status,
        staff_takeover_at, resolved, needs_attention, callback_requested,
        last_activity_at, last_error, service_address, services_discussed,
        quote_result
      `)
      .order("last_activity_at", { ascending: false })
      .limit(200);
    if (error) toast.error("Failed to load conversations: " + error.message);
    setRows((data as unknown as ConversationRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => filterConversations(rows, bucket, query),
    [rows, bucket, query],
  );

  return (
    <div className="grid gap-4 md:grid-cols-[380px_1fr]">
      <Card className="md:sticky md:top-24 md:h-[calc(100vh-8rem)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conversations</CardTitle>
          <Input
            placeholder="Search name, email, phone, address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2"
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                onClick={() => setBucket(b.key)}
                className={`text-xs px-2 py-1 rounded border transition ${
                  bucket === b.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-border"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-22rem)]">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No conversations.</div>
            ) : (
              <ul className="divide-y">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left p-3 hover:bg-muted transition ${
                        selectedId === c.id ? "bg-muted" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm truncate">
                          {c.prospect_name || c.prospect_email || c.prospect_phone || "Unknown"}
                        </div>
                        <ChannelIcon channel={c.channel} />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {recommendNextAction(c)}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <StatusPills c={c} />
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {timeAgo(c.last_activity_at)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <ConversationDetail
        conversationId={selectedId}
        row={rows.find((r) => r.id === selectedId) ?? null}
        onChanged={load}
      />
    </div>
  );
}