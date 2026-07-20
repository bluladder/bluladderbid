// Read-only ops-health aggregation helpers. Pure functions so we can unit-test
// classification without needing a live database.

export type SmsRow = {
  id: string;
  channel: string | null;       // 'sms' | 'email' | null
  status: string | null;        // 'pending' | 'sent' | 'failed' | 'dlq' | ...
  message_kind: string | null;  // 'transactional' | 'campaign' | ...
  created_at: string;
  sent_at: string | null;
  send_at: string | null;
  error: string | null;
};

export type BookingRow = {
  id: string;
  status: string | null;
  created_at: string;
  booking_completed_at: string | null;
  cancelled_at: string | null;
};

export type QuoteRow = {
  id: string;
  status: string | null;
  saved_at: string | null;
  converted_at: string | null;
  superseded_at: string | null;
};

export type ConversationRow = {
  id: string;
  staff_takeover_at: string | null;
  needs_attention: boolean | null;
  last_activity_at: string | null;
  last_error: string | null;
  resolved: boolean | null;
  booking_status: string | null;
};

export type HealthMetrics = {
  conversationsToday: number;
  quotesToday: number;
  bookingsToday: number;
  conversionRate: number;
  aiHandled: number;
  humanEscalations: number;
  waitingForResponse: number;
  failedSms: number;
  failedEmail: number;
  oldestQueuedAgeMinutes: number | null;
  campaignQueueBacklog: number;
  failedDeliveryLast24h: number;
};

function isToday(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function within(iso: string | null, now: Date, ms: number): boolean {
  if (!iso) return false;
  return now.getTime() - new Date(iso).getTime() <= ms;
}

export function computeHealth(input: {
  conversations: ConversationRow[];
  quotes: QuoteRow[];
  bookings: BookingRow[];
  sms: SmsRow[];
  now?: Date;
}): HealthMetrics {
  const now = input.now ?? new Date();
  const HOUR = 60 * 60 * 1000;

  const quotesToday = input.quotes.filter(
    (q) => isToday(q.saved_at ?? null, now) && !q.superseded_at,
  ).length;

  const bookingsToday = input.bookings.filter(
    (b) => isToday(b.booking_completed_at ?? b.created_at, now)
      && b.status !== "cancelled",
  ).length;

  const conversationsToday = input.conversations.filter(
    (c) => isToday(c.last_activity_at, now),
  ).length;

  const conversionRate = quotesToday > 0
    ? Math.round((bookingsToday / quotesToday) * 100) / 100
    : 0;

  const aiHandled = input.conversations.filter(
    (c) => !c.staff_takeover_at && !c.resolved
      && within(c.last_activity_at, now, 24 * HOUR),
  ).length;

  const humanEscalations = input.conversations.filter(
    (c) => !!c.staff_takeover_at && !c.resolved,
  ).length;

  const waitingForResponse = input.conversations.filter(
    (c) => !c.resolved
      && (c.needs_attention === true || c.booking_status === "scheduling"),
  ).length;

  const failedInLast24h = (channel: "sms" | "email") =>
    input.sms.filter(
      (m) => (m.channel ?? "sms") === channel
        && (m.status === "failed" || m.status === "dlq")
        && within(m.created_at, now, 24 * HOUR),
    ).length;

  const failedSms = failedInLast24h("sms");
  const failedEmail = failedInLast24h("email");

  const pending = input.sms.filter((m) => m.status === "pending");
  const oldestQueuedAgeMinutes = pending.length
    ? Math.floor(
        (now.getTime() - Math.min(
          ...pending.map((m) => new Date(m.send_at ?? m.created_at).getTime()),
        )) / 60000,
      )
    : null;

  const campaignQueueBacklog = input.sms.filter(
    (m) => m.status === "pending" && m.message_kind === "campaign",
  ).length;

  const failedDeliveryLast24h = failedSms + failedEmail;

  return {
    conversationsToday,
    quotesToday,
    bookingsToday,
    conversionRate,
    aiHandled,
    humanEscalations,
    waitingForResponse,
    failedSms,
    failedEmail,
    oldestQueuedAgeMinutes,
    campaignQueueBacklog,
    failedDeliveryLast24h,
  };
}