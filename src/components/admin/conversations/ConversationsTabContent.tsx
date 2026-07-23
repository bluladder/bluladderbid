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
  Sparkles, Loader2,
} from "lucide-react";
import { QuoteContextPanel } from "./QuoteContextPanel";

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
  // AI draft state — sourced from chat_conversations directly since ConversationRow
  // doesn't include the draft fields. We refetch on selection change and after
  // draft-related actions.
  const [draft, setDraft] = useState<{
    body: string;
    status: string | null;
    generatedAt: string | null;
    model: string | null;
    error: string | null;
  } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftEditing, setDraftEditing] = useState(false);
  const [draftText, setDraftText] = useState("");

  const loadDraft = useCallback(async () => {
    if (!conversationId) { setDraft(null); return; }
    const { data } = await supabase
      .from("chat_conversations")
      .select("pending_draft_reply, draft_status, draft_generated_at, draft_model, draft_error")
      .eq("id", conversationId)
      .maybeSingle();
    if (data) {
      setDraft({
        body: (data as any).pending_draft_reply ?? "",
        status: (data as any).draft_status ?? null,
        generatedAt: (data as any).draft_generated_at ?? null,
        model: (data as any).draft_model ?? null,
        error: (data as any).draft_error ?? null,
      });
      setDraftText((data as any).pending_draft_reply ?? "");
      setDraftEditing(false);
    }
  }, [conversationId]);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  useEffect(() => {
    if (!conversationId || !row) { setTimeline([]); return; }
    (async () => {
      const [chats, smses, inbound] = await Promise.all([
        supabase.from("chat_messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true }),
        row.prospect_phone
          ? supabase.from("sms_messages")
              .select("id, body, status, channel, message_kind, error, sent_at, created_at, subject, to_number, to_email")
              .or(
                [
                  `to_number.eq.${row.prospect_phone}`,
                  row.prospect_email ? `to_email.eq.${row.prospect_email}` : "",
                ].filter(Boolean).join(","),
              )
              .order("created_at", { ascending: true })
              .limit(200)
          : Promise.resolve({ data: [] as any[] }),
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

  // Draft-specific invocations. Kept separate from `invoke` so the AI draft
  // card can show its own busy state without freezing the top toolbar.
  const invokeDraft = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!conversationId) return null;
    setDraftBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-conversation-action", {
        body: { conversation_id: conversationId, action, ...extra },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await loadDraft();
      return data;
    } catch (e: any) {
      toast.error(e?.message ?? "Draft action failed");
      return null;
    } finally {
      setDraftBusy(false);
    }
  }, [conversationId, loadDraft]);

  const sendDraft = useCallback(async () => {
    if (!conversationId || !draftText.trim()) return;
    setDraftBusy(true);
    try {
      // The draft is sent through the existing staff-reply SMS path — the same
      // endpoint the manual "Approved reply" button uses. We do NOT create a
      // second outbound-send implementation.
      const { data, error } = await supabase.functions.invoke("staff-reply", {
        body: { conversationId, channel: "sms", message: draftText.trim() },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) {
        throw new Error((data as any).message ?? "Send failed");
      }
      toast.success("Draft sent");
      await invokeDraft("mark_draft_sent");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Send failed");
      // Draft is preserved intentionally so Ben can retry.
    } finally {
      setDraftBusy(false);
    }
  }, [conversationId, draftText, invokeDraft, onChanged]);

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
  const draftReady = draft && (draft.status === "ready" || draft.status === "edited") && draft.body;
  const draftFailed = draft?.status === "failed";

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
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> AI suggested reply
            {draft?.status && (
              <Badge variant="outline" className="text-[10px] py-0 h-4 uppercase">
                {draft.status}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="text-xs text-muted-foreground">
            Nothing is sent until you click <span className="font-medium">Send</span>. The AI cannot reply on its own.
          </div>
          {draftFailed && (
            <div className="text-xs text-destructive">
              Draft failed: {draft?.error ?? "unknown"}. You can regenerate.
            </div>
          )}
          {draftReady && !draftEditing ? (
            <div className="rounded-md border bg-muted/40 p-3 whitespace-pre-wrap">
              {draft!.body}
            </div>
          ) : draftReady && draftEditing ? (
            <Textarea
              rows={4}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              maxLength={800}
            />
          ) : (
            <div className="text-xs text-muted-foreground">
              {draft?.status === "pending"
                ? "Generating…"
                : draft?.status === "sent"
                ? "Last draft was sent."
                : draft?.status === "discarded"
                ? "Last draft was discarded."
                : draft?.status === "superseded"
                ? "A newer customer message replaced the previous draft."
                : "No draft yet — one will appear automatically after the next inbound message."}
            </div>
          )}
          {draft?.generatedAt && (
            <div className="text-[10px] text-muted-foreground">
              Generated {timeAgo(draft.generatedAt)}
              {draft.model ? ` · ${draft.model}` : ""}
            </div>
          )}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button size="sm" variant="outline" disabled={draftBusy}
              onClick={() => invokeDraft("generate_draft")}>
              {draftBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              {draftReady || draftFailed ? "Regenerate" : "Generate draft"}
            </Button>
            {draftReady && !draftEditing && (
              <Button size="sm" variant="outline" disabled={draftBusy}
                onClick={() => setDraftEditing(true)}>
                Edit
              </Button>
            )}
            {draftReady && draftEditing && (
              <Button size="sm" variant="outline" disabled={draftBusy || !draftText.trim()}
                onClick={async () => {
                  const ok = await invokeDraft("edit_draft", { draft_body: draftText.trim() });
                  if (ok) setDraftEditing(false);
                }}>
                Save edits
              </Button>
            )}
            {draftReady && (
              <Button size="sm" variant="destructive" disabled={draftBusy}
                onClick={() => invokeDraft("discard_draft")}>
                Discard
              </Button>
            )}
            {draftReady && (
              <Button size="sm" disabled={draftBusy || !draftText.trim()} onClick={sendDraft}>
                Send
              </Button>
            )}
          </div>
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