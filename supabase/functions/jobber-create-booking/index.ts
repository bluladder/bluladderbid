import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";
import {
  buildJobberBookingLineItems,
  jobberGraphQL,
  jobberGraphQLMutation,
  jobberBookingLineItemsTotal,
} from "../_shared/jobberClient.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { getBearer, isServiceRoleToken } from "../_shared/auth.ts";
import { getMirrorFreshness } from "../_shared/scheduleFreshness.ts";
import { calculateQuote, type QuoteInput } from "../_shared/pricingEngine.ts";
import { loadPricing } from "../_shared/loadPricing.ts";
import { sendBookingConfirmationEmails } from "../_shared/bookingEmails.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import {
  findMatchingJobberProperties,
  resolveJobberClientByVerifiedContact,
  validatePublicBookingCustomer,
  type JobberPropertyCandidate,
} from "../_shared/publicBookingCustomer.ts";
import { verifyResumeToken } from "../_shared/quoteResumeTokens.ts";
import {
  isResumedQuoteBookable,
  parseResumedQuoteBooking,
} from "../_shared/resumedQuoteBooking.ts";
import { validateServiceArea } from "../_shared/serviceArea.ts";
import {
  evaluatePublicBookingServiceArea,
  hasAttemptedOrganizationOverride,
  PUBLIC_BOOKING_ORGANIZATION_ID,
} from "../_shared/publicBookingServiceArea.ts";
import {
  decideBookingReservationExecution,
  fingerprintPublicRequest,
  publicReplayResult,
  requestFingerprintMatches,
} from "../_shared/publicRequestReplay.ts";
import { resolvePublicBookingOrganization } from "../_shared/publicBookingOrganization.ts";
import { recordServiceAreaIntervention } from "../_shared/serviceAreaIntervention.ts";
import {
  sameScheduledInstant,
  scheduledIntervalMinutes,
} from "../_shared/bookingDuration.ts";
import {
  protectReservationForExecution,
  unprotectReservationAfterFailure,
} from "../_shared/reservationProtection.ts";
import { resolveAuthoritativeDuration } from "../_shared/salesEngine/durationContract.ts";
import {
  type CanonicalVoiceBookingContract,
  type CanonicalVoiceBookingPayload,
  fingerprintVoiceSessionToken,
  validateCanonicalVoiceBookingPayload,
} from "../_shared/voiceBookingAdapter.ts";
import { readIdentityAnchor } from "../_shared/identityAnchor.ts";
import {
  sessionBookingInputsKey,
  sessionInputsKey,
  type QuoteSessionFields,
} from "../_shared/quoteSession.ts";
import {
  type QuoteIdentity,
  quoteIdentityMatches,
} from "../_shared/voice/voiceJourneyContract.ts";
import {
  formatServiceAddress,
  sameAddress,
} from "../_shared/profile/normalizeAddress.ts";
import {
  evaluatePublicBookingLaunchGate,
  publicBookingLaunchGateResponse,
} from "../_shared/publicBookingLaunchGate.ts";
import {
  evaluateProtectedBookingTestBypass,
  type ProtectedBookingTestIdentity,
  type ProtectedBookingTestRun,
} from "../_shared/protectedBookingTestBypass.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration for local mirror staleness threshold
const MIRROR_STALE_THRESHOLD_MINUTES = 30;

function bookingReplayHttpStatus(
  result: Record<string, unknown>,
): number {
  if (result.success !== false) return 200;
  if (result.code === "INTERVENTION_RECORD_FAILED") return 503;
  if (result.pendingManualConfirmation === true) return 202;
  return 409;
}

interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  preset?: string;
}

interface BookingRequest {
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    address?: string;
  };
  technicianId: string;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  services: Array<{
    name: string;
    price: number;
    description?: string;
  }>;
  homeDetails: Record<string, unknown>;
  additionalServices?: Record<string, unknown>;
  /** Explicit promotion selection (e.g. the $99 window offer). */
  promotion?: { id: string; windowCount: number } | null;
  subtotal: number;
  discountAmount?: number;
  total: number;
  /** Canonical estimated tax and final-total context (voice contract). */
  estimatedTax?: number;
  taxableSubtotal?: number;
  preTaxTotal?: number;
  taxRate?: number;
  taxLabel?: string;
  selectedServiceIds?: string[];
  priceAdjustments?: Array<{
    key: string;
    label: string;
    kind: "discount" | "surcharge";
    amount: number;
    appliesToLineItemKey?: string;
  }>;
  promotionContext?: Record<string, unknown> | null;
  discountContext?: Record<string, unknown> | null;
  discountCode?: string;
  notes?: string;
  utmParams?: UtmParams;
  /** Whitelisted attribution snapshot. Never used for pricing. */
  attribution?: {
    source_session_id?: string;
    first_touch?: Record<string, unknown>;
    last_touch?: Record<string, unknown>;
    landing_page_slug?: string;
    fbclid?: string;
    referrer?: string;
    self_reported_source?: string;
    self_reported_source_detail?: string;
  };
  sourceSessionId?: string;
  resumedQuoteId?: string;
  resumedQuoteToken?: string;
  confirmedTotal?: number;
  // Team booking fields
  isTeamJob?: boolean;
  teamTechnicianIds?: string[];
  // Concurrency / retry safety
  idempotencyKey?: string;
  sessionId?: string;
  /** Service-role orchestration may continue this exact protected hold. */
  preReservedGroupId?: string;
  /** Internal service-role-only handoff. Public organization overrides remain forbidden. */
  voiceContract?: CanonicalVoiceBookingContract;
}

type VoiceLineageResult =
  | {
    ok: true;
    organizationId: string;
    customerId: string;
    propertyId: string;
    jobberPropertyId: string | null;
    quoteFields: QuoteSessionFields;
    lastQuote: Record<string, unknown>;
  }
  | { ok: false; code: string; error: string };

function contactText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

function contactPhone(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function exactNumber(a: unknown, b: unknown): boolean {
  return typeof a === "number" && Number.isFinite(a) &&
    typeof b === "number" && Number.isFinite(b) &&
    Math.abs(a - b) < 0.000_001;
}

function sameStringArray(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return JSON.stringify([...a].map(String).sort()) ===
    JSON.stringify([...b].map(String).sort());
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalJson(a)) === JSON.stringify(canonicalJson(b));
}

