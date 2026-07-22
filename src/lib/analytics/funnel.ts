// Read-only funnel aggregation for Conversation & Conversion Analytics.
//
// Consumes canonical rows (already fetched from chat_conversations,
// chat_messages, quotes, bookings, ai_escalations, campaign_events) plus
// classified outcomes and returns a set of counts, rates, and medians for
// a given date range. All inputs are read-only; no writes happen here.

import type { ClassifiedOutcome, ConversationSnapshot } from "./outcomes";

export type DateRange = { start: Date; end: Date };

export type FunnelInputRow = {
  conversation_id: string;
  created_at: string;
  first_quote_at: string | null;
  first_booking_at: string | null;
  scheduling_started_at: string | null;
  slots_offered: number; // count of times AI presented a slot list
  booking_confirmation_requested: boolean;
  qualified_lead: boolean; // captured phone/email/service
  human_escalated: boolean;
  turns: number;
  snapshot: ConversationSnapshot;
  outcome: ClassifiedOutcome;
};

export type FunnelResult = {
  range: { start: string; end: string };
  counts: {
    new_conversations: number;
    qualified_leads: number;
    quotes_produced: number;
    scheduling_started: number;
    slots_offered_total: number;
    booking_confirmation_requested: number;
    bookings_completed: number;
    human_escalations: number;
    customer_dropoffs: number;
  };
  rates: {
    conversation_to_quote: number | null;
    quote_to_booking: number | null;
    scheduling_to_booking: number | null;
    ai_only_booking_rate: number | null;
    human_assisted_booking_rate: number | null;
  };
  medians: {
    time_to_quote_minutes: number | null;
    time_to_booking_minutes: number | null;
    turns: number | null;
  };
  outcomes: Record<string, number>;
};

const DROPOFF_OUTCOMES = new Set([
  "customer_inactive",
  "quote_not_booked",
]);

function inRange(iso: string | null, r: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function safeRate(n: number, d: number): number | null {
  if (d <= 0) return null;
  return n / d;
}

export function aggregateFunnel(
  rows: FunnelInputRow[],
  range: DateRange,
): FunnelResult {
  // A conversation belongs to the range if its created_at falls in it.
  const scoped = rows.filter((r) => inRange(r.created_at, range));

  let qualified = 0;
  let quotes = 0;
  let schedulingStarted = 0;
  let slotsOffered = 0;
  let confirmationRequested = 0;
  // De-duplicate bookings — one conversation counted at most once.
  const bookedIds = new Set<string>();
  const bookedAuto = new Set<string>();
  const bookedHuman = new Set<string>();
  let escalations = 0;
  let dropoffs = 0;

  const ttqMinutes: number[] = [];
  const ttbMinutes: number[] = [];
  const turns: number[] = [];
  const outcomes: Record<string, number> = {};

  for (const r of scoped) {
    if (r.qualified_lead) qualified++;
    if (r.first_quote_at) {
      quotes++;
      ttqMinutes.push(
        (new Date(r.first_quote_at).getTime() -
          new Date(r.created_at).getTime()) / 60_000,
      );
    }
    if (r.scheduling_started_at) schedulingStarted++;
    slotsOffered += r.slots_offered || 0;
    if (r.booking_confirmation_requested) confirmationRequested++;
    if (r.human_escalated) escalations++;

    const outcome = r.outcome.outcome;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;

    if (outcome === "booked_automatically" || outcome === "booked_after_human_assistance") {
      if (!bookedIds.has(r.conversation_id)) {
        bookedIds.add(r.conversation_id);
        if (outcome === "booked_automatically") bookedAuto.add(r.conversation_id);
        else bookedHuman.add(r.conversation_id);
        if (r.first_booking_at) {
          ttbMinutes.push(
            (new Date(r.first_booking_at).getTime() -
              new Date(r.created_at).getTime()) / 60_000,
          );
        }
      }
    }

    if (DROPOFF_OUTCOMES.has(outcome)) dropoffs++;
    if (r.turns > 0) turns.push(r.turns);
  }

  const bookings = bookedIds.size;
  const conversations = scoped.length;

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    counts: {
      new_conversations: conversations,
      qualified_leads: qualified,
      quotes_produced: quotes,
      scheduling_started: schedulingStarted,
      slots_offered_total: slotsOffered,
      booking_confirmation_requested: confirmationRequested,
      bookings_completed: bookings,
      human_escalations: escalations,
      customer_dropoffs: dropoffs,
    },
    rates: {
      conversation_to_quote: safeRate(quotes, conversations),
      quote_to_booking: safeRate(bookings, quotes),
      scheduling_to_booking: safeRate(bookings, schedulingStarted),
      ai_only_booking_rate: safeRate(bookedAuto.size, bookings),
      human_assisted_booking_rate: safeRate(bookedHuman.size, bookings),
    },
    medians: {
      time_to_quote_minutes: median(ttqMinutes),
      time_to_booking_minutes: median(ttbMinutes),
      turns: median(turns),
    },
    outcomes,
  };
}
