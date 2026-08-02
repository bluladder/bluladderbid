// ============================================================================
// availabilityLookup — the ONE canonical, READ-ONLY availability service the
// AI draft-reply layer uses to fetch real appointment options.
//
// This module does NOT re-implement scheduling. It composes:
//
//   * bookingReadiness.getBookingReadiness    — authoritative preconditions
//                                                 (identity, property, quote
//                                                  inputs, canonical total,
//                                                  duration, manual-review,
//                                                  schedule freshness)
//   * evaluateAutonomousSendGate              — safety + action-class gating
//                                                 for the "scheduling" class
//   * scheduleFreshness.getMirrorFreshness    — re-checked immediately before
//                                                 dispatch (fail-closed on
//                                                 drift between readiness and
//                                                 execution)
//   * jobber-availability edge function        — the SINGLE production
//                                                 availability engine
//                                                 (services, prices, travel,
//                                                 working hours, crew
//                                                 anchoring, existing Jobber
//                                                 jobs, mirrored bookings,
//                                                 reservations, blackouts,
//                                                 route density, buffers,
//                                                 minimum notice, compaction)
//
// HARD RULES
//   * The tool NEVER inserts, updates, deletes, RPC-reserves, holds, confirms,
//     releases, or creates any booking / slot reservation / confirmation.
//   * The model MAY NOT pass: customer id, property id, quote session id,
//     crew id, duration, service area id, price, or an arbitrary date range.
//     Those come from the conversation via readiness — not the model.
//   * Model-supplied preferences are limited to: preferred_date OR
//     preferred_day, time_of_day, max_options. All normalized SERVER-SIDE.
//   * Result count is capped at MAX_OPTIONS (4).
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import {
  type BookingReadiness,
  getBookingReadiness,
} from "./bookingReadiness.ts";
import {
  type AutonomousGateDecision,
  evaluateAutonomousSendGate,
} from "./autonomousSendGate.ts";
import { getMirrorFreshness } from "./scheduleFreshness.ts";
import { findByConversation } from "./quoteSession.ts";
import {
  formatServiceAddress,
  sameAddress,
} from "./profile/normalizeAddress.ts";
import { buildOfferSlotId } from "./slotOffer.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "./publicBookingServiceArea.ts";

type SB = any;

export const MAX_OPTIONS = 4;
// Match production booking UI: normal next-available search window.
export const DEFAULT_DAYS_TO_CHECK = 14;
// Business timezone anchor. jobber-availability defaults to America/Chicago
// via DEFAULT_BUSINESS_HOURS and does not echo the resolved tz in its
// response, so we surface the same canonical zone to the caller.
export const BUSINESS_TIMEZONE = "America/Chicago";

const DOW_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

export interface AvailabilitySlot {
  slot_id: string;
  date: string; // YYYY-MM-DD in business timezone
  start_at: string; // ISO
  end_at: string; // ISO
  timezone: string;
  arrival_window_label: string;
  customer_label: string;
  preference_match: boolean;
  /** Internal — jobber user ids of the crew currently anchoring the slot.
   *  Never surfaced in customer-visible SMS bodies. Used by slotHold to
   *  reserve the exact crew when the customer picks this option. */
  crew_ids?: string[];
}

export type AvailabilityStatus =
  | "ok"
  | "not_ready"
  | "gate_blocked"
  | "schedule_drifted"
  | "preference_ambiguous"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "engine_error"
  | "no_slots";

export interface AvailabilityLookupInput {
  preferred_date?: string | null; // YYYY-MM-DD
  preferred_day?: string | null; // "monday" | "tomorrow" | "next week" ...
  time_of_day?: "morning" | "afternoon" | null;
  max_options?: number | null;
}

export interface AvailabilityLookupResult {
  status: AvailabilityStatus;
  slots: AvailabilitySlot[];
  /** True only after the canonical provider fetcher was actually invoked. */
  provider_contacted?: boolean;
  readiness?: BookingReadiness;
  blockers?: BookingReadiness["blockers"];
  next_action?: BookingReadiness["next_action"];
  gate_reason?: string | null;
  detail?: string | null;
  normalized_preference?: {
    date: string | null;
    range: "single_day" | "next_week" | "default";
    time_of_day: "morning" | "afternoon" | null;
  };
}