async function validateCanonicalVoiceLineage(
  supabase: any,
  booking: BookingRequest,
): Promise<VoiceLineageResult> {
  const contract = booking.voiceContract;
  if (!contract) {
    return { ok: false, code: "VOICE_CONTRACT_MISSING", error: "Voice booking contract is missing." };
  }
  if (
    !(await validateCanonicalVoiceBookingPayload(
      booking as unknown as CanonicalVoiceBookingPayload,
    ))
  ) {
    return { ok: false, code: "VOICE_CONTRACT_INVALID", error: "Voice booking contract hash or payload does not match." };
  }
  if (
    contract.organizationId !== PUBLIC_BOOKING_ORGANIZATION_ID ||
    !contract.offerExpiresAt ||
    Date.now() >= new Date(contract.offerExpiresAt).getTime()
  ) {
    return { ok: false, code: "VOICE_OFFER_STALE", error: "The canonical voice offer is missing or expired." };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("chat_conversations")
    .select(
      "id, organization_id, channel, customer_id, confirmed_email_customer_id, property_id, quote_session_id, service_address, service_area_status, session_token",
    )
    .eq("id", contract.conversationId)
    .eq("organization_id", contract.organizationId)
    .maybeSingle();
  if (
    conversationError || !conversation || conversation.channel !== "voice" ||
    conversation.property_id !== contract.propertyId ||
    conversation.quote_session_id !== contract.quoteSessionId ||
    conversation.service_area_status !== "eligible" ||
    await fingerprintVoiceSessionToken(conversation.session_token ?? "") !==
      contract.voiceSessionFingerprint ||
    !sameAddress(conversation.service_address, booking.customer.address ?? null)
  ) {
    return { ok: false, code: "VOICE_CONVERSATION_MISMATCH", error: "Conversation authority does not match the booking command." };
  }

  const identity = await readIdentityAnchor(
    supabase,
    contract.conversationId,
    contract.organizationId,
  );
  if (
    identity.identity_status !== "resolved" ||
    identity.resolved_customer_id !== contract.customerId
  ) {
    return { ok: false, code: "VOICE_CUSTOMER_MISMATCH", error: "Resolved customer identity does not match the booking command." };
  }

  const { data: session, error: sessionError } = await supabase
    .from("quote_sessions")
    .select(
      "id, organization_id, customer_id, property_id, quote_id, conversation_ids, fields",
    )
    .eq("id", contract.quoteSessionId)
    .eq("organization_id", contract.organizationId)
    .maybeSingle();
  const quoteFields = (session?.fields ?? {}) as QuoteSessionFields;
  const lastQuote = quoteFields.lastQuoteResult as Record<string, unknown> | undefined;
  if (
    sessionError || !session || session.customer_id !== contract.customerId ||
    session.property_id !== contract.propertyId ||
    session.quote_id !== contract.quoteId ||
    !Array.isArray(session.conversation_ids) ||
    !session.conversation_ids.includes(contract.conversationId) || !lastQuote
  ) {
    return { ok: false, code: "VOICE_QUOTE_LINEAGE_MISMATCH", error: "Quote-session lineage does not match the booking command." };
  }
  const currentQuoteFingerprint = sessionInputsKey(quoteFields);
  const currentBookingInputsKey = sessionBookingInputsKey(quoteFields);
  const currentQuoteIdentity = {
    quoteSessionId: session.id,
    quoteId: session.quote_id ?? null,
    inputsKey: currentQuoteFingerprint,
    pricingVersion: (lastQuote.ruleVersion as number | string | null) ?? null,
    engineVersion: (lastQuote.engineVersion as string | null) ?? null,
    durationVersion: (lastQuote.durationVersion as string | null) ?? null,
    taxPolicyVersion: (lastQuote.taxPolicyVersion as string | null) ?? null,
  };
  if (
    lastQuote.inputsKey !== currentQuoteFingerprint ||
    contract.quoteFingerprint !== currentQuoteFingerprint ||
    contract.bookingInputsKey !== currentBookingInputsKey ||
    !quoteIdentityMatches(currentQuoteIdentity, {
      quoteSessionId: contract.quoteSessionId,
      quoteId: contract.quoteId,
      inputsKey: contract.quoteFingerprint,
      pricingVersion: contract.pricingVersion,
      engineVersion: contract.engineVersion,
      durationVersion: contract.durationVersion,
      taxPolicyVersion: contract.taxPolicyVersion,
    }) ||
    !sameStringArray(quoteFields.services, booking.selectedServiceIds)
  ) {
    return { ok: false, code: "VOICE_QUOTE_STALE", error: "Current quote fingerprint or versions do not match the booking command." };
  }
  const duration = resolveAuthoritativeDuration(lastQuote);
  if (
    duration.status !== "available" ||
    duration.minutes !== booking.durationMinutes ||
    duration.minutes !== contract.durationMinutes ||
    scheduledIntervalMinutes(booking.scheduledStart, booking.scheduledEnd) !==
      duration.minutes
  ) {
    return { ok: false, code: "VOICE_DURATION_MISMATCH", error: "Canonical quote duration does not match the selected interval." };
  }
  if (
    !exactNumber(lastQuote.serviceSubtotal, booking.subtotal) ||
    !exactNumber(lastQuote.taxableSubtotal, booking.taxableSubtotal) ||
    !exactNumber(lastQuote.estimatedTax, booking.estimatedTax) ||
    !exactNumber(lastQuote.total, booking.preTaxTotal) ||
    !exactNumber(lastQuote.estimatedTotal, booking.total) ||
    !exactNumber(lastQuote.taxRate, booking.taxRate) ||
    lastQuote.taxLabel !== booking.taxLabel ||
    !sameJson(lastQuote.promotion ?? null, booking.promotionContext ?? null) ||
    !sameJson(lastQuote.priceAdjustments ?? [], booking.priceAdjustments ?? []) ||
    !sameJson(lastQuote.discount ?? null, booking.discountContext ?? null)
  ) {
    return { ok: false, code: "VOICE_PRICE_MISMATCH", error: "Canonical services, discount, tax, or total changed before booking." };
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id, organization_id, first_name, last_name, email, phone")
    .eq("id", contract.customerId)
    .eq("organization_id", contract.organizationId)
    .maybeSingle();
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select(
      "id, organization_id, active, street, city, state, postal_code, jobber_property_id",
    )
    .eq("id", contract.propertyId)
    .eq("organization_id", contract.organizationId)
    .maybeSingle();
  const { data: customerProperty, error: customerPropertyError } = await supabase
    .from("customer_properties")
    .select("id")
    .eq("customer_id", contract.customerId)
    .eq("property_id", contract.propertyId)
    .eq("active", true)
    .maybeSingle();
  const propertyAddress = formatServiceAddress(property);
  if (
    customerError || !customer || customer.organization_id !== contract.organizationId ||
    propertyError || !property || property.organization_id !== contract.organizationId ||
    property.active !== true || customerPropertyError || !customerProperty ||
    !propertyAddress ||
    !sameAddress(propertyAddress, booking.customer.address ?? null) ||
    contactText(customer.first_name) !== contactText(booking.customer.firstName) ||
    contactText(customer.last_name) !== contactText(booking.customer.lastName) ||
    contactText(customer.email) !== contactText(booking.customer.email) ||
    contactPhone(customer.phone) !== contactPhone(booking.customer.phone) ||
    contactText(quoteFields.name) !==
      contactText(`${customer.first_name} ${customer.last_name}`) ||
    contactText(quoteFields.email) !== contactText(customer.email) ||
    contactPhone(quoteFields.phone) !== contactPhone(customer.phone) ||
    !sameAddress(quoteFields.address ?? null, propertyAddress)
  ) {
    return { ok: false, code: "VOICE_PROPERTY_OR_CONTACT_MISMATCH", error: "Verified contact or property authority does not match the booking command." };
  }

  const { data: offerRows, error: offerError } = await supabase
    .from("chat_messages")
    .select("tool_result")
    .eq("conversation_id", contract.conversationId)
    .eq("tool_name", "get_bluladder_availability")
    .order("created_at", { ascending: false })
    .limit(1);
  const offerResult = offerRows?.[0]?.tool_result as Record<string, unknown> | undefined;
  const offered = Array.isArray(offerResult?.offered)
    ? offerResult.offered as Array<Record<string, unknown>>
    : [];
  const selected = offered.find((item) => item.slotId === contract.slotId);
  if (
    offerError || !offerResult || !selected ||
    offerResult.organizationId !== contract.organizationId ||
    offerResult.bookingInputsKey !== contract.bookingInputsKey ||
    offerResult.quoteSignature !== contract.quoteFingerprint ||
    offerResult.offerVersion !== contract.offerVersion ||
    offerResult.expiresAt !== contract.offerExpiresAt ||
    !quoteIdentityMatches(
      currentQuoteIdentity,
      offerResult.quoteIdentity as Partial<QuoteIdentity> | undefined,
    ) ||
    selected.startTime !== contract.scheduledStart ||
    selected.endTime !== contract.scheduledEnd ||
    selected.timezone !== contract.timezone ||
    selected.durationMinutes !== contract.durationMinutes ||
    selected.__technicianId !== booking.technicianId ||
    selected.__isTeamJob !== booking.isTeamJob ||
    !sameStringArray(selected.__teamTechnicianIds ?? [], booking.teamTechnicianIds ?? [])
  ) {
    return { ok: false, code: "VOICE_OFFER_MISMATCH", error: "Latest availability offer does not match the booking command." };
  }
  return {
    ok: true,
    organizationId: contract.organizationId,
    customerId: contract.customerId,
    propertyId: contract.propertyId,
    jobberPropertyId: typeof property.jobber_property_id === "string"
      ? property.jobber_property_id
      : null,
    quoteFields,
    lastQuote,
  };
}

// Busy block type from database
interface BusyBlock {
  start_at: string;
  end_at: string;
  updated_at: string;
  crew_id: string;
  status: string;
}

// Check for conflicts using local busy_blocks mirror
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkLocalMirrorConflicts(
  supabase: any,
  jobberUserId: string,
  requestedStart: Date,
  requestedEnd: Date
): Promise<{ hasConflict: boolean; conflictingBlock?: { start_at: string; end_at: string }; mirrorStale: boolean; noData: boolean }> {
  
  // Get ACTIVE blocks that overlap the requested appointment window.
  // This must be overlap-based instead of filtering by start date, otherwise a
  // block that starts before the day/window but runs into it could be missed.
  const { data: blocks, error } = await supabase
    .from("jobber_busy_blocks")
    .select("start_at, end_at, updated_at, crew_id, status")
    .eq("crew_id", jobberUserId)
    .lt("start_at", requestedEnd.toISOString())
    .gt("end_at", requestedStart.toISOString())
    .in("status", ["scheduled", "in_progress"]);
  
  if (error) {
    console.error("Error querying busy_blocks:", error);
    return { hasConflict: false, mirrorStale: true, noData: true };
  }
  
  // Cast blocks to proper type
  const typedBlocks = (blocks || []) as BusyBlock[];
  
  console.log(`[LocalConflictCheck] Found ${typedBlocks.length} active overlapping blocks for tech ${jobberUserId} during ${requestedStart.toISOString()} - ${requestedEnd.toISOString()}`);
  
  // Check autosync coverage to determine if mirror is populated for this date
  const { data: autosyncConfig } = await supabase
    .from("autosync_config")
    .select("earliest_coverage_date, latest_coverage_date, updated_at")
    .eq("id", "default")
    .maybeSingle();
  
  // Determine if we have coverage for this date
  const requestedDate = requestedStart.toISOString().split('T')[0];
  const hasCoverage = autosyncConfig?.earliest_coverage_date && autosyncConfig?.latest_coverage_date &&
    requestedDate >= autosyncConfig.earliest_coverage_date &&
    requestedDate <= autosyncConfig.latest_coverage_date;
  
  if (!hasCoverage) {
    console.log(`[LocalConflictCheck] No mirror coverage for ${requestedDate} (coverage: ${autosyncConfig?.earliest_coverage_date} to ${autosyncConfig?.latest_coverage_date})`);
    return { hasConflict: false, mirrorStale: true, noData: true };
  }
  
  // Authoritative freshness: only trust the mirror when the last FULL sweep
  // completed cleanly and no sync is currently running. Otherwise force the
  // Jobber fallback (which fails closed on error).
  const freshness = await getMirrorFreshness(supabase, MIRROR_STALE_THRESHOLD_MINUTES);
  const mirrorStale = !freshness.ok;
  if (mirrorStale) {
    console.log(`[LocalConflictCheck] Mirror not fresh (reason=${freshness.reason}) — will fall back to Jobber`);
  }
  
  // Check for overlaps: (newStart < existingEnd) AND (newEnd > existingStart)
  for (const block of typedBlocks) {
    const blockStart = new Date(block.start_at);
    const blockEnd = new Date(block.end_at);
    
    const hasOverlap = requestedStart < blockEnd && requestedEnd > blockStart;
    
    if (hasOverlap) {
      console.log(`[LocalConflictCheck] CONFLICT DETECTED: ${requestedStart.toISOString()} - ${requestedEnd.toISOString()} overlaps with block ${block.start_at} - ${block.end_at} (status: ${block.status})`);
      return { 
        hasConflict: true, 
        conflictingBlock: { start_at: block.start_at, end_at: block.end_at },
        mirrorStale,
        noData: false,
      };
    }
  }
  
  // No conflicts found in local mirror
  // If no active blocks exist but we have coverage, treat as no conflict
  console.log(`[LocalConflictCheck] No conflicts found in local mirror (${typedBlocks.length} active blocks checked)`);
  return { hasConflict: false, mirrorStale, noData: false };
}

// Fallback: Check conflicts via Jobber API with narrow window
async function checkJobberConflicts(
  jobberUserId: string,
  requestedStart: Date,
  requestedEnd: Date,
  technicianName: string
): Promise<{ hasConflict: boolean; conflictingVisit?: { startAt: string; endAt: string }; throttled: boolean; error: boolean }> {
  
  // Narrow window: ±6 hours around requested time
  const rangeAfter = new Date(requestedStart.getTime() - 6 * 60 * 60 * 1000);
  const rangeBefore = new Date(requestedEnd.getTime() + 6 * 60 * 60 * 1000);
  
  // Minimal query - only needed fields, smaller page size
  const conflictCheckQuery = `
    query CheckConflicts($after: ISO8601DateTime!, $before: ISO8601DateTime!) {
      visits(first: 50, filter: { startAt: { after: $after, before: $before } }) {
        nodes {
          id
          startAt
          endAt
          assignedUsers(first: 10) {
            nodes { id }
          }
        }
      }
    }
  `;
  
  const conflictResult = await jobberGraphQL<{
    visits: {
      nodes: Array<{
        id: string;
        startAt: string;
        endAt: string;
        assignedUsers?: { nodes: Array<{ id: string }> };
      }>;
    };
  }>(conflictCheckQuery, {
    after: rangeAfter.toISOString(),
    before: rangeBefore.toISOString(),
  });
  
  console.log("Jobber conflict check completed", {
    errorCount: conflictResult.errors?.length ?? 0,
    hasData: !!conflictResult.data,
  });
  
  // Check if throttled
  if (conflictResult.throttled) {
    console.error("Jobber conflict check was throttled");
    return { hasConflict: false, throttled: true, error: false };
  }
  
  if (conflictResult.errors?.length) {
    console.error("Conflict validation failed", {
      errorCount: conflictResult.errors.length,
    });
    // FAIL CLOSED: a failed conflict query must NOT be interpreted as
    // "no conflict". Signal an error so the caller stops the booking (503).
    return { hasConflict: false, throttled: false, error: true };
  }

  // Malformed / unexpected shape: we cannot positively verify availability.
  if (!conflictResult.data?.visits?.nodes) {
    console.error("Conflict validation returned malformed/incomplete data");
    return { hasConflict: false, throttled: false, error: true };
  }

  {
    const existingVisits = conflictResult.data.visits.nodes
      .filter(v => (v.assignedUsers?.nodes ?? []).some(u => u.id === jobberUserId));
    
    for (const visit of existingVisits) {
      const existingStart = new Date(visit.startAt);
      const existingEnd = new Date(visit.endAt);
      
      const hasOverlap = requestedStart < existingEnd && requestedEnd > existingStart;
      
      if (hasOverlap) {
        console.log(`JOBBER CONFLICT DETECTED: ${requestedStart.toISOString()} - ${requestedEnd.toISOString()} overlaps with visit ${visit.id} (${visit.startAt} - ${visit.endAt})`);
        return {
          hasConflict: true,
          conflictingVisit: { startAt: visit.startAt, endAt: visit.endAt },
          throttled: false,
          error: false,
        };
      }
    }
  }
  
  return { hasConflict: false, throttled: false, error: false };
}

async function protectedBookingTestBypassAuthorized(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  request: Request,
  callerToken: string | null,
  booking: BookingRequest,
  idempotencyKey: string,
): Promise<string | null> {
  const requestedRunId = request.headers.get(
    "X-Bluladder-Protected-Test-Run",
  );
  if (!requestedRunId || !isServiceRoleToken(callerToken)) return null;

  const { data: run, error: runError } = await supabase
    .from("booking_test_runs")
    .select(
      "id, phase, status, conversation_id, slot_id, idempotency_key, auth_key",
    )
    .eq("id", requestedRunId)
    .maybeSingle();
  if (runError || !run) return null;

  const { data: identity, error: identityError } = await supabase
    .from("test_identities")
    .select(
      "email, protected, active, live_jobber_test_enabled, authorized_conversation_id, authorized_slot_id, authorized_idempotency_key, authorization_expires_at, authorization_consumed_at",
    )
    .eq("email", booking.customer.email)
    .eq("protected", true)
    .maybeSingle();
  if (identityError) return null;

  const decision = evaluateProtectedBookingTestBypass({
    callerIsServiceRole: true,
    requestedRunId,
    bookingEmail: booking.customer.email,
    bookingIdempotencyKey: idempotencyKey,
    run: run as ProtectedBookingTestRun,
    identity: identity as ProtectedBookingTestIdentity | null,
  });
  if (!decision.authorized) return null;

  console.warn(JSON.stringify({
    event: "protected_booking_test_launch_gate_bypass",
    workflow: "one_time_booking",
    reason_code: decision.reason,
    run_id: requestedRunId,
  }));
  return requestedRunId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Booking is a public (unauthenticated) flow, but creating real Jobber jobs
  // is expensive and notifies customers. Throttle per-IP to prevent automated
  // fraudulent/bulk booking creation. Internal service-role calls are exempt.
  const callerToken = getBearer(req);
  const serviceRoleCaller = isServiceRoleToken(callerToken);
  if (!serviceRoleCaller) {
    const rl = rateLimit(req, { limit: 6, windowMs: 60_000 });
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many booking attempts. Please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" } },
      );
    }
  }

  try {
    console.log("=== Starting booking creation ===");
    
    const booking: BookingRequest = await req.json();
    const isCanonicalVoiceBooking = booking.voiceContract != null;
    if (isCanonicalVoiceBooking && !serviceRoleCaller) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "VOICE_CONTRACT_FORBIDDEN",
          error: "Canonical voice booking commands are internal only.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (
      hasAttemptedOrganizationOverride(
        booking as unknown as Record<string, unknown>,
      )
    ) {
      return new Response(
        JSON.stringify({
          error: "Organization selection is not accepted on public booking requests.",
          code: "ORGANIZATION_OVERRIDE_REJECTED",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    console.log("Received booking request", {
      hasCustomer: !!booking.customer,
      hasTechnician: !!booking.technicianId,
      servicesCount: booking.services?.length ?? 0,
    });

    // Validate required fields
    if (!booking.customer?.email || !booking.technicianId || !booking.scheduledStart) {
      console.error("Missing required fields:", {
        hasEmail: !!booking.customer?.email,
        hasTechId: !!booking.technicianId,
        hasStart: !!booking.scheduledStart,
      });
      return new Response(
        JSON.stringify({ error: "Missing required booking fields" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const customerValidation = validatePublicBookingCustomer(booking.customer);
    if (!customerValidation.ok) {
      return new Response(
        JSON.stringify({
          error: customerValidation.message,
          code: customerValidation.code,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 },
      );
    }
    booking.customer = customerValidation.customer;
    const validatedCustomer = customerValidation.customer;
    const submittedServiceAddress = customerValidation.address;

    // Validate the immutable, self-hashed voice command before consulting a
    // durable replay. Mutable quote/offer lineage is checked only for a new
    // provider attempt so a lost successful response remains replayable after
    // the original offer expires.
    if (
      isCanonicalVoiceBooking &&
      !(await validateCanonicalVoiceBookingPayload(
        booking as unknown as CanonicalVoiceBookingPayload,
      ))
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "VOICE_CONTRACT_INVALID",
          retryable: false,
          error: "Voice booking contract hash or payload does not match.",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestedCrewIds = booking.isTeamJob && booking.teamTechnicianIds?.length
      ? [...booking.teamTechnicianIds].sort()
      : [booking.technicianId];
    const idempotencyKey =
      (booking.idempotencyKey && String(booking.idempotencyKey).trim()) ||
      `${booking.customer.email.toLowerCase()}|${booking.scheduledStart}|${requestedCrewIds.join(",")}`;
    const requestFingerprint = await fingerprintPublicRequest({
      organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
      customerEmail: booking.customer.email.toLowerCase(),
      serviceAddress: booking.customer.address,
      scheduledStart: booking.scheduledStart,
      scheduledEnd: booking.scheduledEnd,
      technicianIds: requestedCrewIds,
      services: booking.services,
      homeDetails: booking.homeDetails,
      additionalServices: booking.additionalServices ?? null,
      promotion: booking.promotion ?? null,
      selectedServiceIds: booking.selectedServiceIds ?? null,
      subtotal: booking.subtotal,
      taxableSubtotal: booking.taxableSubtotal ?? null,
      estimatedTax: booking.estimatedTax ?? null,
      preTaxTotal: booking.preTaxTotal ?? null,
      total: booking.total,
      priceAdjustments: booking.priceAdjustments ?? null,
      discountContext: booking.discountContext ?? null,
      promotionContext: booking.promotionContext ?? null,
      durationMinutes: booking.durationMinutes,
      voiceContract: booking.voiceContract ?? null,
    });
    // A completed request-bound replay is authoritative even if the geocoder
    // or configuration is unavailable later. Never expose a result for a key
    // reused with different customer/address/schedule semantics.
    const { data: priorReservation, error: priorReservationError } =
      await supabase
        .from("slot_reservations")
        .select("result_json")
        .eq("idempotency_key", idempotencyKey)
        .not("result_json", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (priorReservationError) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "IDEMPOTENCY_LOOKUP_UNAVAILABLE",
          retryable: true,
          error:
            "We couldn't safely verify the prior booking attempt. Please try again shortly.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (priorReservation?.result_json) {
      if (
        !requestFingerprintMatches(
          priorReservation.result_json,
          requestFingerprint,
        )
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "IDEMPOTENCY_KEY_REUSED",
            retryable: false,
            error:
              "This request key is already bound to a different booking attempt.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const replay = publicReplayResult(
        priorReservation.result_json as Record<string, unknown>,
      );
      return new Response(JSON.stringify(replay), {
        status: bookingReplayHttpStatus(replay),
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const voiceLineage = isCanonicalVoiceBooking
      ? await validateCanonicalVoiceLineage(supabase, booking)
      : null;
    if (voiceLineage && !voiceLineage.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          code: voiceLineage.code,
          retryable: false,
          error: voiceLineage.error,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const launchGate = evaluatePublicBookingLaunchGate(
      Deno.env.get("PUBLIC_BOOKING_ENABLED"),
    );
    const protectedSyntheticRunId =
      await protectedBookingTestBypassAuthorized(
        supabase,
        req,
        callerToken,
        booking,
        idempotencyKey,
      );
    if (!launchGate.enabled && !protectedSyntheticRunId) {
      return publicBookingLaunchGateResponse(
        "one_time_booking",
        Deno.env.get("PUBLIC_BOOKING_ENABLED"),
        corsHeaders,
      )!;
    }

    const organizationResolution = await resolvePublicBookingOrganization(
      supabase,
    );
    if (organizationResolution.status !== "resolved") {
      return new Response(
        JSON.stringify({
          success: false,
          code: organizationResolution.code,
          retryable: true,
          error:
            "We can't verify the service organization right now. No booking or notification was created.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (
      voiceLineage?.ok &&
      organizationResolution.organizationId !== voiceLineage.organizationId
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "VOICE_ORGANIZATION_MISMATCH",
          retryable: false,
          error:
            "Resolved booking organization does not match the canonical voice authority.",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const organizationWriteFields =
      organizationResolution.tenantFoundationAvailable
        ? { organization_id: organizationResolution.organizationId }
        : {};

    const serviceAreaResult = await validateServiceArea(
      supabase,
      validatedCustomer.address,
    );
    const serviceAreaDecision = evaluatePublicBookingServiceArea(
      submittedServiceAddress,
      serviceAreaResult,
    );
    if (serviceAreaDecision.status === "manual_review") {
      const intervention = await recordServiceAreaIntervention(supabase, {
        requestFingerprint,
        source: "public_one_time_booking",
        customerName:
          `${booking.customer.firstName} ${booking.customer.lastName}`.trim(),
        customerEmail: booking.customer.email,
        customerPhone: booking.customer.phone ?? null,
        propertyAddress: validatedCustomer.address,
        services: booking.services,
        total: Number.isFinite(booking.total) ? booking.total : null,
        reasonCode: "configured_manual_review_county",
      });
      const recorded = intervention.status === "recorded";
      return new Response(
        JSON.stringify({
          success: false,
          pendingManualConfirmation: false,
          manualReviewRequired: true,
          interventionState: recorded
            ? "intervention_recorded"
            : "intervention_record_failed",
          interventionId: recorded ? intervention.interventionId : undefined,
          code: recorded
            ? "SERVICE_AREA_MANUAL_REVIEW"
            : "SERVICE_AREA_INTERVENTION_FAILED",
          retryable: false,
          error: recorded
            ? "This address needs a manual service-area review. Your request was recorded, but no appointment or notification is confirmed."
            : "This address needs a manual service-area review, but we couldn't record the request. No appointment or notification was created; contact BluLadder directly.",
        }),
        {
          status: recorded ? 202 : 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (serviceAreaDecision.status !== "eligible") {
      const httpStatus = serviceAreaDecision.status === "ineligible"
        ? 422
        : serviceAreaDecision.status === "ambiguous"
        ? 422
        : 503;
      return new Response(
        JSON.stringify({
          success: false,
          code: serviceAreaDecision.code,
          retryable: serviceAreaDecision.retryable,
          error: serviceAreaDecision.status === "ineligible"
            ? "Online booking is currently available only for verified DFW service addresses."
            : serviceAreaDecision.status === "ambiguous"
            ? "We couldn't verify that address. Please correct the street, city, state, and ZIP before trying again."
            : "We can't verify service availability right now. No booking or notification was created; please try again later.",
        }),
        {
          status: httpStatus,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const resumedClaim = parseResumedQuoteBooking(booking);
    let resumedQuote: {
      quoteId: string;
      status: string;
      confirmedTotal: number;
    } | null = null;

    if (resumedClaim.kind === "invalid") {
      return new Response(
        JSON.stringify({ error: "Invalid resumed quote authorization" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (resumedClaim.kind === "valid") {
      const verified = await verifyResumeToken(
        supabase,
        resumedClaim.quoteId,
        resumedClaim.resumeToken,
      );
      if (!verified.ok) {
        return new Response(
          JSON.stringify({ error: "Invalid resumed quote authorization" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      let quoteLookup = supabase
        .from("quotes")
        .select("id, status, expires_at")
        .eq("id", resumedClaim.quoteId);
      if (organizationResolution.tenantFoundationAvailable) {
        quoteLookup = quoteLookup.eq(
          "organization_id",
          organizationResolution.organizationId,
        );
      }
      const { data: quoteRow, error: quoteError } = await quoteLookup
        .maybeSingle();
      if (
        quoteError ||
        !quoteRow ||
        !isResumedQuoteBookable(quoteRow.status, quoteRow.expires_at)
      ) {
        return new Response(
          JSON.stringify({
            error: "This quote is no longer available for booking.",
            code: "QUOTE_NOT_BOOKABLE",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      resumedQuote = {
        quoteId: resumedClaim.quoteId,
        status: quoteRow.status,
        confirmedTotal: resumedClaim.confirmedTotal,
      };
    }

    // ========================================================================
    // AUTHORITATIVE SERVER-SIDE PRICING (never trust the client total).
    // When the structured selection is provided, recompute the whole quote with
    // the canonical engine, re-validate the discount, and reconcile against the
    // client-submitted total. On mismatch the SERVER values win.
    // ========================================================================
    let pricingSnapshot: {
      engineVersion: string | null;
      ruleVersion: number | null;
      inputSnapshot: unknown;
      lineItemSnapshot: unknown;
      discountSnapshot: unknown;
      promotionSnapshot?: unknown;
    } = {
      engineVersion: null,
      ruleVersion: null,
      inputSnapshot: booking.additionalServices
        ? { homeDetails: booking.homeDetails, additionalServices: booking.additionalServices }
        : null,
      lineItemSnapshot: booking.services,
      discountSnapshot: booking.discountCode
        ? { code: booking.discountCode, amount: booking.discountAmount || 0 }
        : null,
    };

    // Track promotion prep instructions so we can append them to Jobber notes.
    let promoPrepInstructions = "";
    if (booking.additionalServices || booking.promotion) {
      try {
        // Re-validate discount server-side (active / not expired / under max uses).
        let serverDiscount: QuoteInput["discount"] = null;
        if (booking.discountCode) {
          const code = String(booking.discountCode).toUpperCase().trim();
          if (/^[A-Z0-9]{3,20}$/.test(code)) {
            const { data: dc } = await supabase
              .from("discount_codes")
              .select("code, discount_type, discount_value, is_active, expires_at, usage_count, max_uses")
              .eq("code", code)
              .maybeSingle();
            const valid = dc && dc.is_active &&
              (!dc.expires_at || new Date(dc.expires_at) >= new Date()) &&
              (dc.max_uses === null || (dc.usage_count ?? 0) < dc.max_uses);
            if (valid) {
              serverDiscount = {
                type: dc.discount_type === "percentage" ? "percentage" : "fixed",
                value: Number(dc.discount_value),
                code: dc.code,
              };
            }
          }
        }

        const loaded = await loadPricing(supabase);
        if (loaded.ok && loaded.pricing) {
          const engineResult = calculateQuote(
            {
              homeDetails: booking.homeDetails as unknown as QuoteInput["homeDetails"],
              additionalServices: booking.additionalServices as unknown as QuoteInput["additionalServices"],
              discount: serverDiscount,
              promotion:
                booking.promotion && typeof booking.promotion.id === "string"
                  ? { id: booking.promotion.id, windowCount: Number(booking.promotion.windowCount) }
                  : null,
            },
            loaded.pricing,
            loaded.ruleVersion,
          );

          pricingSnapshot = {
            engineVersion: engineResult.engineVersion,
            ruleVersion: engineResult.ruleVersion,
            inputSnapshot: isCanonicalVoiceBooking
              ? {
                homeDetails: booking.homeDetails,
                additionalServices: booking.additionalServices,
                selectedServiceIds: booking.selectedServiceIds,
                voiceContract: booking.voiceContract,
                tax: {
                  taxableSubtotal: booking.taxableSubtotal,
                  estimatedTax: booking.estimatedTax,
                  finalTotal: booking.total,
                  rate: booking.taxRate,
                  label: booking.taxLabel,
                },
              }
              : {
                homeDetails: booking.homeDetails,
                additionalServices: booking.additionalServices,
              },
            lineItemSnapshot: isCanonicalVoiceBooking
              ? {
                lineItems: engineResult.lineItems,
                jobberLineItems: engineResult.jobberLineItems,
                priceAdjustments: engineResult.priceAdjustments,
              }
              : engineResult.lineItems,
            discountSnapshot: isCanonicalVoiceBooking
              ? {
                discount: engineResult.discount,
                promotion: engineResult.promotion,
                discountsAndAdjustments:
                  engineResult.discountsAndAdjustments,
              }
              : engineResult.discount,
            // Preserve promotion id/version/terms in the booking snapshot.
            promotionSnapshot: engineResult.promotion,
          };

          if (engineResult.firm) {
            // Preserve the promotion's preparation requirement for the crew.
            if (engineResult.promotion?.prepInstructions) {
              promoPrepInstructions = engineResult.promotion.prepInstructions;
            }
            const serverTotal = engineResult.total;
            const clientTotal = Number(booking.total);
            const durationResult = resolveAuthoritativeDuration(engineResult);
            if (durationResult.status !== "available") {
              return new Response(
                JSON.stringify({
                  error:
                    "An authoritative duration is not available for these services.",
                  code: "DURATION_UNAVAILABLE",
                }),
                {
                  status: 409,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }
            const authoritativeDuration = durationResult.minutes;
            const scheduledDuration = scheduledIntervalMinutes(
              booking.scheduledStart,
              booking.scheduledEnd,
            );
            if (
              scheduledDuration === null ||
              (isCanonicalVoiceBooking
                ? scheduledDuration !== authoritativeDuration
                : scheduledDuration < authoritativeDuration) ||
              Number(booking.durationMinutes) !== authoritativeDuration
            ) {
              return new Response(
                JSON.stringify({
                  error:
                    "The selected appointment time no longer fits the current services. Please choose a new time.",
                  code: "SLOT_DURATION_MISMATCH",
                  requiredDurationMinutes: authoritativeDuration,
                }),
                {
                  status: 409,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }
            booking.durationMinutes = authoritativeDuration;
            if (isCanonicalVoiceBooking) {
              const canonicalServices = engineResult.jobberLineItems.map((item) => ({
                name: item.name,
                price: item.unitPrice,
                ...(item.description ? { description: item.description } : {}),
              }));
              const canonicalProviderLines = buildJobberBookingLineItems({
                services: canonicalServices,
                priceAdjustments: engineResult.priceAdjustments,
                discountAmount: engineResult.discount?.amount ?? 0,
                discountCode: engineResult.discount?.code,
              });
              const canonicalMatches =
                exactNumber(engineResult.serviceSubtotal, booking.subtotal) &&
                exactNumber(engineResult.taxableSubtotal, booking.taxableSubtotal) &&
                exactNumber(engineResult.estimatedTax, booking.estimatedTax) &&
                exactNumber(engineResult.total, booking.preTaxTotal) &&
                exactNumber(engineResult.estimatedTotal, booking.total) &&
                exactNumber(engineResult.taxRate, booking.taxRate) &&
                engineResult.taxLabel === booking.taxLabel &&
                engineResult.taxPolicyVersion ===
                  booking.voiceContract?.taxPolicyVersion &&
                engineResult.engineVersion ===
                  booking.voiceContract?.engineVersion &&
                engineResult.ruleVersion ===
                  booking.voiceContract?.pricingVersion &&
                engineResult.durationVersion ===
                  booking.voiceContract?.durationVersion &&
                exactNumber(
                  jobberBookingLineItemsTotal(canonicalProviderLines),
                  booking.preTaxTotal,
                ) &&
                sameJson(canonicalServices, booking.services) &&
                sameJson(
                  engineResult.promotion ?? null,
                  booking.promotionContext ?? null,
                ) &&
                sameJson(
                  engineResult.priceAdjustments ?? [],
                  booking.priceAdjustments ?? [],
                ) &&
                sameJson(
                  engineResult.discount ?? null,
                  booking.discountContext ?? null,
                );
              if (!canonicalMatches) {
                return new Response(
                  JSON.stringify({
                    success: false,
                    code: "VOICE_QUOTE_STALE",
                    retryable: false,
                    error:
                      "Canonical pricing, tax, discount, promotion, line items, or duration changed before booking.",
                  }),
                  {
                    status: 409,
                    headers: {
                      ...corsHeaders,
                      "Content-Type": "application/json",
                    },
                  },
                );
              }
            }
            // ---- Resumed-quote revalidation gate ----
            // If this booking is created from a stored quote link, refuse to
            // silently rewrite the price. Require an explicit reconfirmation
            // against the fresh authoritative total before any Jobber writes.
            if (resumedQuote) {
              const drift = Math.abs(serverTotal - resumedQuote.confirmedTotal);
              const pct = serverTotal > 0 ? drift / serverTotal : 1;
              if (drift > 2 && pct > 0.02) {
                return new Response(
                  JSON.stringify({
                    status: "requires_reconfirmation",
                    reason: "pricing_refreshed",
                    resumedQuoteId: resumedQuote.quoteId,
                    authoritative: {
                      total: serverTotal,
                      subtotal: engineResult.subtotal,
                      lineItems: engineResult.lineItems.map((li) => ({
                        label: li.label,
                        amount: li.amount,
                      })),
                      promotion: engineResult.promotion ?? null,
                      discount: engineResult.discount ?? null,
                    },
                    message:
                      "Pricing was refreshed since this quote was saved. Please review the updated total before confirming.",
                  }),
                  { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
              }
            }
            // For promotions the Jobber line items MUST reconcile exactly with the
            // server result, so always rebuild from the engine when a promotion is
            // applied (in addition to the normal tamper/stale guard).
            const promoApplied = !!engineResult.promotion;
            if (
              !isCanonicalVoiceBooking &&
              (promoApplied || Math.abs(serverTotal - clientTotal) > 1)
            ) {
              // Client total was tampered with or stale — trust the server.
              console.warn(
                `Pricing mismatch: client total ${clientTotal} vs server ${serverTotal}. Using server values.`,
              );
              booking.subtotal = engineResult.subtotal;
              booking.discountAmount = engineResult.discount?.amount ?? 0;
              booking.total = engineResult.total;
              // Rebuild Jobber line items from the authoritative engine result.
              booking.services = engineResult.lineItems.map((li) => ({
                name: li.label,
                price: li.amount,
                description:
                  li.jobberLineItem?.description ??
                  (li.adjustments.length > 0
                    ? li.adjustments.map((a) => a.label).join(", ")
                    : undefined),
              }));
            }
          } else {
            // Engine is reachable but could NOT produce a firm price for these
            // inputs (missing info / manual review). A booking must never be
            // silently confirmed at a client-supplied total in this case —
            // reject so a customer cannot craft inputs to lock in a wrong price.
            console.warn(
              `Engine returned non-firm status "${engineResult.status}" for booking; rejecting.`,
            );
            return new Response(
              JSON.stringify({
                error:
                  "This selection needs a customized quote. No follow-up request was recorded; please contact BluLadder for help.",
                status: engineResult.status,
                missing: engineResult.missing,
              }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } else {
          console.error("Booking blocked — authoritative pricing unavailable:", loaded.error);
          return new Response(
            JSON.stringify({
              error: "We couldn't verify current pricing. Please try again shortly.",
              code: "PRICING_UNAVAILABLE",
            }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } catch (e) {
        console.error("Server-side pricing reconciliation failed:", e);
        return new Response(
          JSON.stringify({
            error: "We couldn't verify current pricing. Please try again shortly.",
            code: "PRICING_UNAVAILABLE",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Get technician's Jobber user ID (and team technicians if team booking)
    console.log("Looking up technician:", booking.technicianId);
    
    // For team bookings, get all team technician IDs
    const technicianIdsToFetch = [...new Set(
      booking.isTeamJob && booking.teamTechnicianIds?.length
        ? booking.teamTechnicianIds
        : [booking.technicianId],
    )].sort();
    
    const { data: technicians, error: techError } = await supabase
      .from("technicians")
      .select("id, jobber_user_id, name, is_active")
      .in("id", technicianIdsToFetch);

    const returnedTechnicianIds = (technicians ?? [])
      .map((technician) => technician.id)
      .sort();
    if (
      techError || !technicians?.length ||
      !sameStringArray(returnedTechnicianIds, technicianIdsToFetch) ||
      technicians.some((technician) =>
        technician.is_active !== true || !String(technician.jobber_user_id ?? "").trim()
      )
    ) {
      console.error("Technician lookup failed:", techError);
      return new Response(
        JSON.stringify({
          success: false,
          code: "CREW_AUTHORITY_MISMATCH",
          error: "The exact offered crew is no longer available for booking.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }
    technicians.sort((a, b) =>
      technicianIdsToFetch.indexOf(a.id) - technicianIdsToFetch.indexOf(b.id)
    );
    
    // All Jobber user IDs for assignment
    const allJobberUserIds = technicians.map(t => t.jobber_user_id);
    const technicianNames = technicians.map(t => t.name).join(" + ");
    
    console.log("Found technicians:", technicianNames);
    console.log("Jobber IDs:", allJobberUserIds);
    console.log("Is team job:", booking.isTeamJob || false);

    // === SLOT RESERVATION & IDEMPOTENCY (before any Jobber writes) ===
    // Atomically hold this crew's time so two customers can't race into the
    // same slot, and so retries with the same key don't create duplicate jobs.
    const requestedStart = new Date(booking.scheduledStart);
    const requestedEnd = new Date(booking.scheduledEnd);

    let reservationGroupId: string | null = null;
    const { data: reserveRes, error: reserveErr } = await supabase.rpc("reserve_booking_slot", {
      p_crew_ids: allJobberUserIds,
      p_start: requestedStart.toISOString(),
      p_end: requestedEnd.toISOString(),
      p_session: booking.sessionId || null,
      p_idempotency_key: idempotencyKey,
      p_ttl_minutes: 8,
    });

    if (reserveErr) {
      console.error("Reservation RPC failed:", reserveErr);
      return new Response(
        JSON.stringify({
          error: "Scheduling is busy",
          details: "We're unable to verify this appointment time right now. Please try again shortly.",
          code: "SCHEDULING_BUSY",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    const reservationDecision = decideBookingReservationExecution(
      reserveRes,
      requestFingerprint,
      {
        serviceRoleCaller,
        preReservedGroupId: booking.preReservedGroupId ?? null,
      },
    );
    if (reservationDecision.action === "replay") {
      console.log("Idempotent replay — returning original booking result");
      const replayResult = reservationDecision.result;
      const replayStatus = bookingReplayHttpStatus(replayResult);
      return new Response(JSON.stringify(replayResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: replayStatus,
      });
    }
    if (reservationDecision.action === "idempotency_key_reused") {
      return new Response(
        JSON.stringify({
          success: false,
          code: "IDEMPOTENCY_KEY_REUSED",
          retryable: false,
          error:
            "This request key is already bound to a different or unverifiable booking attempt.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        },
      );
    }
    if (reservationDecision.action === "in_progress_or_uncertain") {
      return new Response(
        JSON.stringify({
          success: false,
          pendingManualConfirmation: true,
          code: "BOOKING_ATTEMPT_IN_PROGRESS_OR_UNCERTAIN",
          retryable: false,
          error:
            "A prior identical booking attempt has no authoritative final result. It will not be repeated until reconciled.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 202,
        },
      );
    }

    // Slot already actively held/booked by someone else → conflict.
    if (reservationDecision.action === "conflict") {
      return new Response(
        JSON.stringify({
          error: "Time slot conflict",
          details:
            "This time slot was just reserved by another customer. Please select a different time.",
          code: "CONFLICT",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      );
    }

    if (reservationDecision.action === "protection_unavailable") {
      return new Response(
        JSON.stringify({
          success: false,
          code: "RESERVATION_PROTECTION_UNAVAILABLE",
          retryable: false,
          error:
            "The booking attempt could not acquire an authoritative idempotency reservation.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 503,
        },
      );
    }
    reservationGroupId = reservationDecision.groupId;

    const protection = await protectReservationForExecution(
      supabase,
      reservationGroupId,
      new Date(Date.now() + 6 * 60_000),
    );
    if (!protection.ok) {
      await supabase.rpc("release_booking_slot", {
        p_group_id: reservationGroupId,
      });
      return new Response(
        JSON.stringify({
          success: false,
          code: "RESERVATION_PROTECTION_UNAVAILABLE",
          retryable: false,
          error:
            "The booking reservation could not be protected for the provider handoff.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 503,
        },
      );
    }

    // If a previous attempt (same key) already created a Jobber job, reuse it so
    // retries never create a duplicate job.
    let existingJobId: string | null = null;
    if (reservationGroupId) {
      const { data: grp } = await supabase
        .from("slot_reservations")
        .select("jobber_job_id")
        .eq("group_id", reservationGroupId)
        .not("jobber_job_id", "is", null)
        .limit(1)
        .maybeSingle();
      existingJobId = grp?.jobber_job_id ?? null;
      if (existingJobId) console.log("Reusing existing Jobber job from prior attempt:", existingJobId);
    }

    // From here on the slot is held. Any failure/return must release the hold
    // (unless we deliberately keep it), so wrap the rest in try/finally.
    let reservationSettled = false;
    let providerMutationAttempted = false;
    try {
    const runProviderMutation = <T>(
      query: string,
      variables?: Record<string, unknown>,
    ) => {
      providerMutationAttempted = true;
      return jobberGraphQLMutation<T>(query, variables);
    };
    const providerOutcomeUncertain = async (
      stage: string,
      providerIds: { jobId?: string | null; visitId?: string | null } = {},
    ): Promise<Response> => {
      const payload = {
        success: false,
        pendingManualConfirmation: true,
        code: "PROVIDER_OUTCOME_UNCERTAIN",
        stage,
        retryable: false,
        error:
          "The provider may have accepted this request, but its result could not be verified. Do not repeat it until BluLadder reconciles the attempt.",
      };
      const { error: replayError } = await supabase.rpc(
        "confirm_booking_slot",
        {
          p_group_id: reservationGroupId,
          p_booking_id: null,
          p_job_id: providerIds.jobId ?? null,
          p_visit_id: providerIds.visitId ?? null,
          p_result: {
            ...payload,
            _requestFingerprint: requestFingerprint,
          },
        },
      );
      if (replayError) {
        console.error("Failed to persist uncertain provider outcome:", replayError);
      } else {
        reservationSettled = true;
      }
      return new Response(JSON.stringify(payload), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };
    // Find or create customer in Supabase
    console.log("Looking up customer by normalized identity");
    let customerLookup = supabase
      .from("customers")
      .select("*");
    customerLookup = voiceLineage?.ok
      ? customerLookup.eq("id", voiceLineage.customerId)
      : customerLookup.eq("email", booking.customer.email.toLowerCase());
    if (organizationResolution.tenantFoundationAvailable) {
      customerLookup = customerLookup.eq(
        "organization_id",
        organizationResolution.organizationId,
      );
    }
    let { data: customer } = await customerLookup.maybeSingle();

    if (!customer && voiceLineage?.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          code: "VOICE_CUSTOMER_MISSING",
          retryable: false,
          error: "The verified customer record is no longer available.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        },
      );
    }
    if (!customer) {
      console.log("Customer not found, creating new customer record");
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          ...organizationWriteFields,
          email: booking.customer.email.toLowerCase(),
          first_name: booking.customer.firstName,
          last_name: booking.customer.lastName,
          phone: booking.customer.phone,
          address: booking.customer.address,
        })
        .select()
        .single();

      if (customerError) {
        console.error("Failed to create customer:", customerError);
        return new Response(
          JSON.stringify({ error: "Failed to create customer", details: customerError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
      customer = newCustomer;
      console.log("Created new customer:", customer.id);
    } else {
      console.log("Found existing customer:", customer.id);
    }

    // Find or create client in Jobber
    let jobberClientId = customer.jobber_client_id;
    console.log("Existing Jobber client ID:", jobberClientId);

    if (!jobberClientId) {
      // Search for existing client by email
      console.log("Searching for existing Jobber client by email");
      const searchQuery = `
        query FindClient($email: String!) {
          clients(searchTerm: $email, first: 50) {
            nodes {
              id
              firstName
              lastName
              emails {
                address
              }
              phones {
                number
              }
            }
          }
        }
      `;

      const searchResult = await jobberGraphQL<{
        clients: {
          nodes: Array<{
            id: string;
            firstName: string;
            lastName: string;
            emails: Array<{ address: string }>;
            phones: Array<{ number: string }>;
          }>;
        };
      }>(searchQuery, { email: booking.customer.email });

      console.log("Jobber client search completed", {
        matched: !!searchResult.data?.clients?.nodes?.[0],
        errorCount: searchResult.errors?.length ?? 0,
      });

      const candidateClients = searchResult.data?.clients?.nodes;
      if (searchResult.errors?.length || !Array.isArray(candidateClients)) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "JOBBER_CLIENT_LOOKUP_UNAVAILABLE",
            error:
              "The verified customer could not be safely matched in Jobber.",
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const clientResolution = resolveJobberClientByVerifiedContact(
        validatedCustomer,
        candidateClients,
      );
      if (
        clientResolution.status === "ambiguous" ||
        clientResolution.status === "conflict"
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            code: clientResolution.status === "ambiguous"
              ? "JOBBER_CLIENT_IDENTITY_AMBIGUOUS"
              : "JOBBER_CLIENT_IDENTITY_CONFLICT",
            error:
              clientResolution.status === "ambiguous"
                ? "More than one Jobber customer matches the verified contact information."
                : "The Jobber customer contact does not match the verified BluLadder customer.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (clientResolution.status === "resolved") {
        jobberClientId = clientResolution.clientId;
        console.log("Found existing Jobber client:", jobberClientId);
      } else {
        // Create new client in Jobber
        console.log("Creating new Jobber client");
        const createClientMutation = `
          mutation CreateClient($input: ClientCreateInput!) {
            clientCreate(input: $input) {
              client {
                id
              }
              userErrors {
                message
                path
              }
            }
          }
        `;

        // Build phone array only if phone is provided
        const phoneInput = booking.customer.phone
          ? [{ number: booking.customer.phone, primary: true }]
          : undefined;

        const clientInput = {
          firstName: booking.customer.firstName,
          lastName: booking.customer.lastName,
          emails: [{ address: booking.customer.email, primary: true }],
          ...(phoneInput && { phones: phoneInput }),
        };
        
        const createResult = await runProviderMutation<{
          clientCreate: {
            client: { id: string } | null;
            userErrors: Array<{ message: string; path?: string[] }>;
          };
        }>(createClientMutation, { input: clientInput });

        if (createResult.outcomeUncertain) {
          return await providerOutcomeUncertain("client_create");
        }
        if (
          createResult.data?.clientCreate?.client?.id &&
          createResult.data.clientCreate.userErrors?.length
        ) {
          return await providerOutcomeUncertain("client_create_contradictory");
        }

        console.log("Jobber client creation completed", {
          created: !!createResult.data?.clientCreate?.client?.id,
          errorCount: createResult.errors?.length ?? 0,
          userErrorCount:
            createResult.data?.clientCreate?.userErrors?.length ?? 0,
        });

        if (createResult.errors?.length) {
          console.error("Jobber client API failed", {
            errorCount: createResult.errors.length,
          });
          return new Response(
            JSON.stringify({ error: "Jobber API error", details: createResult.errors.map(e => e.message).join(", ") }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        const clientCreatePayload = createResult.data?.clientCreate;
        if (
          !clientCreatePayload ||
          !Array.isArray(clientCreatePayload.userErrors) ||
          (clientCreatePayload.client !== null &&
            !clientCreatePayload.client?.id)
        ) {
          return await providerOutcomeUncertain("client_create_malformed");
        }

        if (createResult.data?.clientCreate?.userErrors?.length) {
          console.error("Jobber client creation rejected", {
            errorCount: createResult.data.clientCreate.userErrors.length,
          });
          return new Response(
            JSON.stringify({
              success: false,
              code: "JOBBER_CLIENT_REJECTED",
              error: "Jobber rejected the verified customer record.",
            }),
            {
              status: 422,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        jobberClientId = createResult.data?.clientCreate?.client?.id;
        if (!jobberClientId) {
          return await providerOutcomeUncertain("client_create_malformed");
        }
        console.log("Created Jobber client:", jobberClientId);
      }

      // Claim the local Jobber-client mapping once. A concurrent booking may
      // win this compare-and-set; only the same provider id is acceptable.
      if (jobberClientId) {
        console.log("Updating customer with Jobber client ID");
        let customerLink = supabase
          .from("customers")
          .update({ jobber_client_id: jobberClientId })
          .eq("id", customer.id)
          .is("jobber_client_id", null);
        if (organizationResolution.tenantFoundationAvailable) {
          customerLink = customerLink.eq(
            "organization_id",
            organizationResolution.organizationId,
          );
        }
        const { data: linkedCustomer, error: customerLinkError } =
          await customerLink
            .select("id, jobber_client_id")
            .maybeSingle();
        if (
          customerLinkError || linkedCustomer?.id !== customer.id ||
          linkedCustomer?.jobber_client_id !== jobberClientId
        ) {
          let winnerQuery = supabase
            .from("customers")
            .select("id, jobber_client_id")
            .eq("id", customer.id);
          if (organizationResolution.tenantFoundationAvailable) {
            winnerQuery = winnerQuery.eq(
              "organization_id",
              organizationResolution.organizationId,
            );
          }
          const { data: mappingWinner, error: mappingWinnerError } =
            await winnerQuery.maybeSingle();
          if (
            !mappingWinnerError && mappingWinner?.id === customer.id &&
            mappingWinner?.jobber_client_id === jobberClientId
          ) {
            // An exact concurrent winner established the same authority.
          } else if (providerMutationAttempted) {
            return await providerOutcomeUncertain(
              mappingWinner?.jobber_client_id
                ? "client_link_conflict"
                : "client_link_persistence",
            );
          } else if (mappingWinner?.jobber_client_id) {
            return new Response(
              JSON.stringify({
                success: false,
                code: "JOBBER_CLIENT_LINK_CONFLICT",
                error:
                  "The verified customer is already linked to a different Jobber customer.",
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          } else {
            return new Response(
              JSON.stringify({
                success: false,
                code: "JOBBER_CLIENT_LINK_PERSISTENCE_FAILED",
                error:
                  "The verified Jobber customer mapping could not be recorded.",
              }),
              {
                status: 503,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
        }
      }
    }

    if (!jobberClientId) {
      console.error("Failed to get or create Jobber client");
      return new Response(
        JSON.stringify({ error: "Failed to create or find Jobber client" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Match the submitted service address across the client's properties.
    // Selecting the first property can mutate an unrelated home.
    console.log("Getting client properties:", jobberClientId);
    const getClientPropertyQuery = `
      query GetClientProperty($clientId: EncodedId!) {
        client(id: $clientId) {
          id
          firstName
          lastName
          emails {
            address
          }
          phones {
            number
          }
          clientProperties(first: 50) {
            nodes {
              id
              address {
                street
                city
                province
                postalCode
              }
            }
          }
        }
      }
    `;

    const propertyResult = await jobberGraphQL<{
      client: {
        id: string;
        firstName: string;
        lastName: string;
        emails: Array<{ address: string }>;
        phones: Array<{ number: string }>;
        clientProperties: { nodes: JobberPropertyCandidate[] };
      };
    }>(getClientPropertyQuery, { clientId: jobberClientId });

    console.log("Jobber property lookup completed", {
      propertyCount:
        propertyResult.data?.client?.clientProperties?.nodes?.length ?? 0,
      errorCount: propertyResult.errors?.length ?? 0,
    });
    const providerClientResolution = propertyResult.data?.client
      ? resolveJobberClientByVerifiedContact(
        validatedCustomer,
        [propertyResult.data.client],
      )
      : { status: "missing" as const };
    if (
      propertyResult.errors?.length || !propertyResult.data?.client ||
      propertyResult.data.client.id !== jobberClientId ||
      providerClientResolution.status !== "resolved" ||
      providerClientResolution.clientId !== jobberClientId
    ) {
      return new Response(
        JSON.stringify({
          error:
            "We couldn't verify the exact Jobber customer and service property.",
          code: "JOBBER_CUSTOMER_OR_PROPERTY_LOOKUP_UNAVAILABLE",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    const propertyCandidates =
      propertyResult.data.client.clientProperties?.nodes ?? [];
    const matchingProperties = findMatchingJobberProperties(
      submittedServiceAddress,
      propertyCandidates,
    );
    let propertyId: string | null = null;
    if (voiceLineage?.ok && voiceLineage.jobberPropertyId) {
      const authoritativeProperty = propertyCandidates.find((candidate) =>
        candidate.id === voiceLineage.jobberPropertyId
      );
      if (
        !authoritativeProperty ||
        !matchingProperties.some((candidate) =>
          candidate.id === authoritativeProperty.id
        )
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "JOBBER_PROPERTY_LINEAGE_MISMATCH",
            error:
              "The stored Jobber property does not match the authoritative service address.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      propertyId = authoritativeProperty.id;
    } else {
      if (matchingProperties.length > 1) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "JOBBER_PROPERTY_IDENTITY_AMBIGUOUS",
            error:
              "More than one Jobber property matches the authoritative service address.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      propertyId = matchingProperties[0]?.id ?? null;
    }

    if (!propertyId) {
      // PropertyCreateInput requires a 'properties' array with PropertyInput objects
      console.log("No property found, creating one for client");
      const createPropertyMutation = `
        mutation CreateProperty($clientId: EncodedId!, $input: PropertyCreateInput!) {
          propertyCreate(clientId: $clientId, input: $input) {
            properties {
              id
            }
            userErrors {
              message
              path
            }
          }
        }
      `;

      const propertyInput = {
        properties: [
          {
            address: {
              street1: submittedServiceAddress.street1,
              city: submittedServiceAddress.city,
              province: submittedServiceAddress.province,
              postalCode: submittedServiceAddress.postalCode,
              country: submittedServiceAddress.country,
            }
          }
        ]
      };
      
      const createPropertyResult = await runProviderMutation<{
        propertyCreate: {
          properties: Array<{ id: string }>;
          userErrors: Array<{ message: string; path?: string[] }>;
        };
      }>(createPropertyMutation, { clientId: jobberClientId, input: propertyInput });

      if (createPropertyResult.outcomeUncertain) {
        return await providerOutcomeUncertain("property_create");
      }
      if (createPropertyResult.errors?.length) {
        return new Response(
          JSON.stringify({
            success: false,
            code: "JOBBER_PROPERTY_REJECTED",
            error: "Jobber rejected the authoritative service property.",
          }),
          {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const propertyCreatePayload = createPropertyResult.data?.propertyCreate;
      if (
        !propertyCreatePayload ||
        !Array.isArray(propertyCreatePayload.properties) ||
        !Array.isArray(propertyCreatePayload.userErrors) ||
        propertyCreatePayload.properties.length > 1 ||
        propertyCreatePayload.properties.some((property) => !property?.id)
      ) {
        return await providerOutcomeUncertain("property_create_malformed");
      }
      if (
        createPropertyResult.data?.propertyCreate?.properties?.[0]?.id &&
        createPropertyResult.data.propertyCreate.userErrors?.length
      ) {
        return await providerOutcomeUncertain(
          "property_create_contradictory",
        );
      }

      console.log("Jobber property creation completed", {
        created:
          !!createPropertyResult.data?.propertyCreate?.properties?.[0]?.id,
        errorCount: createPropertyResult.errors?.length ?? 0,
        userErrorCount:
          createPropertyResult.data?.propertyCreate?.userErrors?.length ?? 0,
      });

      // Check userErrors for hints about what went wrong
      if (createPropertyResult.data?.propertyCreate?.userErrors?.length) {
        console.error("Jobber property creation rejected", {
          errorCount:
            createPropertyResult.data.propertyCreate.userErrors.length,
        });
        return new Response(
          JSON.stringify({
            success: false,
            code: "JOBBER_PROPERTY_REJECTED",
            error: "Jobber rejected the authoritative service property.",
          }),
          {
            status: 422,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      propertyId =
        createPropertyResult.data?.propertyCreate?.properties?.[0]?.id ?? null;

      // A valid mutation response without an id is ambiguous. A read-only
      // re-query may recover a provider-created property without repeating the
      // mutation.
      if (!propertyId) {
        console.log("Property creation returned empty, re-querying client");
        const retryResult = await jobberGraphQL<{
          client: {
            id: string;
            emails: Array<{ address: string }>;
            clientProperties: { nodes: JobberPropertyCandidate[] };
          };
        }>(getClientPropertyQuery, { clientId: jobberClientId });
        
        console.log("Jobber property retry completed", {
          propertyCount:
            retryResult.data?.client?.clientProperties?.nodes?.length ?? 0,
          errorCount: retryResult.errors?.length ?? 0,
        });
        const recoveredMatches = findMatchingJobberProperties(
          submittedServiceAddress,
          retryResult.data?.client?.clientProperties?.nodes ?? [],
        );
        if (recoveredMatches.length > 1) {
          return await providerOutcomeUncertain(
            "property_create_requery_ambiguous",
          );
        }
        propertyId = recoveredMatches[0]?.id ?? null;
      }

      if (!propertyId) {
        return await providerOutcomeUncertain("property_create_malformed");
      }
    }

    if (
      voiceLineage?.ok && propertyId && !voiceLineage.jobberPropertyId
    ) {
      const { data: linkedProperty, error: propertyLinkError } = await supabase
        .from("properties")
        .update({ jobber_property_id: propertyId })
        .eq("id", voiceLineage.propertyId)
        .eq("organization_id", voiceLineage.organizationId)
        .is("jobber_property_id", null)
        .select("id, jobber_property_id")
        .maybeSingle();
      let mappingConfirmed = !propertyLinkError &&
        linkedProperty?.jobber_property_id === propertyId;
      if (!mappingConfirmed) {
        const { data: currentProperty, error: propertyReadError } =
          await supabase
            .from("properties")
            .select("id, jobber_property_id")
            .eq("id", voiceLineage.propertyId)
            .eq("organization_id", voiceLineage.organizationId)
            .maybeSingle();
        mappingConfirmed = !propertyReadError &&
          currentProperty?.jobber_property_id === propertyId;
      }
      if (!mappingConfirmed) {
        if (providerMutationAttempted) {
          return await providerOutcomeUncertain(
            "property_link_persistence",
          );
        }
        return new Response(
          JSON.stringify({
            success: false,
            code: "JOBBER_PROPERTY_LINK_PERSISTENCE_FAILED",
            error:
              "The Jobber property mapping could not be recorded safely.",
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    console.log("Using property ID:", propertyId);

    // === CONFLICT DETECTION ===
    // Step 1: Check local busy_blocks mirror first for ALL assigned technicians
    console.log("Checking for scheduling conflicts (local mirror first)...");
    // (requestedStart / requestedEnd were computed earlier for the slot hold.)

    // Check conflicts for all assigned technicians
    for (const tech of technicians) {
      const localCheck = await checkLocalMirrorConflicts(
        supabase,
        tech.jobber_user_id,
        requestedStart,
        requestedEnd
      );
      
      // If local mirror found a conflict, return immediately
      if (localCheck.hasConflict && localCheck.conflictingBlock) {
        const existingStartLocal = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(new Date(localCheck.conflictingBlock.start_at));
        
        return new Response(
          JSON.stringify({ 
            error: "Time slot conflict", 
            details: `This time slot is no longer available. ${tech.name} has another appointment at ${existingStartLocal}. Please select a different time.`,
            code: "CONFLICT",
            conflictingVisit: localCheck.conflictingBlock,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
        );
      }
      
      // Step 2: Fallback to Jobber API only if mirror has no data or is stale
      if (localCheck.noData || localCheck.mirrorStale) {
        console.log(`Falling back to Jobber API for conflict check for ${tech.name} (noData: ${localCheck.noData}, stale: ${localCheck.mirrorStale})`);
        
        const jobberCheck = await checkJobberConflicts(
          tech.jobber_user_id,
          requestedStart,
          requestedEnd,
          tech.name
        );
        
        // Fail-soft: If Jobber is throttled, return 503 with friendly message
        if (jobberCheck.throttled) {
          return new Response(
            JSON.stringify({
              error: "Scheduling is busy",
              details: "Our scheduling system is currently busy. Please try again in 1-2 minutes.",
              code: "SCHEDULING_BUSY",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
          );
        }

        // FAIL CLOSED: if the conflict query errored or returned malformed data
        // we cannot positively verify the slot is free — stop the booking.
        if (jobberCheck.error) {
          console.error(`Conflict verification failed for ${tech.name} — refusing to book (fail closed)`);
          return new Response(
            JSON.stringify({
              error: "Unable to verify availability",
              details:
                "We're unable to verify this appointment time right now. Please select another time later or request that our team contact you.",
              code: "VERIFY_UNAVAILABLE",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
          );
        }

        if (jobberCheck.hasConflict && jobberCheck.conflictingVisit) {
          const existingStartLocal = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(jobberCheck.conflictingVisit.startAt));
          
          return new Response(
            JSON.stringify({ 
              error: "Time slot conflict", 
              details: `This time slot is no longer available. ${tech.name} has another appointment at ${existingStartLocal}. Please select a different time.`,
              code: "CONFLICT",
              conflictingVisit: jobberCheck.conflictingVisit,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
          );
        }
      }
    }
    
    console.log("No conflicts detected, proceeding with booking");

    // ------------------------------------------------------------------
    // Lead source resolution (Phase 2 wiring).
    //
    // Jobber's GraphQL 2025-04-16 `ClientCreateInput` and `JobCreateAttributes`
    // do not expose a first-class Lead Source field that we can reliably set
    // from the API for this account. All 13 `lead_source_definitions` are
    // therefore mapped to `internal_note`: we surface the label inside the
    // job's `instructions` (technician-visible) and record an idempotent
    // `lead_source_sync_events` audit row so the write is auditable and
    // safe to retry.
    // ------------------------------------------------------------------
    let leadSourceLabel = "";
    let leadSourceAudit: {
      source_key: string | null;
      mapping_mode: string;
      display_name: string | null;
      self_reported_detail: string | null;
    } | null = null;
    try {
      const attrSessionId =
        booking.attribution?.source_session_id ?? booking.sourceSessionId ?? null;
      // The booking row (and therefore the `persist_booking_lead_attribution`
      // trigger that normalizes attribution_events) has NOT been inserted yet
      // at this point, so we must resolve the self-reported source directly
      // from the request payload. The stored attribution_events row is only a
      // fallback for retries / server-side captured sessions.
      const reportedSource =
        booking.attribution?.self_reported_source?.trim() || null;
      const reportedDetail =
        booking.attribution?.self_reported_source_detail?.trim() || null;

      let srcKey: string | null = null;
      let storedDetail: string | null = reportedDetail;

      if (reportedSource) {
        const { data: normalized } = await supabase.rpc("normalize_lead_source", {
          p_value: reportedSource,
        });
        srcKey = (normalized as string | null) ?? null;
      }

      if (!srcKey && attrSessionId) {
        const { data: attrRow } = await supabase
          .from("attribution_events")
          .select("normalized_source_key, self_reported_source_detail")
          .eq("source_session_id", attrSessionId)
          .maybeSingle();
        srcKey = attrRow?.normalized_source_key ?? null;
        storedDetail = storedDetail ?? attrRow?.self_reported_source_detail ?? null;
      }

      if (srcKey) {
        const { data: def } = await supabase
          .from("lead_source_definitions")
          .select("source_key, display_name, jobber_mapping_mode")
          .eq("source_key", srcKey)
          .maybeSingle();
        if (def) {
          const detail = storedDetail ? String(storedDetail).trim().slice(0, 120) : "";
          leadSourceLabel = detail
            ? `Lead Source: ${def.display_name} — ${detail}`
            : `Lead Source: ${def.display_name}`;
          leadSourceAudit = {
            source_key: def.source_key,
            mapping_mode: def.jobber_mapping_mode,
            display_name: def.display_name,
            self_reported_detail: detail || null,
          };
        }
      }
    } catch (e) {
      console.warn("Lead source lookup failed (non-fatal):", (e as Error).message);
    }

    // Build notes for the job
    // Only include customer's special instructions in Jobber job notes
    // The detailed home info, services, and pricing are tracked in our local booking record
    // Promotion preparation requirements (e.g. "remove screens before arrival")
    // must travel with the job so the crew and customer both see them.
    const jobInstructions = [
      promoPrepInstructions ? `PREP REQUIRED: ${promoPrepInstructions}` : "",
      booking.notes?.trim() || "",
      leadSourceLabel,
      // Booking idempotency reference — enables reconciliation to correlate
      // orphaned Jobber jobs back to the original booking attempt.
      // Kept as a short human-readable line (no JSON) per instructions-format rules.
      `Ref: ${idempotencyKey}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Create job in Jobber using JobCreateAttributes
    console.log("Creating job in Jobber");
    
    const createJobMutation = `
      mutation CreateJob($input: JobCreateAttributes!) {
        jobCreate(input: $input) {
          job {
            id
            jobNumber
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const lineItems = buildJobberBookingLineItems({
      services: booking.services,
      priceAdjustments: booking.priceAdjustments,
      discountAmount: booking.discountAmount,
      discountCode: booking.discountCode,
    });

    // JobCreateAttributes requires propertyId, invoicing, and optional fields
    const jobInput = {
      propertyId: propertyId,
      title: `BluLadder Services - ${booking.customer.firstName} ${booking.customer.lastName}`,
      instructions: jobInstructions,
      lineItems,
      invoicing: {
        invoicingType: "VISIT_BASED",
        invoicingSchedule: "ON_COMPLETION",
      },
      scheduling: {
        createVisits: false,
        notifyTeam: false,
        assignedTo: allJobberUserIds,
      },
    };
    
    console.log("Job creation prepared", {
      lineItemsCount: lineItems.length,
      hasProperty: !!propertyId,
    });

    let jobberJobId: string | null = existingJobId;
    let jobNumber: number | null = null;

    if (existingJobId) {
      // Idempotent retry: the job was created on a previous attempt. Skip job
      // creation and go straight to (re)creating the visit.
      console.log("Skipping job creation — reusing job from prior attempt:", existingJobId);
    } else {
      const jobResult = await runProviderMutation<{
        jobCreate: {
          job: { id: string; jobNumber: number } | null;
          userErrors: Array<{ message: string; path?: string[] }>;
        };
      }>(createJobMutation, { input: jobInput });

      if (jobResult.outcomeUncertain) {
        return await providerOutcomeUncertain("job_create");
      }
      if (
        jobResult.data?.jobCreate?.job?.id &&
        jobResult.data.jobCreate.userErrors?.length
      ) {
        return await providerOutcomeUncertain(
          "job_create_contradictory",
          { jobId: jobResult.data.jobCreate.job.id },
        );
      }

      console.log("Jobber job creation completed", {
        created: !!jobResult.data?.jobCreate?.job?.id,
        errorCount: jobResult.errors?.length ?? 0,
        userErrorCount: jobResult.data?.jobCreate?.userErrors?.length ?? 0,
      });

      if (jobResult.errors?.length) {
        console.error("Jobber job API failed", {
          errorCount: jobResult.errors.length,
        });
        return new Response(
          JSON.stringify({ error: "Failed to create job in Jobber", details: jobResult.errors.map(e => e.message).join(", ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      const jobCreatePayload = jobResult.data?.jobCreate;
      if (
        !jobCreatePayload || !Array.isArray(jobCreatePayload.userErrors) ||
        (jobCreatePayload.job !== null && !jobCreatePayload.job?.id)
      ) {
        return await providerOutcomeUncertain("job_create_malformed");
      }

      if (jobResult.data?.jobCreate?.userErrors?.length) {
        console.error("Jobber job creation rejected", {
          errorCount: jobResult.data.jobCreate.userErrors.length,
        });
        return new Response(
          JSON.stringify({ error: "Failed to create job in Jobber", details: jobResult.data.jobCreate.userErrors.map(e => e.message).join(", ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      jobberJobId = jobResult.data?.jobCreate?.job?.id ?? null;
      jobNumber = jobResult.data?.jobCreate?.job?.jobNumber ?? null;

      if (!jobberJobId) {
        return await providerOutcomeUncertain("job_create_malformed");
      }

      // Persist the job id against the reservation so a later retry reuses it
      // instead of creating a duplicate Jobber job.
      if (reservationGroupId) {
        const { error: reservationJobError } = await supabase.rpc(
          "set_reservation_job",
          { p_group_id: reservationGroupId, p_job_id: jobberJobId },
        );
        if (reservationJobError) {
          return await providerOutcomeUncertain(
            "job_id_persistence",
            { jobId: jobberJobId },
          );
        }
      }

      console.log("Created job:", jobberJobId, "Job number:", jobNumber);
    }

    // Idempotent lead-source sync audit. The unique constraint on
    // `idempotency_key` guarantees retries never insert duplicates; existing
    // rows are left untouched.
    if (leadSourceAudit && jobberJobId) {
      try {
        await supabase
          .from("lead_source_sync_events")
          .insert({
            entity_type: "booking",
            entity_id: null,
            provider: "jobber",
            idempotency_key: `booking:${idempotencyKey}`,
            source_key: leadSourceAudit.source_key,
            mapping_mode: leadSourceAudit.mapping_mode,
            request_payload: {
              jobber_job_id: jobberJobId,
              jobber_client_id: jobberClientId,
              display_name: leadSourceAudit.display_name,
              self_reported_detail: leadSourceAudit.self_reported_detail,
              written_via: "job_instructions",
            },
            response_payload: { note_included: true },
            status: "succeeded",
            attempt_count: 1,
            last_attempt_at: new Date().toISOString(),
          });
      } catch (e) {
        // Duplicate idempotency_key (retry) is expected and safe; other errors
        // are logged but never block the booking flow.
        const msg = (e as Error).message || "";
        if (!/duplicate|unique/i.test(msg)) {
          console.warn("lead_source_sync_events insert failed:", msg);
        }
      }
    }

    // Schedule a visit for the job using VisitCreateInput
    // VisitCreateInput requires a 'visits' array, and response has 'createdVisits'
    console.log("Creating visit for job");
    const scheduleVisitMutation = `
      mutation ScheduleVisit($jobId: EncodedId!, $input: VisitCreateInput!) {
        visitCreate(jobId: $jobId, input: $input) {
          createdVisits {
            id
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    // Parse the scheduled times into LocalDateTimeAttributes format
    // Jobber requires: { date: "YYYY-MM-DD", time: "HH:MM", timezone: "America/Chicago" }
    // CRITICAL: Use Intl.DateTimeFormat to convert UTC to Central time correctly
    const parseToLocalDateTime = (isoString: string) => {
      // If the incoming string has no timezone information, assume it's already local (America/Chicago)
      // and avoid accidentally treating it as UTC.
      const hasTz = /Z$|[+-]\d{2}:\d{2}$/.test(isoString);
      if (!hasTz && isoString.includes('T')) {
        const [datePart, timePartRaw] = isoString.split('T');
        const timePart = (timePartRaw || '').slice(0, 5);
        const localTime = timePart && /^\d{2}:\d{2}$/.test(timePart) ? timePart : '00:00';

        console.log(`Timezone conversion (no TZ provided; treating as local): ${isoString} -> date: ${datePart}, time: ${localTime} (America/Chicago)`);
        return {
          date: datePart,
          time: localTime,
          timezone: "America/Chicago",
        };
      }

      const date = new Date(isoString);
      
      // Use Intl.DateTimeFormat to get the correct local time in America/Chicago
      const dateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      
      // en-CA gives YYYY-MM-DD format
      const localDate = dateFormatter.format(date);
      
      // Extract HH:MM from the formatted time
      const timeParts = timeFormatter.formatToParts(date);
      const hour = timeParts.find(p => p.type === 'hour')?.value || '00';
      const minute = timeParts.find(p => p.type === 'minute')?.value || '00';
      const localTime = `${hour}:${minute}`;
      
      console.log(`Timezone conversion: ${isoString} -> date: ${localDate}, time: ${localTime} (America/Chicago)`);
      
      return {
        date: localDate,
        time: localTime,
        timezone: "America/Chicago"
      };
    };

    // VisitCreateInput.visits is an array of VisitCreateAttributes
    // VisitCreateAttributes has 'schedule' (ScheduledItemAttributes)
    // ScheduledItemAttributes has startAt/endAt as LocalDateTimeAttributes and teamMemberIdsToAssign
    const visitInput = {
      visits: [
        {
          schedule: {
            startAt: parseToLocalDateTime(booking.scheduledStart),
            endAt: parseToLocalDateTime(booking.scheduledEnd),
            teamMemberIdsToAssign: allJobberUserIds,
          },
        }
      ]
    };
    
    console.log("Jobber visit creation prepared", {
      hasJob: !!jobberJobId,
      visitCount: visitInput.visits?.length ?? 0,
    });

    const visitResult = await runProviderMutation<{
      visitCreate: {
        createdVisits: Array<{ id: string }> | null;
        userErrors: Array<{ message: string; path?: string[] }>;
      };
    }>(scheduleVisitMutation, { jobId: jobberJobId, input: visitInput });

    if (visitResult.outcomeUncertain) {
      return await providerOutcomeUncertain(
        "visit_create",
        { jobId: jobberJobId },
      );
    }
    const visitCreatePayload = visitResult.data?.visitCreate;
    if (
      !visitResult.errors?.length &&
      (!visitCreatePayload ||
        !Array.isArray(visitCreatePayload.createdVisits) ||
        !Array.isArray(visitCreatePayload.userErrors) ||
        (visitCreatePayload.createdVisits.length === 0 &&
          visitCreatePayload.userErrors.length === 0) ||
        visitCreatePayload.createdVisits.length > 1 ||
        visitCreatePayload.createdVisits.some((visit) => !visit?.id))
    ) {
      return await providerOutcomeUncertain(
        "visit_create_malformed",
        { jobId: jobberJobId },
      );
    }
    if (
      visitResult.data?.visitCreate?.createdVisits?.[0]?.id &&
      visitResult.data.visitCreate.userErrors?.length
    ) {
      return await providerOutcomeUncertain(
        "visit_create_contradictory",
        {
          jobId: jobberJobId,
          visitId: visitResult.data.visitCreate.createdVisits[0].id,
        },
      );
    }

    console.log("Jobber visit creation completed", {
      created: !!visitResult.data?.visitCreate?.createdVisits?.[0]?.id,
      errorCount: visitResult.errors?.length ?? 0,
      userErrorCount: visitResult.data?.visitCreate?.userErrors?.length ?? 0,
    });

    const jobberVisitId = visitResult.data?.visitCreate?.createdVisits?.[0]?.id;

    if (visitResult.data?.visitCreate?.userErrors?.length) {
      console.error("Jobber visit creation rejected", {
        errorCount: visitResult.data.visitCreate.userErrors.length,
      });
    }

    // Generate reference number
    const { data: refData } = await supabase.rpc("generate_booking_reference");
    const referenceNumber = refData || `BL-${Date.now()}`;
    console.log("Generated reference:", referenceNumber);
    const canonicalDiscountTotal = voiceLineage?.ok
      ? Math.max(
        0,
        -Number(voiceLineage.lastQuote.discountsAndAdjustments ?? 0),
      )
      : booking.discountAmount || 0;
    const canonicalQuoteId = voiceLineage?.ok
      ? booking.voiceContract?.quoteId ?? null
      : resumedQuote?.quoteId ?? null;
    const canonicalPropertyId = voiceLineage?.ok
      ? voiceLineage.propertyId
      : null;

    // ===== FAIL SAFE: never confirm a booking without a Jobber visit =====
    // If the job was created but the visit was NOT, the appointment does not
    // actually exist on the calendar. Record it for manual recovery instead of
    // reporting success. The reservation is intentionally kept (not released) so
    // the slot stays protected while staff finish the visit.
    if (!jobberVisitId) {
      console.error("Visit creation failed — recording booking as needs_attention for recovery");
      const { data: naBooking, error: naBookingError } = await supabase
        .from("bookings")
        .insert({
          ...organizationWriteFields,
          customer_id: customer.id,
          quote_id: canonicalQuoteId,
          property_id: canonicalPropertyId,
          technician_id: booking.technicianId,
          jobber_job_id: jobberJobId,
          jobber_visit_id: null,
          reference_number: referenceNumber,
          status: "needs_attention",
          scheduled_start: booking.scheduledStart,
          scheduled_end: booking.scheduledEnd,
          duration_minutes: booking.durationMinutes,
          services_json: booking.services,
          home_details_json: booking.homeDetails,
          subtotal: booking.subtotal,
          discount_amount: canonicalDiscountTotal,
          total: booking.total,
          discount_code: booking.discountCode,
          notes: booking.notes,
          utm_params_json: booking.utmParams && Object.keys(booking.utmParams).length > 0 ? booking.utmParams : null,
          pricing_engine_version: pricingSnapshot.engineVersion,
          pricing_rule_version: pricingSnapshot.ruleVersion,
          input_snapshot: pricingSnapshot.inputSnapshot,
          line_item_snapshot: pricingSnapshot.lineItemSnapshot,
          discount_snapshot: pricingSnapshot.discountSnapshot,
        })
        .select()
        .maybeSingle();

      if (naBookingError || !naBooking?.id) {
        const failedInterventionPayload = {
          success: false,
          pendingManualConfirmation: false,
          interventionState: "intervention_record_failed",
          code: "INTERVENTION_RECORD_FAILED",
          referenceNumber,
          retryable: false,
          error:
            "We couldn't complete or record this appointment request. Please do not resubmit this time slot; contact BluLadder so the provider result can be checked.",
        };
        if (reservationGroupId) {
          const { error: failureReplayError } = await supabase.rpc(
            "confirm_booking_slot",
            {
              p_group_id: reservationGroupId,
              p_booking_id: null,
              p_job_id: jobberJobId,
              p_visit_id: null,
              p_result: {
                ...failedInterventionPayload,
                _requestFingerprint: requestFingerprint,
              },
            },
          );
          if (failureReplayError) {
            console.error(
              "Failed to persist intervention failure replay result:",
              failureReplayError,
            );
          }
        }
        reservationSettled = true;
        return new Response(
          JSON.stringify(failedInterventionPayload),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 503,
          },
        );
      }

      const recordedInterventionPayload = {
        success: false,
        pendingManualConfirmation: true,
        interventionState: "intervention_recorded",
        code: "VISIT_CREATION_FAILED",
        referenceNumber,
        bookingId: naBooking.id,
        retryable: false,
        error:
          "We couldn't fully confirm this appointment automatically. Your request was recorded for manual review, but no appointment is confirmed. Please do not resubmit this time slot.",
      };
      if (reservationGroupId) {
        const { error: interventionReplayError } = await supabase.rpc(
          "confirm_booking_slot",
          {
            p_group_id: reservationGroupId,
            p_booking_id: naBooking.id,
            p_job_id: jobberJobId,
            p_visit_id: null,
            p_result: {
              ...recordedInterventionPayload,
              _requestFingerprint: requestFingerprint,
            },
          },
        );
        if (interventionReplayError) {
          console.error(
            "Failed to persist recorded intervention replay result:",
            interventionReplayError,
          );
        }
      }

      // Keep the reservation hold so the slot can't be double-booked during recovery.
      reservationSettled = true;
      return new Response(
        JSON.stringify(recordedInterventionPayload),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    }

    // Create booking record in Supabase (confirmed — visit exists)
    console.log("Creating booking record in Supabase");
    const { data: bookingRecord, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        ...organizationWriteFields,
        customer_id: customer.id,
        quote_id: canonicalQuoteId,
        property_id: canonicalPropertyId,
        technician_id: booking.technicianId,
        jobber_job_id: jobberJobId,
        jobber_visit_id: jobberVisitId,
        reference_number: referenceNumber,
        status: "scheduled",
        scheduled_start: booking.scheduledStart,
        scheduled_end: booking.scheduledEnd,
        duration_minutes: booking.durationMinutes,
        services_json: booking.services,
        home_details_json: booking.homeDetails,
        subtotal: booking.subtotal,
        discount_amount: canonicalDiscountTotal,
        total: booking.total,
        discount_code: booking.discountCode,
        notes: booking.notes,
        utm_params_json: booking.utmParams && Object.keys(booking.utmParams).length > 0 ? booking.utmParams : null,
        pricing_engine_version: pricingSnapshot.engineVersion,
        pricing_rule_version: pricingSnapshot.ruleVersion,
        input_snapshot: pricingSnapshot.inputSnapshot,
        line_item_snapshot: pricingSnapshot.lineItemSnapshot,
        discount_snapshot: pricingSnapshot.discountSnapshot,
        // Marketing attribution and canonical booked revenue snapshot.
        // These values are echoes of what we just wrote in `subtotal`/`total`
        // (from the server-recomputed authoritative pricing pipeline). We
        // record them into the attribution-specific columns so the marketing
        // funnel view can filter and aggregate without joining line items.
        attribution: booking.attribution ?? null,
        source_session_id: booking.attribution?.source_session_id ?? booking.sourceSessionId ?? null,
        booked_revenue: booking.total,
        booked_subtotal: booking.subtotal,
        booked_discount_amount: canonicalDiscountTotal,
        booked_service_count: Array.isArray(booking.services) ? booking.services.length : null,
        booked_services: booking.services?.map((s) => s.name) ?? null,
        booking_completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    const canonicalBookingRecordMismatch = voiceLineage?.ok &&
      (!bookingRecord ||
        bookingRecord.organization_id !== voiceLineage.organizationId ||
        bookingRecord.customer_id !== voiceLineage.customerId ||
        bookingRecord.property_id !== voiceLineage.propertyId ||
        bookingRecord.quote_id !== canonicalQuoteId ||
        bookingRecord.technician_id !== booking.technicianId ||
        bookingRecord.jobber_job_id !== jobberJobId ||
        bookingRecord.jobber_visit_id !== jobberVisitId ||
        bookingRecord.reference_number !== referenceNumber ||
        bookingRecord.status !== "scheduled" ||
        !sameScheduledInstant(
          bookingRecord.scheduled_start,
          booking.scheduledStart,
        ) ||
        !sameScheduledInstant(
          bookingRecord.scheduled_end,
          booking.scheduledEnd,
        ) ||
        bookingRecord.duration_minutes !== booking.durationMinutes ||
        !sameJson(bookingRecord.services_json, booking.services) ||
        !sameJson(bookingRecord.home_details_json, booking.homeDetails) ||
        !sameJson(bookingRecord.input_snapshot, pricingSnapshot.inputSnapshot) ||
        !sameJson(
          bookingRecord.line_item_snapshot,
          pricingSnapshot.lineItemSnapshot,
        ) ||
        !sameJson(
          bookingRecord.discount_snapshot,
          pricingSnapshot.discountSnapshot,
        ) ||
        !exactNumber(
          bookingRecord.discount_amount,
          canonicalDiscountTotal,
        ) ||
        !exactNumber(bookingRecord.subtotal, booking.subtotal) ||
        !exactNumber(bookingRecord.total, booking.total));
    if (bookingError || canonicalBookingRecordMismatch) {
      console.error(
        "Failed to create or verify booking record:",
        bookingError ?? "canonical booking record mismatch",
      );
      // The Jobber job and visit exist, but BluLadder cannot truthfully claim a
      // confirmed booking until its authoritative local record is durable.
      // Persist a non-success replay result on the reservation so retries do
      // not create another provider job or visit.
      const pendingPersistencePayload = {
        success: false,
        pendingManualConfirmation: true,
        code: "LOCAL_BOOKING_PERSISTENCE_FAILED",
        referenceNumber,
        jobNumber,
        jobberJobId,
        jobberVisitId,
        error:
          "Your appointment was created with our scheduling provider, but we couldn't finish recording the confirmation. Our team must verify it before it is confirmed — please don't rebook.",
      };
      if (reservationGroupId) {
        const { error: pendingReplayError } = await supabase.rpc(
          "confirm_booking_slot",
          {
            p_group_id: reservationGroupId,
            p_booking_id: bookingRecord?.id ?? null,
            p_job_id: jobberJobId,
            p_visit_id: jobberVisitId,
            p_result: {
              ...pendingPersistencePayload,
              _requestFingerprint: requestFingerprint,
            },
          },
        );
        if (pendingReplayError) {
          console.error(
            "Failed to persist pending booking result:",
            pendingReplayError,
          );
        }
      }
      reservationSettled = true;
      return new Response(
        JSON.stringify(pendingPersistencePayload),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    } else {
      console.log("Created booking record:", bookingRecord.id);
      // Link the attribution_events row to this booking + Jobber ids (best-effort).
      const sessionForLink = booking.attribution?.source_session_id ?? booking.sourceSessionId;
      if (sessionForLink) {
        try {
          await supabase
            .from("attribution_events")
            .update({
              booking_id: bookingRecord.id,
              customer_id: customer.id,
              jobber_job_id: jobberJobId,
              jobber_client_id: (customer as { jobber_client_id?: string }).jobber_client_id ?? null,
            })
            .eq("source_session_id", sessionForLink);
        } catch (e) {
          console.warn("attribution link failed:", (e as Error).message);
        }
      }

      // Capability-authenticated resumed bookings already wrote the exact
      // quote_id in the booking insert. Preserve the legacy session link only
      // for ordinary DFW bookings that did not claim a specific quote.
      try {
        if (!resumedQuote && sessionForLink) {
          const { data: linkedQuote } = await supabase
            .from("quotes")
            .select("id")
            .eq("source_session_id", sessionForLink)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (linkedQuote?.id) {
            await supabase.from("bookings").update({ quote_id: linkedQuote.id }).eq("id", bookingRecord.id);
            (bookingRecord as Record<string, unknown>).quote_id = linkedQuote.id;
          }
        }
      } catch (e) {
        console.warn("quote_id link failed:", (e as Error).message);
      }

      // A resumed bid becomes converted only after both the provider visit and
      // the local booking row are durable. Compare-and-set the status observed
      // before provider mutation so a concurrent decline/conversion cannot be
      // silently overwritten.
      if (resumedQuote) {
        const convertedAt = new Date().toISOString();
        const { data: convertedQuote, error: conversionError } = await supabase
          .from("quotes")
          .update({
            status: "converted",
            converted_booking_id: bookingRecord.id,
            converted_at: convertedAt,
            last_activity_at: convertedAt,
          })
          .eq("id", resumedQuote.quoteId)
          .eq("status", resumedQuote.status)
          .is("converted_booking_id", null)
          .select("id")
          .maybeSingle();

        let conversionConfirmed = !conversionError && !!convertedQuote?.id;
        if (!conversionConfirmed) {
          const { data: currentQuote } = await supabase
            .from("quotes")
            .select("status, converted_booking_id")
            .eq("id", resumedQuote.quoteId)
            .maybeSingle();
          conversionConfirmed =
            currentQuote?.status === "converted" &&
            currentQuote?.converted_booking_id === bookingRecord.id;

          // The provider visit and exact local booking lineage are already
          // durable, so acceptance wins a simultaneous customer decline. This
          // second CAS is intentionally narrow: only this booking can promote
          // a currently declined quote, and no existing conversion is replaced.
          if (
            !conversionConfirmed &&
            currentQuote?.status === "declined" &&
            !currentQuote.converted_booking_id
          ) {
            const { data: recoveredConversion } = await supabase
              .from("quotes")
              .update({
                status: "converted",
                converted_booking_id: bookingRecord.id,
                converted_at: convertedAt,
                last_activity_at: convertedAt,
              })
              .eq("id", resumedQuote.quoteId)
              .eq("status", "declined")
              .is("converted_booking_id", null)
              .select("id")
              .maybeSingle();
            conversionConfirmed = !!recoveredConversion?.id;
          }
        }

        if (!conversionConfirmed) {
          console.error(
            "Quote conversion requires reconciliation:",
            conversionError?.message ?? "compare-and-set did not match",
          );
          const pendingConversionPayload = {
            success: false,
            pendingManualConfirmation: true,
            code: "QUOTE_CONVERSION_RECONCILIATION_REQUIRED",
            referenceNumber,
            jobNumber,
            jobberJobId,
            jobberVisitId,
            bookingId: bookingRecord.id,
            error:
              "Your appointment was created with our scheduling provider, but we couldn't finish linking the accepted bid. Our team must verify it — please don't rebook.",
          };
          if (reservationGroupId) {
            try {
              await supabase.rpc("confirm_booking_slot", {
                p_group_id: reservationGroupId,
                p_booking_id: bookingRecord.id,
                p_job_id: jobberJobId,
                p_visit_id: jobberVisitId,
                p_result: {
                  ...pendingConversionPayload,
                  _requestFingerprint: requestFingerprint,
                },
              });
            } catch (e) {
              console.warn("Failed to persist quote-reconciliation result:", e);
            }
          }
          reservationSettled = true;
          return new Response(
            JSON.stringify(pendingConversionPayload),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 202,
            },
          );
        }
      }
    }

    const successPayload = {
      success: true,
      referenceNumber,
      jobNumber,
      jobberJobId,
      jobberVisitId,
      scheduledStart: booking.scheduledStart,
      scheduledEnd: booking.scheduledEnd,
      technicianName: technicianNames,
      bookingId: bookingRecord?.id,
      providerStatus: "accepted",
      localStatus: "persisted",
      organizationId: booking.voiceContract?.organizationId,
      customerId: booking.voiceContract?.customerId,
      propertyId: booking.voiceContract?.propertyId,
      quoteFingerprint: booking.voiceContract?.quoteFingerprint,
      bookingInputsKey: booking.voiceContract?.bookingInputsKey,
      offerVersion: booking.voiceContract?.offerVersion,
      slotId: booking.voiceContract?.slotId,
      durationMinutes: booking.durationMinutes,
      idempotencyKey,
      commandHash: booking.voiceContract?.commandHash,
      subtotal: booking.subtotal,
      estimatedTax: booking.estimatedTax,
      total: booking.total,
      isTeamJob: booking.isTeamJob || false,
      crewSize: technicians.length,
      protectedTest: protectedSyntheticRunId
        ? {
          runId: protectedSyntheticRunId,
          communicationsSuppressed: true,
        }
        : undefined,
    };

    // Convert the temporary hold into a confirmed reservation and store the
    // result so any idempotent retry returns this exact outcome.
    if (reservationGroupId) {
      const { error: reservationConfirmationError } = await supabase.rpc(
        "confirm_booking_slot",
        {
          p_group_id: reservationGroupId,
          p_booking_id: bookingRecord?.id ?? null,
          p_job_id: jobberJobId,
          p_visit_id: jobberVisitId,
          p_result: {
            ...successPayload,
            _requestFingerprint: requestFingerprint,
          },
        },
      );
      const { data: confirmedReservation, error: reservationReadError } =
        reservationConfirmationError
          ? { data: null, error: reservationConfirmationError }
          : await supabase
            .from("slot_reservations")
            .select("status, booking_id, jobber_job_id, jobber_visit_id, result_json")
            .eq("group_id", reservationGroupId)
            .limit(1)
            .maybeSingle();
      if (
        reservationConfirmationError || reservationReadError ||
        confirmedReservation?.status !== "confirmed" ||
        confirmedReservation?.booking_id !== bookingRecord?.id ||
        confirmedReservation?.jobber_job_id !== jobberJobId ||
        confirmedReservation?.jobber_visit_id !== jobberVisitId ||
        !requestFingerprintMatches(
          confirmedReservation?.result_json,
          requestFingerprint,
        )
      ) {
        reservationSettled = true;
        return new Response(
          JSON.stringify({
            success: false,
            pendingManualConfirmation: true,
            code: "BOOKING_REPLAY_PERSISTENCE_FAILED",
            retryable: false,
            bookingId: bookingRecord?.id,
            jobberJobId,
            jobberVisitId,
            error:
              "The provider and local booking exist, but the duplicate-prevention result could not be verified. Do not repeat this request.",
          }),
          {
            status: 202,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }
    reservationSettled = true;

    // Fire-and-forget appointment-confirmation SMS + campaign enrollment.
    if (bookingRecord?.id && !protectedSyntheticRunId) {
      try {
        fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ eventType: "appointment_scheduled", bookingId: bookingRecord.id }),
        }).catch((e) => console.warn("Appointment SMS dispatch failed:", e));
      } catch (smsErr) {
        console.warn("Appointment SMS dispatch error:", smsErr);
      }
    }

    // Transactional booking emails — customer confirmation + internal owner
    // alert. Independent of SMS: one channel failing must not affect the
    // others. Sends are deduplicated per (booking, channel) inside the helper
    // so refreshes, retries and idempotent replays never send twice. Only
    // fires when a real Jobber visit id exists.
    if (bookingRecord?.id && jobberVisitId && !protectedSyntheticRunId) {
      try {
        const emailCtx = {
          bookingId: bookingRecord.id,
          referenceNumber,
          jobberVisitId,
          jobberJobId,
          scheduledStart: booking.scheduledStart,
          scheduledEnd: booking.scheduledEnd,
          serviceAddress: booking.customer.address || "",
          services: (booking.services || []).map((s) => ({ name: (s as any).name, price: (s as any).price })),
          subtotal: booking.subtotal,
          discountAmount: canonicalDiscountTotal,
          discountCode: booking.discountCode ?? null,
          total: booking.total,
          technicianName: technicianNames,
          durationMinutes: booking.durationMinutes,
          customer: {
            firstName: booking.customer.firstName,
            lastName: booking.customer.lastName,
            email: booking.customer.email,
            phone: booking.customer.phone ?? null,
          },
          utm: booking.utmParams
            ? {
                campaign: booking.utmParams.utm_campaign,
                content: booking.utmParams.utm_content,
                source: booking.utmParams.utm_source,
                medium: booking.utmParams.utm_medium,
                landing_page_slug: booking.attribution?.landing_page_slug,
              }
            : null,
          attributionSource: booking.attribution?.last_touch
            ? String((booking.attribution.last_touch as Record<string, unknown>).utm_source || "")
            : null,
        };
        sendBookingConfirmationEmails(supabase, emailCtx)
          .then((r) => console.log("Booking emails:", JSON.stringify({ customer: r.customer.status, owner: r.owner.status })))
          .catch((e) => console.warn("Booking email dispatch failed:", (e as Error).message));
      } catch (emailErr) {
        console.warn("Booking email dispatch error:", emailErr);
      }
    }

    // booking_completed — emitted ONLY after a confirmed Jobber visit exists
    // (the needs_attention / visit-creation-failed paths above return earlier).
    // Idempotency is keyed on booking id + booking_version so a genuine
    // reschedule that bumps the version emits a fresh confirmation, while a
    // simple metadata refresh does not. This is a STOP event for the
    // abandoned/decline-nurture on the specific quote journey.
    if (protectedSyntheticRunId) {
      console.warn(JSON.stringify({
        event: "protected_booking_test_communications_suppressed",
        run_id: protectedSyntheticRunId,
        booking_id: bookingRecord?.id ?? null,
        sms_suppressed: true,
        email_suppressed: true,
        campaign_event_suppressed: true,
      }));
    } else try {
      const bookingIdForKey = bookingRecord?.id ?? jobberVisitId;
      const bookingVersion = Number((bookingRecord as Record<string, unknown> | null)?.booking_version ?? 1);
      const linkedQuoteId = (bookingRecord as Record<string, unknown> | null)?.quote_id as string | undefined;
      const sessionId = booking.attribution?.source_session_id ?? booking.sourceSessionId ?? null;
      const serviceNames = Array.isArray(booking.services)
        ? booking.services.map((s: any) => s?.name ?? s?.service ?? s).filter(Boolean) as string[]
        : [];
      const APP_URL = getAppUrl();
      const manageLink = `${APP_URL}/customer-portal`;

      await emitCampaignEvent({
        eventName: "booking_completed",
        idempotencyKey: `booking_completed:${bookingIdForKey}:v${bookingVersion}`,
        email: booking.customer?.email ?? null,
        phone: booking.customer?.phone ?? null,
        customerId: customer.id,
        source: "jobber-create-booking",
        subject: "One-time booking completed",
        recoverySupabase: supabase,
        metadata: {
          booking_status: "scheduled",
          booking_id: bookingRecord?.id ?? null,
          booking_version: bookingVersion,
          quote_id: linkedQuoteId ?? null,
          source_session_id: sessionId,
          jobber_visit_id: jobberVisitId,
          appointment_date: booking.scheduledStart,
          arrival_window: null, // BluLadder does not currently expose an authoritative arrival window; safe empty
          service: serviceNames[0] ?? "your service",
          service_names: serviceNames,
          service_types: serviceNames,
          service_address: booking.customer?.address ?? "",
          booking_total: booking.total,
          manage_link: manageLink,
          reschedule_link: manageLink,
          cancel_link: manageLink,
        },
      });
    } catch (e) {
      console.warn("booking_completed emit failed:", e);
    }

    console.log("=== Booking creation completed successfully ===");

    return new Response(
      JSON.stringify(successPayload),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    } finally {
      // A provider mutation may have committed even when control exits through
      // an unexpected error. Keep that reservation in non-expiring `executing`
      // state until reconciliation; only pre-provider failures return capacity.
      if (!reservationSettled) {
        if (providerMutationAttempted) {
          console.error(
            "Leaving booking reservation protected after an unsettled provider mutation",
            reservationGroupId,
          );
        } else {
          const unprotected = await unprotectReservationAfterFailure(
            supabase,
            reservationGroupId!,
            "released",
          );
          if (!unprotected.ok) {
            console.error(
              "Failed to release pre-provider booking reservation",
              unprotected.reason,
            );
          }
        }
      }
    }

  } catch (error) {
    console.error("Booking creation failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return new Response(
      JSON.stringify({ 
        error: "Failed to create booking", 
        details: error instanceof Error ? error.message : String(error)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
