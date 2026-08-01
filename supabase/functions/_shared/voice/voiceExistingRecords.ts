// Secure existing-record lookup and mutation planning for inbound voice.
// Caller ID is only a lookup hint; all records stay hidden until the canonical
// identity anchor and organization lineage are resolved.
// deno-lint-ignore-file no-explicit-any

import { readIdentityAnchor } from "../identityAnchor.ts";
import { assertOrganizationLineage } from "../organizationResolver.ts";
import { classifyExplicitConfirmation } from "./voiceJourneyContract.ts";

type SB = any;

export interface VoiceQuoteRecord {
  id: string;
  status: string;
  total: number | null;
  updatedAt: string | null;
  expiresAt: string | null;
  supersededAt: string | null;
  sourceSessionId: string | null;
}

export interface VoiceBookingRecord {
  id: string;
  referenceNumber: string | null;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  durationMinutes: number | null;
  quoteId: string | null;
  bookingVersion: number;
}

export type ExistingRecordResult =
  | {
    status:
      | "identity_required"
      | "identity_ambiguous"
      | "organization_unresolved";
    quotes: [];
    bookings: [];
  }
  | {
    status: "resolved";
    customerId: string;
    quotes: VoiceQuoteRecord[];
    bookings: VoiceBookingRecord[];
  };

export async function loadVerifiedVoiceRecords(
  supabase: SB,
  args: {
    conversationId: string;
    resolvedOrganizationId: string | null;
    allowUnscopedLegacyDfw?: boolean;
  },
): Promise<ExistingRecordResult> {
  const identity = await readIdentityAnchor(supabase, args.conversationId);
  if (identity.identity_status === "ambiguous") {
    return { status: "identity_ambiguous", quotes: [], bookings: [] };
  }
  if (identity.identity_status !== "resolved") {
    return { status: "identity_required", quotes: [], bookings: [] };
  }
  const customerId = identity.confirmed_email_customer_id ??
    identity.resolved_customer_id;
  if (!customerId || !args.resolvedOrganizationId) {
    return { status: "organization_unresolved", quotes: [], bookings: [] };
  }

  const quoteQuery = supabase.from("quotes")
    .select(
      "id,status,total,updated_at,expires_at,superseded_at,source_session_id,organization_id",
    )
    .eq("customer_id", customerId)
    .order("updated_at", { ascending: false })
    .limit(5);
  const bookingQuery = supabase.from("bookings")
    .select(
      "id,reference_number,status,scheduled_start,scheduled_end,duration_minutes,quote_id,booking_version,organization_id",
    )
    .eq("customer_id", customerId)
    .order("scheduled_start", { ascending: false })
    .limit(5);
  const scopeToOrganization = (query: any) =>
    args.allowUnscopedLegacyDfw === true
      ? query.or(
        `organization_id.eq.${args.resolvedOrganizationId},organization_id.is.null`,
      )
      : query.eq("organization_id", args.resolvedOrganizationId);
  const [
    { data: quoteRows, error: quoteError },
    { data: bookingRows, error: bookingError },
  ] = await Promise.all([
    scopeToOrganization(quoteQuery),
    scopeToOrganization(bookingQuery),
  ]);
  if (quoteError || bookingError) {
    return { status: "organization_unresolved", quotes: [], bookings: [] };
  }

  try {
    for (const row of [...(quoteRows ?? []), ...(bookingRows ?? [])]) {
      assertOrganizationLineage(
        args.resolvedOrganizationId,
        row.organization_id ?? null,
        { allowUnscopedLegacy: args.allowUnscopedLegacyDfw === true },
      );
    }
  } catch {
    return { status: "organization_unresolved", quotes: [], bookings: [] };
  }

  return {
    status: "resolved",
    customerId,
    quotes: (quoteRows ?? []).map((row: any) => ({
      id: row.id,
      status: row.status ?? "unknown",
      total: Number.isFinite(Number(row.total)) ? Number(row.total) : null,
      updatedAt: row.updated_at ?? null,
      expiresAt: row.expires_at ?? null,
      supersededAt: row.superseded_at ?? null,
      sourceSessionId: row.source_session_id ?? null,
    })),
    bookings: (bookingRows ?? []).map((row: any) => ({
      id: row.id,
      referenceNumber: row.reference_number ?? null,
      status: row.status ?? "unknown",
      scheduledStart: row.scheduled_start ?? null,
      scheduledEnd: row.scheduled_end ?? null,
      durationMinutes: Number.isFinite(Number(row.duration_minutes))
        ? Number(row.duration_minutes)
        : null,
      quoteId: row.quote_id ?? null,
      bookingVersion: Number.isFinite(Number(row.booking_version))
        ? Number(row.booking_version)
        : 0,
    })),
  };
}

