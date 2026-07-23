// ============================================================================
// bookingReadiness — the ONE authoritative, read-only answer to
// "Is this conversation ready to show live appointment availability?"
//
// Reuses (never duplicates):
//   * identityAnchor.readIdentityAnchor            — identity truth
//   * quoteSession.findOrCreateForConversation +
//     quoteSession.computeRequired                 — quote inputs completeness
//   * profile/propertyRepo                         — property authorization,
//                                                    profile, stale/conflict
//   * loadPricing + calculateQuote result cached on the session
//     (see draftTools.calculate_quote)             — pricing engine, duration,
//                                                    manual-review reasons
//   * scheduleFreshness.getMirrorFreshness         — schedule mirror truth
//
// PURE READ-ONLY. Never sends messages, holds slots, writes property facts,
// creates confirmations, or mutates the session. All authoritative IDs are
// resolved SERVER-SIDE from the conversation row and its linked records;
// callers pass only a conversation id.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { readIdentityAnchor } from "./identityAnchor.ts";
import {
  computeRequired,
  findByConversation,
  sessionInputsKey,
  type QuoteSession,
} from "./quoteSession.ts";
import {
  customerOwnsProperty,
  getPropertyProfile,
  type CurrentFact,
} from "./profile/propertyRepo.ts";
import { loadPricing } from "./loadPricing.ts";
import { getMirrorFreshness } from "./scheduleFreshness.ts";

type SB = any;

export type ReadinessStatus =
  | "ready"
  | "identity_blocked"
  | "property_blocked"
  | "quote_incomplete"
  | "pricing_blocked"
  | "manual_review"
  | "duration_blocked"
  | "schedule_blocked"
  | "system_blocked";

export type ReadinessNextAction =
  | "ask_for_email"
  | "select_property"
  | "collect_quote_inputs"
  | "recalculate_quote"
  | "send_for_manual_review"
  | "refresh_schedule"
  | "show_availability"
  | "staff_intervention";

export interface ReadinessBlocker {
  code: string;
  customer_safe_message: string;
  staff_message: string;
}

export interface BookingReadiness {
  ready: boolean;
  status: ReadinessStatus;
  identity: {
    status: "resolved" | "ambiguous" | "unresolved" | "unreadable";
    method: string | null;
    customer_id_present: boolean;
    confirmed_email_anchor: boolean;
    awaiting_email_disambiguation: boolean;
  };
  property: {
    selected: boolean;
    authorized: boolean;
    property_profile_present: boolean;
    reusable_facts_count: number;
    stale_facts: string[];
    conflicting_facts: string[];
  };
  quote: {
    quote_session_present: boolean;
    requested_services: string[];
    required_fields_complete: boolean;
    missing_fields: string[];
    canonical_total: number | null;
    pricing_version: string | null;
    pricing_current: boolean;
    inputs_key_present: boolean;
    inputs_current: boolean;
    manual_review_required: boolean;
    manual_review_reasons: string[];
  };
  duration: {
    resolved: boolean;
    minutes: number | null;
    source: string | null;
  };
  schedule: {
    readable: boolean;
    fresh: boolean;
    age_minutes: number | null;
    refresh_in_progress: boolean;
  };
  blockers: ReadinessBlocker[];
  next_action: ReadinessNextAction;
}

const CUSTOMER_SAFE_GENERIC =
  "Give me one moment to line up the right times for you.";

function classifyFacts(facts: CurrentFact[]): {
  reusable: number;
  stale: string[];
  conflicting: string[];
} {
  const stale: string[] = [];
  const conflicting: string[] = [];
  let reusable = 0;
  for (const f of facts) {
    if (
      f.verificationStatus === "conflicting" ||
      f.verificationStatus === "needs_review"
    ) {
      conflicting.push(f.factType);
    } else if (f.stale) {
      stale.push(f.factType);
    } else {
      reusable++;
    }
  }
  return { reusable, stale, conflicting };
}

function extractLastQuoteResult(session: QuoteSession | null): any {
  const f = (session?.fields ?? {}) as Record<string, unknown>;
  const r = (f as any).lastQuoteResult;
  return r && typeof r === "object" ? r : null;
}