// ----------------------------------------------------------------------------
// Preference normalization — server-side ONLY. Never lets an ambiguous string
// silently select a distant date. Anything we can't confidently resolve to a
// date within a small window returns `ambiguous=true` so the tool asks for
// clarification instead of guessing.
// ----------------------------------------------------------------------------
function todayInBusinessTz(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(dateStr: string, days: number): string {
  // dateStr is YYYY-MM-DD interpreted in the business zone. We treat the date
  // arithmetic as calendar-day math, ignoring DST offsets (safe: we only ever
  // return a YYYY-MM-DD, not a specific timestamp).
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function businessDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface NormalizedPreference {
  ambiguous: boolean;
  ambiguous_reason?: string;
  startDate?: string; // YYYY-MM-DD
  daysToCheck: number;
  range: "single_day" | "next_week" | "default";
  timeOfDay: "morning" | "afternoon" | null;
  preferenceMatchDate?: string; // used to flag preference_match on slots
}

export function normalizePreference(
  input: AvailabilityLookupInput,
  today: string = todayInBusinessTz(),
): NormalizedPreference {
  const timeOfDay =
    input.time_of_day === "morning" || input.time_of_day === "afternoon"
      ? input.time_of_day
      : null;

  // 1. Explicit YYYY-MM-DD wins. Must be today or later.
  const rawDate = typeof input.preferred_date === "string"
    ? input.preferred_date.trim()
    : "";
  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return {
        ambiguous: true,
        ambiguous_reason: "preferred_date_format",
        daysToCheck: 1,
        range: "single_day",
        timeOfDay,
      };
    }
    if (rawDate < today) {
      return {
        ambiguous: true,
        ambiguous_reason: "preferred_date_in_past",
        daysToCheck: 1,
        range: "single_day",
        timeOfDay,
      };
    }
    return {
      ambiguous: false,
      startDate: rawDate,
      daysToCheck: 1,
      range: "single_day",
      timeOfDay,
      preferenceMatchDate: rawDate,
    };
  }

  // 2. Textual day preference.
  const rawDay = typeof input.preferred_day === "string"
    ? input.preferred_day.trim().toLowerCase()
    : "";
  if (rawDay) {
    if (rawDay === "today") {
      return {
        ambiguous: false,
        startDate: today,
        daysToCheck: 1,
        range: "single_day",
        timeOfDay,
        preferenceMatchDate: today,
      };
    }
    if (rawDay === "tomorrow") {
      const t = addDaysISO(today, 1);
      return {
        ambiguous: false,
        startDate: t,
        daysToCheck: 1,
        range: "single_day",
        timeOfDay,
        preferenceMatchDate: t,
      };
    }
    if (rawDay === "next week") {
      // Next Monday, then Mon-Fri window.
      const dow = businessDayOfWeek(today);
      // Days until next Monday (never today; always the FOLLOWING week).
      const delta = ((1 - dow + 7) % 7) || 7;
      const start = addDaysISO(today, delta);
      return {
        ambiguous: false,
        startDate: start,
        daysToCheck: 5,
        range: "next_week",
        timeOfDay,
      };
    }
    if (rawDay === "this week") {
      return {
        ambiguous: false,
        startDate: today,
        daysToCheck: 7,
        range: "default",
        timeOfDay,
      };
    }
    if (rawDay in DOW_MAP) {
      const targetDow = DOW_MAP[rawDay];
      const dow = businessDayOfWeek(today);
      const delta = ((targetDow - dow + 7) % 7) || 7; // never "today"; nearest FUTURE occurrence
      const start = addDaysISO(today, delta);
      return {
        ambiguous: false,
        startDate: start,
        daysToCheck: 1,
        range: "single_day",
        timeOfDay,
        preferenceMatchDate: start,
      };
    }
    return {
      ambiguous: true,
      ambiguous_reason: "preferred_day_unrecognized",
      daysToCheck: DEFAULT_DAYS_TO_CHECK,
      range: "default",
      timeOfDay,
    };
  }

  // 3. No preference: normal next-available window.
  return {
    ambiguous: false,
    daysToCheck: DEFAULT_DAYS_TO_CHECK,
    range: "default",
    timeOfDay,
  };
}

function ymdInBusinessTz(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function hourInBusinessTz(iso: string): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(new Date(iso));
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function labelArrivalWindow(iso: string): string {
  // 2-hour arrival window rounded to the slot start hour.
  const start = new Date(iso);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Pull the crew (jobber user) ids the engine anchored to a raw slot. The
 *  engine exposes `technicianId` (crew leader) and optionally an assistant
 *  in team mode via `secondaryTechnicianId` / `additionalTechnicianIds`.
 *  Everything is filtered to non-empty strings; duplicates removed while
 *  preserving order. */
function extractCrewIds(raw: any): string[] {
  const ids: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.length > 0 && !ids.includes(v)) ids.push(v);
  };
  push(raw?.technicianId);
  push(raw?.secondaryTechnicianId);
  const arr = raw?.additionalTechnicianIds ?? raw?.crewIds ??
    raw?.assignedTechnicians;
  if (Array.isArray(arr)) { for (const v of arr) push(v); }
  return ids;
}

