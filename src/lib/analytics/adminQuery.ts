// Admin-side loader that joins conversations, outcomes, bookings, and
// escalations into the shape the funnel aggregator expects. All queries are
// RLS-scoped to admins; there is no service-role usage here.

import { supabase } from "@/integrations/supabase/client";
import { classifyOutcome, type ConversationSnapshot } from "./outcomes";
import type { FunnelInputRow } from "./funnel";

export type ConversionFilters = {
  start: Date;
  end: Date;
  channel?: string | "all";
  outcome?: string | "all";
  campaign_status?: string | "all";
  service_area_status?: string | "all";
  escalated_only?: boolean;
};

export type LoadedRow = FunnelInputRow & {
  channel: string;
  campaign_status: string | null;
  service_area_status: string | null;
  services_summary: string;
  escalation_reason: string | null;
};

const MAX_ROWS = 5000;

export async function loadConversionRows(
  filters: ConversionFilters,
  inactivityThresholdMinutes: number,
): Promise<LoadedRow[]> {
  const startIso = filters.start.toISOString();
  const endIso = filters.end.toISOString();

  let query = supabase
    .from("chat_conversations")
    .select(
      "id, channel, status, created_at, last_activity_at, resolved, staff_takeover_at, booking_status, campaign_status, service_area_status, services_discussed, quote_result, last_error, needs_attention",
    )
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (filters.channel && filters.channel !== "all") {
    query = query.eq("channel", filters.channel);
  }
  if (filters.campaign_status && filters.campaign_status !== "all") {
    query = query.eq("campaign_status", filters.campaign_status);
  }
  if (filters.service_area_status && filters.service_area_status !== "all") {
    query = query.eq("service_area_status", filters.service_area_status);
  }

  const { data: conversations, error } = await query;
  if (error) throw new Error(error.message);
  const convs = conversations ?? [];
  if (convs.length === 0) return [];
  const ids = convs.map((c) => c.id);

  const [outcomesRes, bookingsRes, escalationsRes, messagesRes] = await Promise.all([
    supabase
      .from("conversation_outcomes")
      .select("conversation_id, outcome, deterministic, confidence, classifier_version, reason")
      .in("conversation_id", ids),
    supabase
      .from("bookings")
      .select("id, status, created_at, source_session_id")
      .in("source_session_id", ids),
    supabase
      .from("ai_escalations")
      .select("conversation_id, category, status, created_at")
      .in("conversation_id", ids),
    supabase
      .from("chat_messages")
      .select("conversation_id, role")
      .in("conversation_id", ids),
  ]);

  if (outcomesRes.error) throw new Error(outcomesRes.error.message);
  if (bookingsRes.error) throw new Error(bookingsRes.error.message);
  if (escalationsRes.error) throw new Error(escalationsRes.error.message);
  if (messagesRes.error) throw new Error(messagesRes.error.message);

  const outcomesById = new Map((outcomesRes.data ?? []).map((r) => [r.conversation_id, r]));
  const bookingsById = new Map<string, Array<{ id: string; status: string; created_at: string }>>();
  for (const b of bookingsRes.data ?? []) {
    const key = b.source_session_id as string | null;
    if (!key) continue;
    if (!bookingsById.has(key)) bookingsById.set(key, []);
    bookingsById.get(key)!.push({ id: b.id, status: b.status as string, created_at: b.created_at });
  }
  const escalationsById = new Map<string, { category: string | null; status: string | null }>();
  for (const e of escalationsRes.data ?? []) {
    if (!escalationsById.has(e.conversation_id)) {
      escalationsById.set(e.conversation_id, {
        category: (e.category as string | null) ?? null,
        status: (e.status as string | null) ?? null,
      });
    }
  }
  const turnsById = new Map<string, number>();
  for (const m of messagesRes.data ?? []) {
    if (m.role === "user") {
      turnsById.set(m.conversation_id, (turnsById.get(m.conversation_id) ?? 0) + 1);
    }
  }

  const rows: LoadedRow[] = [];
  for (const c of convs) {
    const outcomeRow = outcomesById.get(c.id);
    const bookings = bookingsById.get(c.id) ?? [];
    const escalation = escalationsById.get(c.id);
    const turns = turnsById.get(c.id) ?? 0;
    const quoteResult = (c.quote_result ?? null) as Record<string, unknown> | null;
    const hasQuote = !!quoteResult && Object.keys(quoteResult).length > 0;
    const declined = !!(quoteResult && (quoteResult as { declined?: boolean }).declined);

    const snap: ConversationSnapshot = {
      id: c.id,
      created_at: c.created_at,
      last_activity_at: c.last_activity_at ?? c.created_at,
      resolved: !!c.resolved,
      staff_takeover_at: c.staff_takeover_at ?? null,
      booking_status: c.booking_status ?? "",
      bookings: bookings.map((b) => ({
        id: b.id,
        status: b.status as ConversationSnapshot["bookings"][number]["status"],
        created_at: b.created_at,
      })),
      has_quote: hasQuote,
      quote_declined: declined,
      service_area_status: c.service_area_status ?? null,
      unsupported_scope: false,
      last_error: c.last_error ?? null,
      escalation_open: escalation?.status === "open" || escalation?.status === "pending",
      complaint: false,
      spam: false,
      turns,
      ai_classification: null,
    };

    const outcome = outcomeRow
      ? {
          outcome: outcomeRow.outcome as ReturnType<typeof classifyOutcome>["outcome"],
          deterministic: !!outcomeRow.deterministic,
          reason: outcomeRow.reason ?? "persisted",
          confidence: Number(outcomeRow.confidence ?? 1),
          classifier_version: outcomeRow.classifier_version ?? "persisted",
          evidence: {},
        }
      : classifyOutcome(snap, { inactivityThresholdMinutes });

    if (filters.outcome && filters.outcome !== "all" && outcome.outcome !== filters.outcome) continue;
    if (filters.escalated_only && !escalation) continue;

    const services = Array.isArray(c.services_discussed)
      ? (c.services_discussed as unknown[]).map((s) => (typeof s === "string" ? s : (s as { key?: string }).key ?? "")).filter(Boolean)
      : [];

    rows.push({
      conversation_id: c.id,
      created_at: c.created_at,
      first_quote_at: hasQuote ? c.last_activity_at ?? c.created_at : null,
      first_booking_at: bookings[0]?.created_at ?? null,
      scheduling_started_at: c.booking_status && c.booking_status !== "not_started" ? c.last_activity_at ?? c.created_at : null,
      slots_offered: 0,
      booking_confirmation_requested: c.booking_status === "pending_confirmation" || bookings.length > 0,
      qualified_lead: hasQuote || bookings.length > 0,
      human_escalated: !!escalation,
      turns,
      snapshot: snap,
      outcome,
      channel: c.channel ?? "unknown",
      campaign_status: c.campaign_status ?? null,
      service_area_status: c.service_area_status ?? null,
      services_summary: services.join("|") || "unknown",
      escalation_reason: escalation?.category ?? null,
    });
  }
  return rows;
}

export async function loadAnalyticsConfig(): Promise<{ inactivity_threshold_minutes: number }> {
  const { data, error } = await supabase
    .from("analytics_config")
    .select("inactivity_threshold_minutes")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return { inactivity_threshold_minutes: 60 };
  return { inactivity_threshold_minutes: data.inactivity_threshold_minutes };
}