export type QuoteContinuationDecision =
  | { status: "usable"; quote: VoiceQuoteRecord }
  | { status: "expired_or_superseded"; quote: VoiceQuoteRecord }
  | { status: "manual_review"; quote: VoiceQuoteRecord }
  | { status: "not_found" };

export function selectLatestQuoteForContinuation(
  quotes: readonly VoiceQuoteRecord[],
  now = Date.now(),
): QuoteContinuationDecision {
  const quote = quotes[0];
  if (!quote) return { status: "not_found" };
  if (
    quote.supersededAt || quote.status === "superseded" ||
    (quote.expiresAt && new Date(quote.expiresAt).getTime() <= now) ||
    quote.status === "expired"
  ) {
    return { status: "expired_or_superseded", quote };
  }
  if (
    quote.status === "manual_review" ||
    quote.status === "manual_review_required"
  ) {
    return { status: "manual_review", quote };
  }
  return { status: "usable", quote };
}

export type DestructiveActionPlan =
  | { status: "confirmation_required"; booking: VoiceBookingRecord }
  | { status: "authorized"; booking: VoiceBookingRecord }
  | { status: "declined"; booking: VoiceBookingRecord }
  | { status: "not_found" | "ambiguous_booking" | "terminal_booking" };

export function planDestructiveAppointmentAction(
  bookings: readonly VoiceBookingRecord[],
  args: { bookingId?: string | null; confirmation?: string | null },
): DestructiveActionPlan {
  const active = bookings.filter((booking) =>
    !["cancelled", "completed"].includes(booking.status)
  );
  const selected = args.bookingId
    ? active.find((booking) => booking.id === args.bookingId)
    : active.length === 1
    ? active[0]
    : null;
  if (!selected) {
    return active.length > 1
      ? { status: "ambiguous_booking" }
      : { status: "not_found" };
  }
  if (["cancelled", "completed"].includes(selected.status)) {
    return { status: "terminal_booking" };
  }
  if (!args.confirmation) {
    return { status: "confirmation_required", booking: selected };
  }
  const confirmation = classifyExplicitConfirmation(args.confirmation);
  if (confirmation === "confirmed") {
    return { status: "authorized", booking: selected };
  }
  if (confirmation === "declined") {
    return { status: "declined", booking: selected };
  }
  return { status: "confirmation_required", booking: selected };
}

export interface FieldTeamMemo {
  bookingId: string;
  customerId: string;
  text: string;
  source: "voice";
}

export function buildFieldTeamMemo(args: {
  bookingId: string;
  customerId: string;
  text: string;
}): FieldTeamMemo | null {
  const text = args.text.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!args.bookingId || !args.customerId || !text) return null;
  return { ...args, text, source: "voice" };
}

export type PersistFieldTeamMemoResult =
  | { status: "recorded" | "duplicate" }
  | {
    status:
      | "identity_mismatch"
      | "organization_mismatch"
      | "booking_missing"
      | "write_failed";
  };

/**
 * Append an idempotent, locally visible field-team note only after the exact
 * customer, booking, and organization lineage are verified. This does not
 * claim that a Jobber note was updated and does not alter quote state.
 */
export async function persistVerifiedFieldTeamMemo(
  supabase: SB,
  args: {
    conversationId: string;
    resolvedOrganizationId: string;
    allowUnscopedLegacyDfw?: boolean;
    memo: FieldTeamMemo;
  },
): Promise<PersistFieldTeamMemoResult> {
  const identity = await readIdentityAnchor(supabase, args.conversationId);
  const customerId = identity.confirmed_email_customer_id ??
    identity.resolved_customer_id;
  if (
    identity.identity_status !== "resolved" ||
    customerId !== args.memo.customerId
  ) {
    return { status: "identity_mismatch" };
  }
  const { data: booking, error } = await supabase.from("bookings")
    .select("id,customer_id,organization_id,notes,booking_version")
    .eq("id", args.memo.bookingId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !booking) return { status: "booking_missing" };
  try {
    assertOrganizationLineage(
      args.resolvedOrganizationId,
      booking.organization_id ?? null,
      { allowUnscopedLegacy: args.allowUnscopedLegacyDfw === true },
    );
  } catch {
    return { status: "organization_mismatch" };
  }
  const marker = `[Voice memo ${args.conversationId}:${args.memo.bookingId}]`;
  const existing = String(booking.notes ?? "");
  if (existing.includes(marker)) return { status: "duplicate" };
  const notes = [existing.trim(), `${marker} ${args.memo.text}`]
    .filter(Boolean).join("\n").slice(0, 4_000);
  let update = supabase.from("bookings").update({ notes })
    .eq("id", booking.id)
    .eq("customer_id", customerId)
    .eq("booking_version", Number(booking.booking_version ?? 0));
  update = booking.organization_id
    ? update.eq("organization_id", args.resolvedOrganizationId)
    : update.is("organization_id", null);
  const { error: updateError } = await update;
  return updateError ? { status: "write_failed" } : { status: "recorded" };
}
