// Unified conversation aggregation helpers. Builds a chronological timeline
// from the existing canonical sources without duplicating any source record.

export type TimelineEvent = {
  id: string;
  ts: string;
  channel: "chat" | "sms" | "email" | "campaign" | "system";
  direction: "in" | "out" | "system";
  actor: string;
  subject?: string;
  body: string;
  status?: string;
  error?: string;
  meta?: Record<string, unknown>;
};

export type ConversationRow = {
  id: string;
  prospect_name: string | null;
  prospect_email: string | null;
  prospect_phone: string | null;
  channel: string;
  status: string;
  conversation_state: string;
  booking_status: string;
  campaign_status: string | null;
  staff_takeover_at: string | null;
  resolved: boolean;
  needs_attention: boolean;
  callback_requested: boolean;
  last_activity_at: string;
  last_error: string | null;
  service_address: string | null;
  services_discussed: unknown;
  quote_result: { total?: number } | null;
};

export type FilterBucket =
  | "all" | "needs_attention" | "ai_handling" | "waiting_customer"
  | "scheduling" | "booked" | "escalated" | "failed_delivery"
  | "campaign_paused" | "recently_active" | "unread";

export function isAiHandling(c: ConversationRow): boolean {
  return !c.staff_takeover_at && !c.resolved && c.booking_status !== "confirmed";
}

export function isHumanTakeover(c: ConversationRow): boolean {
  return !!c.staff_takeover_at;
}

export function classify(c: ConversationRow): FilterBucket[] {
  const buckets: FilterBucket[] = ["all"];
  if (c.needs_attention || c.callback_requested) buckets.push("needs_attention");
  if (isHumanTakeover(c)) buckets.push("escalated");
  if (isAiHandling(c)) buckets.push("ai_handling");
  if (c.booking_status === "confirmed") buckets.push("booked");
  if (c.booking_status === "scheduling" || c.conversation_state === "scheduling") {
    buckets.push("scheduling");
  }
  if (c.last_error) buckets.push("failed_delivery");
  if (c.campaign_status === "paused" || c.campaign_status === "paused_takeover") {
    buckets.push("campaign_paused");
  }
  const ageMs = Date.now() - new Date(c.last_activity_at).getTime();
  if (ageMs < 60 * 60 * 1000) buckets.push("recently_active");
  if (ageMs < 5 * 60 * 1000 && !c.resolved) buckets.push("waiting_customer");
  return buckets;
}

export function filterConversations(
  rows: ConversationRow[],
  bucket: FilterBucket,
  query = "",
): ConversationRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (bucket !== "all" && !classify(r).includes(bucket)) return false;
    if (!q) return true;
    const hay = [
      r.prospect_name, r.prospect_email, r.prospect_phone,
      r.service_address, r.channel,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function recommendNextAction(c: ConversationRow): string {
  if (c.callback_requested) return "Call customer back";
  if (c.last_error) return "Investigate delivery failure";
  if (isHumanTakeover(c)) return "Reply as staff or release to AI";
  if (c.booking_status === "confirmed") return "No action; booking confirmed";
  if (c.needs_attention) return "Review conversation";
  if (c.conversation_state === "scheduling") return "Confirm slot selection";
  return "AI will continue the conversation";
}

export function mergeTimeline(...streams: TimelineEvent[][]): TimelineEvent[] {
  const all = streams.flat();
  all.sort((a, b) => a.ts.localeCompare(b.ts));
  return all;
}