export async function getBookingReadiness(
  supabase: SB,
  conversationId: string,
): Promise<BookingReadiness> {
  const identityAnchor = await readIdentityAnchor(supabase, conversationId);
  const identity = {
    status: identityAnchor.identity_status,
    method: identityAnchor.resolution_method,
    customer_id_present: !!identityAnchor.resolved_customer_id,
    confirmed_email_anchor: !!identityAnchor.confirmed_email_customer_id,
    awaiting_email_disambiguation: identityAnchor.awaiting_email_disambiguation,
  };

  // Conversation row (property_id + prospect contact for session lookup).
  let convo: any = null;
  try {
    const { data } = await supabase
      .from("chat_conversations")
      .select(
        "id, property_id, prospect_phone, prospect_email, quote_session_id",
      )
      .eq("id", conversationId)
      .maybeSingle();
    convo = data ?? null;
  } catch {
    convo = null;
  }

  const resolvedCustomerId = identityAnchor.resolved_customer_id;
  const propertyId: string | null = convo?.property_id ?? null;

  // Property authorization + profile — ONLY when identity is resolved.
  let propertySelected = !!propertyId;
  let propertyAuthorized = false;
  let propertyProfilePresent = false;
  let reusableCount = 0;
  let staleFacts: string[] = [];
  let conflictingFacts: string[] = [];
  if (propertyId && identityAnchor.identity_status === "resolved" && resolvedCustomerId) {
    propertyAuthorized = await customerOwnsProperty(
      supabase,
      resolvedCustomerId,
      propertyId,
    );
    if (propertyAuthorized) {
      const facts = await getPropertyProfile(supabase, propertyId);
      propertyProfilePresent = facts.length > 0;
      const cls = classifyFacts(facts);
      reusableCount = cls.reusable;
      staleFacts = cls.stale;
      conflictingFacts = cls.conflicting;
    }
  }

  // Quote session — STRICT read-only. Merely inspecting readiness must never
  // create or link a session. Absent session => quote_incomplete blocker.
  const session: QuoteSession | null = await findByConversation(
    supabase,
    conversationId,
  );

  const fields = session?.fields ?? {};
  const requestedServices: string[] = Array.isArray((fields as any).services)
    ? ((fields as any).services as string[])
    : [];
  const missing = session ? computeRequired(session.fields) : ["services"];
  const requiredComplete = missing.length === 0;

  const lastQuote = extractLastQuoteResult(session);
  const lastStatus: string | null = lastQuote?.status ?? null;
  const quotePricingVersion: string | null =
    lastQuote?.engineVersion ?? null;
  const quoteRuleVersion: number | null =
    typeof lastQuote?.ruleVersion === "number" ? lastQuote.ruleVersion : null;
  const manualReviewReasons: string[] = Array.isArray(
    lastQuote?.manualReviewReasons,
  )
    ? lastQuote.manualReviewReasons
    : [];
  const manualReviewRequired =
    lastStatus === "manual_review_required" || manualReviewReasons.length > 0;

  // ---- Authoritative inputs-freshness check --------------------------------
  // The cached lastQuoteResult must have been produced from the CURRENT
  // canonical session inputs. Any drift (address change, sqft change, service
  // toggle, roof severity, discount, promotion, etc.) invalidates the cached
  // total AND the cached duration. We route through the same
  // `sessionInputsKey` used when persisting the result — never a second hash.
  const storedInputsKey: string | null =
    typeof lastQuote?.inputsKey === "string" && lastQuote.inputsKey.length > 0
      ? lastQuote.inputsKey
      : null;
  const currentInputsKey: string | null = session
    ? sessionInputsKey(session.fields)
    : null;
  const inputsKeyPresent = storedInputsKey != null;
  const inputsCurrent =
    inputsKeyPresent &&
    currentInputsKey != null &&
    storedInputsKey === currentInputsKey;

  // Pricing engine liveness + version match. If we can't load pricing, we
  // treat the pricing rail as blocked (never guess).
  let pricingEngineOk = false;
  let liveRuleVersion: number | null = null;
  try {
    const loaded = await loadPricing(supabase);
    pricingEngineOk = !!loaded.ok && !!loaded.pricing;
    liveRuleVersion =
      typeof loaded.ruleVersion === "number" ? loaded.ruleVersion : null;
  } catch {
    pricingEngineOk = false;
  }
  const pricingCurrent =
    pricingEngineOk &&
    lastQuote != null &&
    quoteRuleVersion != null &&
    liveRuleVersion != null &&
    quoteRuleVersion === liveRuleVersion;

  // A cached quote is only trustworthy when EVERY signal aligns. Historical
  // totals (stale inputs, drifted rules, non-bookable status) must never leak
  // through to scheduling.
  const bookableStatus =
    lastStatus === "firm" || lastStatus === "estimated";
  const rawTotal: number | null =
    typeof lastQuote?.total === "number" ? lastQuote.total : null;
  const rawDuration: number | null =
    typeof lastQuote?.estimatedDurationMinutes === "number"
      ? lastQuote.estimatedDurationMinutes
      : null;
  const cachedQuoteTrustworthy =
    lastQuote != null &&
    inputsCurrent &&
    pricingCurrent &&
    bookableStatus &&
    rawTotal != null && rawTotal > 0 &&
    rawDuration != null && rawDuration > 0;

  const canonicalTotal: number | null = cachedQuoteTrustworthy ? rawTotal : null;
  const durationMinutes: number | null = cachedQuoteTrustworthy ? rawDuration : null;
  const durationResolved = durationMinutes != null && durationMinutes > 0;

  // Schedule mirror freshness (single shared reader).
  const mirror = await getMirrorFreshness(supabase);
  const scheduleReadable = mirror.reason !== "config_unavailable";
  const scheduleFresh = mirror.ok && mirror.reason === "fresh";

  // -------- Blocker + status precedence --------
  const blockers: ReadinessBlocker[] = [];
  let status: ReadinessStatus = "ready";

  // 1. system_blocked — cannot even read schedule mirror config.
  if (!scheduleReadable) {
    status = "system_blocked";
    blockers.push({
      code: "schedule_mirror_unreadable",
      customer_safe_message: CUSTOMER_SAFE_GENERIC,
      staff_message:
        "autosync_config not readable; getMirrorFreshness returned config_unavailable.",
    });
  }

  // 2. identity_blocked — scheduling requires a resolved identity anchor.
  if (status === "ready" && identityAnchor.identity_status !== "resolved") {
    status = "identity_blocked";
    blockers.push({
      code: `identity_${identityAnchor.identity_status}`,
      customer_safe_message:
        "Before I lock in a time, can I get the email on your account so I book the right one?",
      staff_message: `identity_status=${identityAnchor.identity_status} method=${identityAnchor.resolution_method ?? "none"} awaiting_email=${identityAnchor.awaiting_email_disambiguation}`,
    });
  }

  // 3. property_blocked — must have a property selected AND authorized.
  if (status === "ready" && (!propertySelected || !propertyAuthorized)) {
    status = "property_blocked";
    blockers.push({
      code: !propertySelected ? "no_property_selected" : "property_not_authorized",
      customer_safe_message:
        "Which address should I book this at? I want to make sure we're headed to the right property.",
      staff_message: !propertySelected
        ? "chat_conversations.property_id is null"
        : "resolved customer does not own the bound property",
    });
  }

  // 4. quote_incomplete — pricing engine can't be run without required inputs.
  if (status === "ready" && !requiredComplete) {
    status = "quote_incomplete";
    blockers.push({
      code: "quote_inputs_missing",
      customer_safe_message:
        "One more quick detail and I can lock this in.",
      staff_message: `missing quote inputs: ${missing.join(", ")}`,
    });
  }

  // 5. pricing_blocked — engine unavailable, no quote cached, or version drift.
  if (status === "ready") {
    const noQuoteCached = lastQuote == null;
    const pricingErrored = lastStatus === "error" || lastStatus === "pricing_unavailable";
    const inputsStale = lastQuote != null && !inputsCurrent;
    if (!pricingEngineOk || noQuoteCached || pricingErrored || !pricingCurrent || inputsStale) {
      status = "pricing_blocked";
      // Inputs-drift takes precedence over engine liveness/version drift when
      // a lastQuoteResult is cached — the cached total/duration are the actual
      // hazard we need to name for the AI, regardless of loader health.
      const code = noQuoteCached
        ? (!pricingEngineOk ? "pricing_engine_unavailable" : "no_canonical_quote")
        : pricingErrored
        ? "pricing_engine_error"
        : inputsStale
        ? (inputsKeyPresent ? "quote_inputs_changed" : "quote_inputs_unverified")
        : !pricingEngineOk
        ? "pricing_engine_unavailable"
        : "pricing_version_drift";
      blockers.push({
        code,
        customer_safe_message: CUSTOMER_SAFE_GENERIC,
        staff_message:
          `pricingEngineOk=${pricingEngineOk} lastStatus=${lastStatus ?? "none"} ` +
          `quoteRuleVersion=${quoteRuleVersion ?? "null"} liveRuleVersion=${liveRuleVersion ?? "null"} ` +
          `inputsKeyPresent=${inputsKeyPresent} inputsCurrent=${inputsCurrent}`,
      });
    }
  }

  // 6. manual_review — pricing engine flagged human review.
  if (status === "ready" && manualReviewRequired) {
    status = "manual_review";
    blockers.push({
      code: "manual_review_required",
      customer_safe_message:
        "I want to make sure we get this exactly right — I'll have our team follow up shortly.",
      staff_message: `manualReviewReasons: ${manualReviewReasons.join("; ") || "unspecified"}`,
    });
  }

  // 7. duration_blocked — no server-computed duration to size the slot.
  if (status === "ready" && !durationResolved) {
    status = "duration_blocked";
    blockers.push({
      code: "duration_missing",
      customer_safe_message: CUSTOMER_SAFE_GENERIC,
      staff_message:
        "pricing engine returned no estimatedDurationMinutes on the cached quote result.",
    });
  }

  // 8. schedule_blocked — mirror stale, never completed, or refresh in-flight.
  if (status === "ready" && !scheduleFresh) {
    status = "schedule_blocked";
    blockers.push({
      code: `schedule_${mirror.reason}`,
      customer_safe_message:
        "Live scheduling is refreshing — one moment while I pull today's availability.",
      staff_message: `mirror.reason=${mirror.reason} ageMinutes=${mirror.ageMinutes ?? "null"} syncInProgress=${mirror.syncInProgress}`,
    });
  }

  const ready = status === "ready";

  const nextActionMap: Record<ReadinessStatus, ReadinessNextAction> = {
    ready: "show_availability",
    identity_blocked: "ask_for_email",
    property_blocked: "select_property",
    quote_incomplete: "collect_quote_inputs",
    pricing_blocked: "staff_intervention",
    manual_review: "send_for_manual_review",
    duration_blocked: "staff_intervention",
    schedule_blocked: "refresh_schedule",
    system_blocked: "staff_intervention",
  };

  // Route pricing_blocked to a concrete recovery action for the two
  // inputs-drift cases: recollect if fields are incomplete, otherwise a safe
  // recalculation via the existing `calculate_quote` tool. All other
  // pricing_blocked reasons remain staff_intervention.
  let nextAction: ReadinessNextAction = nextActionMap[status];
  if (status === "pricing_blocked" && lastQuote != null && !inputsCurrent) {
    nextAction = requiredComplete ? "recalculate_quote" : "collect_quote_inputs";
  }

  return {
    ready,
    status,
    identity,
    property: {
      selected: propertySelected,
      authorized: propertyAuthorized,
      property_profile_present: propertyProfilePresent,
      reusable_facts_count: reusableCount,
      stale_facts: staleFacts,
      conflicting_facts: conflictingFacts,
    },
    quote: {
      quote_session_present: !!session,
      requested_services: requestedServices,
      required_fields_complete: requiredComplete,
      missing_fields: missing,
      canonical_total: canonicalTotal,
      pricing_version: quotePricingVersion,
      pricing_current: pricingCurrent,
      inputs_key_present: inputsKeyPresent,
      inputs_current: inputsCurrent,
      manual_review_required: manualReviewRequired,
      manual_review_reasons: manualReviewReasons,
    },
    duration: {
      resolved: durationResolved,
      minutes: durationMinutes,
      source: durationResolved ? "pricing_engine" : null,
    },
    schedule: {
      readable: scheduleReadable,
      fresh: scheduleFresh,
      age_minutes: mirror.ageMinutes,
      refresh_in_progress: mirror.syncInProgress,
    },
    blockers,
    next_action: nextAction,
  };
}