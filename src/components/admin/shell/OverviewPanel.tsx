import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Inbox, ClipboardList, DollarSign, MessageSquare, TrendingUp, AlertTriangle } from "lucide-react";

interface Metrics {
  openInbox: number;
  urgentInbox: number;
  bookingsThisWeek: number;
  quotesThisWeek: number;
  openConversations: number;
  unresolvedGaps: number;
  loading: boolean;
}

const initial: Metrics = {
  openInbox: 0,
  urgentInbox: 0,
  bookingsThisWeek: 0,
  quotesThisWeek: 0,
  openConversations: 0,
  unresolvedGaps: 0,
  loading: true,
};

export function OverviewPanel({ onNavigate }: { onNavigate?: (section: string) => void }) {
  const [m, setM] = useState<Metrics>(initial);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [inbox, urgent, bookings, quotes, convos, gaps] = await Promise.all([
        supabase
          .from("action_inbox_items")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
        supabase
          .from("action_inbox_items")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"])
          .eq("priority", "urgent"),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .gte("created_at", weekAgo),
        supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .gte("created_at", weekAgo),
        supabase
          .from("chat_conversations")
          .select("id", { count: "exact", head: true })
          .eq("resolved", false),
        supabase
          .from("knowledge_gaps")
          .select("id", { count: "exact", head: true })
          .neq("status", "resolved"),
      ]);

      if (cancelled) return;
      setM({
        loading: false,
        openInbox: inbox.count ?? 0,
        urgentInbox: urgent.count ?? 0,
        bookingsThisWeek: bookings.count ?? 0,
        quotesThisWeek: quotes.count ?? 0,
        openConversations: convos.count ?? 0,
        unresolvedGaps: gaps.count ?? 0,
      });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [
    {
      label: "Action Inbox",
      value: m.openInbox,
      sub: m.urgentInbox ? `${m.urgentInbox} urgent` : "All clear",
      icon: Inbox,
      tone: m.urgentInbox ? "text-destructive" : "text-primary",
      onClick: () => onNavigate?.("inbox"),
    },
    {
      label: "Bookings (7d)",
      value: m.bookingsThisWeek,
      sub: "New confirmations",
      icon: ClipboardList,
      tone: "text-primary",
      onClick: () => onNavigate?.("bookings"),
    },
    {
      label: "Quotes (7d)",
      value: m.quotesThisWeek,
      sub: "Generated bids",
      icon: DollarSign,
      tone: "text-primary",
      onClick: () => onNavigate?.("scheduling"),
    },
    {
      label: "Open Conversations",
      value: m.openConversations,
      sub: "Chat + SMS active",
      icon: MessageSquare,
      tone: "text-primary",
      onClick: () => onNavigate?.("conversations"),
    },
    {
      label: "Knowledge Gaps",
      value: m.unresolvedGaps,
      sub: "Awaiting review",
      icon: AlertTriangle,
      tone: m.unresolvedGaps > 5 ? "text-destructive" : "text-muted-foreground",
      onClick: () => onNavigate?.("inbox"),
    },
    {
      label: "This Week",
      value: m.bookingsThisWeek + m.quotesThisWeek,
      sub: "Total pipeline touches",
      icon: TrendingUp,
      tone: "text-primary",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-semibold">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Live snapshot of your pipeline, conversations, and outstanding follow-ups.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card
            key={card.label}
            className={card.onClick ? "cursor-pointer transition hover:border-primary/50" : ""}
            onClick={card.onClick}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className={`h-4 w-4 ${card.tone}`} />
            </CardHeader>
            <CardContent>
              {m.loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-3xl font-display font-semibold">{card.value}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}