// ----------------------------------------------------------------------------
// Extract services + prices from the CACHED, verified-current quote result.
// bookingReadiness has already proven inputs_current + pricing_current +
// bookableStatus + positive total + positive duration before this runs, so we
// can trust the cached line items.
// ----------------------------------------------------------------------------
function extractServicesFromSession(
  session: any,
): { service: string; price: number }[] {
  const fields = (session?.fields ?? {}) as Record<string, unknown>;
  const last = (fields as any).lastQuoteResult;
  const items =
    Array.isArray(last?.jobberLineItems) && last.jobberLineItems.length > 0
      ? last.jobberLineItems
      : Array.isArray(last?.lineItems)
      ? last.lineItems
      : [];
  return items
    .map((li: any) => ({
      service: String(li.name ?? li.label ?? "service"),
      price: Number(li.unitPrice ?? li.amount ?? 0),
    }))
    .filter((s: { price: number }) => Number.isFinite(s.price) && s.price >= 0);
}

async function fetchConversationContext(
  supabase: SB,
  conversationId: string,
  expectedOrganizationId: string | null = null,
) {
  let query = supabase
    .from("chat_conversations")
    .select("id, organization_id, prospect_phone, service_address, property_id")
    .eq("id", conversationId);
  if (expectedOrganizationId) {
    query = query.eq("organization_id", expectedOrganizationId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("availability_conversation_lookup_failed");
  return data ?? null;
}

async function fetchPropertyAddress(
  supabase: SB,
  propertyId: string | null,
  organizationId: string | null,
): Promise<string | null> {
  if (!propertyId) return null;
  try {
    let query = supabase
      .from("properties")
      .select("street, city, state, postal_code")
      .eq("id", propertyId);
    query = organizationId
      ? query.eq("organization_id", organizationId)
      : query.is("organization_id", null);
    const { data } = await query.maybeSingle();
    if (!data) return null;
    return formatServiceAddress(data);
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Wire call to the single production availability engine. Never invoked
// unless every precondition passes.
// ----------------------------------------------------------------------------
export type AvailabilityFetcher = (
  body: Record<string, unknown>,
) => Promise<{ status: number; json: any }>;

async function defaultFetcher(
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let resp: Response;
  try {
    resp = await fetch(`${SUPABASE_URL}/functions/v1/jobber-availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    return {
      status: 599,
      json: { error: "provider_timeout", detail: String(error).slice(0, 120) },
    };
  }
  let json: any = null;
  try {
    json = await resp.json();
  } catch { /* keep null */ }
  return { status: resp.status, json };
}

export interface GetAvailableSlotsDeps {
  fetcher?: AvailabilityFetcher;
  readinessOverride?: BookingReadiness;
  /** Server-derived tenant authority. Voice callers must always provide it. */
  expectedOrganizationId?: string | null;
  /** Voice live booking currently requires the entire quote to be firm. */
  requireFullyFirmQuote?: boolean;
  /** Test-only injection. Production code MUST NOT set this. */
  gateOverride?: AutonomousGateDecision;
}

export async function getAvailableSlots(
  supabase: SB,
  conversationId: string,
  input: AvailabilityLookupInput,
  deps: GetAvailableSlotsDeps = {},
): Promise<AvailabilityLookupResult> {
  const expectedOrganizationId = deps.expectedOrganizationId ?? null;
  if (
    deps.expectedOrganizationId !== undefined && !expectedOrganizationId
  ) {
    return {
      status: "not_ready",
      slots: [],
      next_action: "staff_intervention",
      detail: "organization_context_missing",
    };
  }

  // ---- 1. Autonomous send / scheduling action gate (fail-closed) ----------
  let convo: any = null;
  try {
    convo = await fetchConversationContext(
      supabase,
      conversationId,
      expectedOrganizationId,
    );
  } catch {
    return {
      status: "not_ready",
      slots: [],
      next_action: "staff_intervention",
      detail: "organization_context_unreadable",
    };
  }
  if (
    expectedOrganizationId &&
    (!convo || convo.organization_id !== expectedOrganizationId)
  ) {
    return {
      status: "not_ready",
      slots: [],
      next_action: "staff_intervention",
      detail: "organization_context_mismatch",
    };
  }
  const organizationId = expectedOrganizationId ??
    (typeof convo?.organization_id === "string" && convo.organization_id.trim()
      ? convo.organization_id.trim().toLowerCase()
      : null);
  if (!organizationId) {
    return {
      status: "not_ready",
      slots: [],
      next_action: "staff_intervention",
      detail: "organization_context_missing",
    };
  }
  const gate = deps.gateOverride ??
    (await evaluateAutonomousSendGate(supabase, {
      conversationId,
      phone: convo?.prospect_phone ?? null,
      actionClass: "scheduling",
    }));
  if (!gate.allow) {
    return {
      status: "gate_blocked",
      slots: [],
      gate_reason: gate.reason ?? "gate_denied",
      detail: gate.detail ?? null,
    };
  }

  // ---- 2. Authoritative readiness ----------------------------------------
  const readiness = deps.readinessOverride ??
    (await getBookingReadiness(
      supabase,
      conversationId,
      organizationId,
    ));
  if (
    !readiness.ready ||
    readiness.next_action !== "show_availability" ||
    readiness.identity.status !== "resolved" ||
    !readiness.property.selected ||
    !readiness.property.authorized ||
    !readiness.quote.required_fields_complete ||
    !readiness.quote.inputs_current ||
    readiness.quote.canonical_total == null ||
    !readiness.quote.pricing_current ||
    (deps.requireFullyFirmQuote === true &&
      (readiness.quote.manual_review_required ||
        readiness.quote.final_disposition !== "firm")) ||
    !readiness.duration.resolved ||
    !readiness.duration.minutes ||
    readiness.duration.minutes <= 0 ||
    !readiness.schedule.readable ||
    !readiness.schedule.fresh
  ) {
    return {
      status: "not_ready",
      slots: [],
      readiness,
      blockers: readiness.blockers,
      next_action: readiness.next_action,
    };
  }

  // ---- 3. Re-check schedule freshness immediately before dispatch --------
  // If the mirror drifted between readiness and now, fail closed.
  const freshNow = await getMirrorFreshness(supabase);
  if (!freshNow.ok || freshNow.reason !== "fresh") {
    return {
      status: "schedule_drifted",
      slots: [],
      readiness,
      next_action: "refresh_schedule",
      detail: `mirror.reason=${freshNow.reason}`,
    };
  }

  // ---- 4. Normalize preference SERVER-SIDE -------------------------------
  const pref = normalizePreference(input);
  if (pref.ambiguous) {
    return {
      status: "preference_ambiguous",
      slots: [],
      readiness,
      detail: pref.ambiguous_reason ?? "ambiguous_preference",
      normalized_preference: {
        date: pref.startDate ?? null,
        range: pref.range,
        time_of_day: pref.timeOfDay,
      },
    };
  }

  // ---- 5. Build the availability request from AUTHORITATIVE context -----
  // Session read is strict read-only via findByConversation (no writes).
  // The deployed Jobber availability endpoint is an explicitly bounded DFW
  // connector. Never let a newly mapped tenant inherit that global connector.
  // Additional organizations must activate an organization-scoped connector
  // before provider dispatch is permitted.
  if (organizationId !== PUBLIC_BOOKING_ORGANIZATION_ID) {
    return {
      status: "not_ready",
      slots: [],
      readiness,
      next_action: "staff_intervention",
      detail: "provider_connector_unavailable_for_organization",
    };
  }
  const session = await findByConversation(
    supabase,
    conversationId,
    organizationId,
  );
  const services = extractServicesFromSession(session);
  if (services.length === 0) {
    // Should have been caught by readiness; belt-and-suspenders.
    return {
      status: "not_ready",
      slots: [],
      readiness,
      blockers: readiness.blockers,
      next_action: "collect_quote_inputs",
    };
  }
  const propertyAddress = await fetchPropertyAddress(
    supabase,
    convo?.property_id ?? null,
    organizationId,
  );
  const sessionAddress = typeof session?.fields.address === "string"
    ? session.fields.address.trim()
    : "";
  const conversationAddress = typeof convo?.service_address === "string"
    ? convo.service_address.trim()
    : "";
  if (
    !propertyAddress || !sessionAddress || !conversationAddress ||
    !sameAddress(propertyAddress, sessionAddress) ||
    !sameAddress(propertyAddress, conversationAddress)
  ) {
    return {
      status: "not_ready",
      slots: [],
      readiness,
      next_action: "verify_service_area",
      detail: "booking_address_lineage_mismatch",
    };
  }
  const address = propertyAddress;

  const requestedMax = Number(input.max_options);
  const cap = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.min(Math.floor(requestedMax), MAX_OPTIONS)
    : MAX_OPTIONS;

  const body: Record<string, unknown> = {
    services,
    daysToCheck: pref.daysToCheck,
    mode: "recommended",
    preference: pref.timeOfDay === "morning"
      ? "AM"
      : pref.timeOfDay === "afternoon"
      ? "PM"
      : "none",
  };
  if (pref.startDate) body.startDate = pref.startDate;
  if (address) body.customerAddress = address;

  const fetcher = deps.fetcher ?? defaultFetcher;
  const { status, json } = await fetcher(body);

  if (status === 599 && json?.error === "provider_timeout") {
    return {
      status: "provider_timeout",
      slots: [],
      readiness,
      detail: "availability_provider_timeout",
      provider_contacted: true,
    };
  }
  if (status === 429) {
    return {
      status: "provider_rate_limited",
      slots: [],
      readiness,
      detail: "availability_provider_rate_limited",
      provider_contacted: true,
    };
  }
  if (status === 502 || status === 503 || status === 504) {
    return {
      status: "provider_unavailable",
      slots: [],
      readiness,
      detail: `availability_provider_status_${status}`,
      provider_contacted: true,
    };
  }
  if (status !== 200 || !json) {
    return {
      status: "engine_error",
      slots: [],
      readiness,
      detail: `availability_engine_status_${status}`,
      provider_contacted: true,
    };
  }
  if (
    json.availability_unavailable || json.stale || json.syncInProgress ||
    json.error
  ) {
    return {
      status: "schedule_drifted",
      slots: [],
      readiness,
      next_action: "refresh_schedule",
      provider_contacted: true,
      detail: json.reason || json.error || "engine_reported_unavailable",
    };
  }

  const raw: any[] = Array.isArray(json.recommendations)
    ? json.recommendations
    : Array.isArray(json.rankedSlots)
    ? json.rankedSlots
    : Array.isArray(json.slots)
    ? json.slots
    : [];

  const version = Date.now().toString(36);
  const seen = new Set<string>();
  const slots: AvailabilitySlot[] = [];
  const canonicalDurationMinutes = readiness.duration.minutes!;
  let durationRejected = 0;
  for (const s of raw) {
    if (slots.length >= cap) break;
    if (!s?.startTime || !s?.endTime) continue;
    const startAt = String(s.startTime);
    const providerEndAt = String(s.endTime);
    const startMs = Date.parse(startAt);
    const intervalMinutes = (Date.parse(providerEndAt) - startMs) / 60_000;
    // The availability provider currently derives technician-specific
    // durations independently. It may offer a slot only when the actual
    // returned interval is at least the canonical quote duration. This keeps
    // the provider's narrower estimate from overriding the merged contract.
    if (
      !Number.isFinite(intervalMinutes) ||
      intervalMinutes < canonicalDurationMinutes
    ) {
      durationRejected++;
      continue;
    }
    // A provider may return a wider free block than the job actually needs.
    // Offer only the canonical appointment interval so the spoken offer and
    // downstream booking command agree on the exact end time.
    const endAt = new Date(
      startMs + canonicalDurationMinutes * 60_000,
    ).toISOString();
    const date = ymdInBusinessTz(startAt);
    const key = `${date}|${startAt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let matches = true;
    if (pref.preferenceMatchDate) {
      matches = matches && date === pref.preferenceMatchDate;
    }
    if (pref.timeOfDay) {
      const h = hourInBusinessTz(startAt);
      const isAM = h < 12;
      matches = matches &&
        ((pref.timeOfDay === "morning" && isAM) ||
          (pref.timeOfDay === "afternoon" && !isAM));
    }

    slots.push({
      slot_id: buildOfferSlotId(version, slots.length),
      date,
      start_at: startAt,
      end_at: endAt,
      timezone: BUSINESS_TIMEZONE,
      arrival_window_label: labelArrivalWindow(startAt),
      customer_label: typeof s.displayTime === "string" && s.displayTime
        ? s.displayTime
        : labelArrivalWindow(startAt),
      preference_match: !!matches,
      crew_ids: extractCrewIds(s),
    });
  }

  if (slots.length === 0) {
    return {
      status: "no_slots",
      slots: [],
      readiness,
      provider_contacted: true,
      normalized_preference: {
        date: pref.startDate ?? null,
        range: pref.range,
        time_of_day: pref.timeOfDay,
      },
      detail: raw.length > 0 && durationRejected > 0
        ? "provider_slots_shorter_than_canonical_duration"
        : null,
    };
  }

  return {
    status: "ok",
    slots,
    readiness,
    provider_contacted: true,
    normalized_preference: {
      date: pref.startDate ?? null,
      range: pref.range,
      time_of_day: pref.timeOfDay,
    },
  };
}
