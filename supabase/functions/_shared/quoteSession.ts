// ============================================================================
// quoteSession.ts — Canonical Progressive Quote Session (Phase 4C-β.4)
//
// A single structured object that voice, web, SMS, and future channels edit
// incrementally. The conversation is a natural-language interface; the
// Quote Session is the authoritative record of what the customer has told us
// so far. Pure helpers (mergeFields, computeRequired, nextQuestion) are unit-
// testable without a database. Persistence is isolated in the SB helpers.
// ============================================================================

import type { ConversationFacts } from "./conversationState.ts";
import { normalizeUsCaE164, resolvePhone } from "./contactIntegrity.ts";
import {
  type AnswerProvenance,
  CANONICAL_INTAKE_FIELDS,
  evaluateQuoteIntake,
  normalizeWindowCleaningSides,
} from "./salesEngine/quoteIntakeContract.ts";
import { resolveAuthoritativeDuration } from "./salesEngine/durationContract.ts";
import { deterministicUuid } from "./deterministicUuid.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type QuoteSessionChannel = "voice" | "web" | "sms" | "chat";
export type FieldStatus =
  | "unknown"
  | "captured"
  | "verified"
  | "corrected"
  | "derived"
  | "defaulted"
  | "unanswered";

export interface QuoteSessionFields {
  services?: string[];
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  squareFootage?: number;
  stories?: number;
  windowCleaningType?: string;
  condition?: string;
  roofType?: string;
  roofSeverity?: string;
  roofRiskFlags?: {
    knownDamage: boolean;
    extremePitch: boolean;
    fragileMaterial: boolean;
    unusualAccess: boolean;
  };
  drivewaySqft?: number;
  drivewaySurface?: string;
  pressureWashSqft?: number;
  pressureWashSurface?: string;
  promotionId?: string | null;
  discountCode?: string | null;
  // Phase 4C-β.4A — window-scope classification
  customerType?: "residential" | "commercial" | "unknown";
  windowCleaningScope?:
    | "whole_home"
    | "partial"
    | "commercial_custom"
    | "unknown";
  windowCleaningSides?: "outside_only" | "inside_and_outside";
  screenProfile?:
    | "standard_removable"
    | "no_screens"
    | "solar"
    | "mixed_standard_solar"
    | "fixed_nonremovable_or_unknown";
  /** Derived from fieldStatus.screenProfile; callers cannot assert this independently. */
  screenProfileProvenance?: FieldStatus;
  advancedWindowConditions?: boolean;
  hardWaterStains?: boolean;
  hardWaterAffectedWindowEquivalents?: number;
  frenchPanes?: boolean;
  ladderWork?: boolean;
  ladderAffectedWindowEquivalents?: number;
  addedInteriorWindowSides?: number;
  omittedWindowSides?: number | "unknown";
  solarScreenCoverage?: "all" | "some";
  solarScreenAffectedWindowCount?: number;
  solarScreenServiceRequested?: boolean;
  enclosedPatioProfile?:
    | "none"
    | "screened"
    | "window_enclosed"
    | "mixed_or_uncertain";
  screenedEnclosureSoftWash?: boolean;
  enclosureWindowCount?: number;
  enclosureWindowSides?: "outside_only" | "inside_and_outside";
  windowCount?: number;
  partialAreas?: string[];
  partialAccessNotes?: string;
  partialWindowPrice?: number;
  partialWindowRuleVersion?: string;
  commercialPropertyType?: string;
  commercialLocations?: Array<{
    address?: string;
    propertyType?: string;
    windowsEstimate?: number;
    stories?: number;
    sides?: "outside_only" | "inside_and_outside";
    frequency?: string;
    accessNotes?: string;
    notes?: string;
  }>;
  commercialFrequency?: string;
  commercialScopeNotes?: string;
  preferredContactMethods?: Array<"text" | "email" | "phone">;
  houseWashStainType?: "organic" | "rust";
  gutterAddons?: {
    undergroundDrains?: { enabled: boolean; count?: number | string };
    minorRepairs?: boolean;
    repairNeeds?: string[];
    repairNotes?: string;
    gutterGuards?: { enabled: boolean; linearFeet?: number };
  };
  houseWashPatios?: {
    pricingMethod?: "simple_selection" | "exact_square_footage";
    frontSelected?: boolean;
    backSelected?: boolean;
    frontSqft?: number;
    backSqft?: number;
  };
  pressureWashingAreas?: Partial<
    Record<"frontPorch" | "backPatio" | "poolDeck" | "walkways", {
      enabled: boolean;
      sqft?: number;
      surfaceType?: string;
    }>
  >;
  solarPanelCount?: number;
  solarAccessProfile?: {
    stories: 1 | 2 | 3;
    accessType: "standard_residential" | "unusual_or_uncertain";
    knownDamage: boolean;
    extremePitch: boolean;
    fragileMaterial: boolean;
    unusualAccess: boolean;
  };
  screenRepairCount?: number;
  screenRepairScopeType?:
    | "standard_removable_reusable_frame"
    | "screen_door"
    | "new_frame"
    | "damaged_frame"
    | "solar_screen"
    | "specialty_or_oversized"
    | "unknown";
  serviceAreaStatus?:
    | "eligible"
    | "pending_confirmation"
    | "manual_review_required"
    | "ineligible"
    | "ambiguous"
    | "unavailable";
  /** Canonical geocoder result. Voice may persist an eligible candidate only
   * as pending_confirmation until the caller approves the final readback. */
  serviceAreaResult?: Record<string, unknown> | null;
  /** Independently retained address components for bounded correction. */
  addressComponents?: {
    house_number?: string;
    street?: string;
    unit?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  } | null;
  answerProvenance?: Record<string, AnswerProvenance>;
  confirmationSummary?: {
    confirmed: boolean;
    confirmedFieldIds: string[];
    confirmedAt?: string;
  };
  humanPricingRequired?: boolean;
  bidRequestStatus?:
    | "commercial_bid_requested"
    | "human_pricing_required"
    | "scope_collection_complete"
    | "awaiting_ben_review";
  // ---- Workflow controller rollout state (Phase 4C-β.6) ----
  // Persisted opaquely on quote_sessions.fields. Never exposed to the caller.
  callerIdConfirmationStatus?:
    | "pending"
    | "manual_pending"
    | "confirmed"
    | "contact_confirmed"
    | "declined";
  callerIdProposedE164?: string;
  returningCustomerId?: string;
  returningCustomerResolved?: boolean;
  awaitingDisambiguator?: boolean;
  lastQuoteResult?: {
    status?: string;
    estimatedDurationMinutes?: number | null;
    durationSource?: string | null;
    durationVersion?: string | null;
    [key: string]: unknown;
  };
  /**
   * Channel-neutral continuation state for the deterministic customer journey.
   * It lives in the existing quote-session JSONB extension point so no schema
   * migration or parallel voice-only record is required.
   */
  voiceJourney?: {
    /** Declarative conversational policy version used for this session. */
    policyVersion?: string;
    retryCounts?: Record<string, number>;
    conditionalModifierQuestionAsked?: string;
    volunteeredNotes?: string[];
    requestedNextStep?: "text_quote" | "schedule" | "none";
    coupon?: {
      code: string;
      status: "captured" | "valid" | "invalid" | "unclear";
      reason?: string | null;
      discountType?: "percentage" | "fixed" | null;
      discountValue?: number | null;
      authoritativeAmount?: number | null;
    } | null;
    intent?:
      | "new_quote"
      | "schedule"
      | "existing_quote"
      | "reschedule"
      | "cancel"
      | "question_or_memo";
    quoteContext?: {
      inputsKey: string;
      quoteId?: string | null;
      pricingVersion?: number | string | null;
      engineVersion?: string | null;
      taxPolicyVersion?: string | null;
      durationVersion?: string | null;
      engineStatus?: string | null;
      productPolicyStatus?:
        | "approved"
        | "manual_review_required"
        | "owner_decision_required";
      channelEligibility?:
        | "eligible"
        | "ineligible"
        | "owner_decision_required";
      finalQuoteDisposition?:
        | "firm"
        | "estimated"
        | "incomplete"
        | "manual_review"
        | "owner_decision_required"
        | "error";
      serviceSubtotal?: number | null;
      estimatedTax?: number | null;
      estimatedTotal?: number | null;
      authoritativeDurationMinutes?: number | null;
      durationSource?: string | null;
      /** Set only after the current canonical total has actually been spoken. */
      spokenAt?: string | null;
      acceptedAt?: string | null;
    } | null;
    delivery?: {
      channel: "sms" | "email";
      mode?: "actual_quote" | "generic_fallback";
      status:
        | "not_requested"
        | "pending"
        | "queued"
        | "provider_accepted"
        | "delivered"
        | "retry_pending"
        | "uncertain"
        | "failed_terminal";
      attemptId?: string | null;
      providerMessageId?: string | null;
      requestedAt?: string | null;
    } | null;
    availability?: {
      status:
        | "not_requested"
        | "refresh_required"
        | "provider_unavailable"
        | "readiness_blocked"
        | "policy_blocked"
        | "preference_required"
        | "engine_error"
        | "no_slots"
        | "offered";
      forBookingKey?: string | null;
      offerVersion?: string | null;
      expiresAt?: string | null;
      offeredSlotIds?: string[];
      selectedSlotId?: string | null;
      offeredSlots?: Array<{
        slotId: string;
        startAt: string;
        endAt: string;
        label: string;
        timezone?: string;
      }>;
      /** Truthful readiness/provider result preserved from the canonical
       * availability boundary. Never collapsed to provider_unavailable. */
      readinessBlockers?: Array<{
        code: string;
        category?: string | null;
        detail?: string | null;
      }>;
      nextAction?: string | null;
      failureCategory?: string | null;
      safeDetail?: string | null;
      providerContacted?: boolean;
    } | null;
    booking?: {
      status:
        | "not_started"
        | "confirmation_required"
        | "submitting"
        | "confirmed"
        | "recovery_pending"
        | "failed";
      bookingId?: string | null;
      referenceNumber?: string | null;
      idempotencyKey?: string | null;
    } | null;
    existingRecord?: {
      kind: "quote" | "booking";
      id: string;
      identityVerified: boolean;
      ownershipVerified: boolean;
    } | null;
    pendingAddressComponent?:
      | "house_number"
      | "street"
      | "unit"
      | "city"
      | "state"
      | "postal_code"
      | null;
  };
}

export interface QuoteSession {
  id: string;
  organizationId?: string | null;
  channel: QuoteSessionChannel;
  conversationIds: string[];
  customerId?: string | null;
  propertyId?: string | null;
  quoteId?: string | null;
  fields: QuoteSessionFields;
  fieldStatus: Partial<Record<keyof QuoteSessionFields, FieldStatus>>;
  requiredRemaining: string[];
  lastStep?: string | null;
  quoteStatus: "none" | "estimated" | "firm" | "manual_review" | "error";
  bookingReady: boolean;
  phoneE164?: string | null;
  emailNormalized?: string | null;
  /** Optimistic-concurrency token from quote_sessions.updated_at. */
  updatedAt?: string | null;
}

function deleteStoragePath(
  target: Record<string, unknown>,
  storagePath: string,
): void {
  const keys = storagePath.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    const nested = current[key];
    if (!nested || typeof nested !== "object") return;
    // mergeFields starts with a shallow copy of the session. Clone every
    // traversed container before deleting a service-owned nested value so the
    // previous session remains an immutable history snapshot.
    const cloned = Array.isArray(nested)
      ? [...nested]
      : { ...(nested as Record<string, unknown>) };
    current[key] = cloned;
    current = cloned as Record<string, unknown>;
  }
  delete current[keys[keys.length - 1]];
}

/** Merge a patch of fields; track status transitions.
 *  unknown -> captured (first non-empty value)
 *  captured -> corrected (value changed after capture)
 *  markVerified/markDerived override to those statuses. */
export function mergeFields(
  prev: QuoteSession,
  patch: Partial<QuoteSessionFields>,
  opts: {
    markVerified?: (keyof QuoteSessionFields)[];
    markDerived?: (keyof QuoteSessionFields)[];
    markDefaulted?: (keyof QuoteSessionFields)[];
    markCustomerEstimate?: (keyof QuoteSessionFields)[];
    markConfirmedSummary?: (keyof QuoteSessionFields)[];
  } = {},
): QuoteSession {
  const beforePriceKey = sessionInputsKey(prev.fields);
  const beforeBookingKey = sessionBookingInputsKey(prev.fields);
  const nextFields: QuoteSessionFields = { ...prev.fields };
  const nextStatus = { ...prev.fieldStatus };
  const nextProvenance: Record<string, AnswerProvenance> = {
    ...(prev.fields.answerProvenance ?? {}),
  };
  const phoneIsConfirmed = prev.fieldStatus.phone === "verified" ||
    prev.fields.callerIdConfirmationStatus === "confirmed" ||
    prev.fields.callerIdConfirmationStatus === "contact_confirmed";
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const key = k as keyof QuoteSessionFields;
    if (key === "screenProfileProvenance") continue;
    // Canonical writable field: accept the legacy field only at this boundary,
    // normalize it, and persist windowCleaningSides. Never write both.
    if (key === "windowCleaningType") {
      const sides = normalizeWindowCleaningSides(v);
      if (!sides) continue;
      const previous = nextFields.windowCleaningSides;
      nextFields.windowCleaningSides = sides;
      nextStatus.windowCleaningSides = previous && previous !== sides
        ? "corrected"
        : "captured";
      nextProvenance.windowCleaningSides = "explicitly_selected";
      continue;
    }
    const prevVal = (prev.fields as Record<string, unknown>)[key];
    const isEmpty = v === null || v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty && key !== "services") continue;
    // Contact integrity: a phone patch must be a valid full NANP E.164, and a
    // confirmed caller ID can never be overwritten by a lower-provenance
    // extraction (regression guard for the "+0144" corruption).
    if (key === "phone") {
      const resolved = resolvePhone({
        existing: prev.fields.phone,
        existingConfirmed: phoneIsConfirmed,
        candidate: typeof v === "string" ? v : null,
        candidateConfirmed: (opts.markVerified ?? []).includes("phone"),
      });
      if (!resolved || resolved === prev.fields.phone) continue;
      nextFields.phone = resolved;
      nextStatus.phone = prev.fields.phone ? "corrected" : "captured";
      continue;
    }
    (nextFields as Record<string, unknown>)[key] = v;
    const wasCaptured = nextStatus[key] === "captured" ||
      nextStatus[key] === "verified";
    const changed = prevVal !== undefined &&
      JSON.stringify(prevVal) !== JSON.stringify(v);
    nextStatus[key] = wasCaptured && changed ? "corrected" : "captured";
    if (key !== "answerProvenance" && key !== "confirmationSummary") {
      nextProvenance[key] = "explicitly_selected";
    }
  }

  // A removed service must not resurrect its old answers if it is selected
  // again later. Clear only storage paths that no retained service uses; shared
  // property facts such as square footage/stories survive a window + house
  // wash quote becoming house-wash-only.
  if (Object.prototype.hasOwnProperty.call(patch, "services")) {
    const previousServices = evaluateQuoteIntake(
      prev.fields as unknown as Record<string, unknown>,
    ).services;
    const retainedServices = evaluateQuoteIntake(
      nextFields as unknown as Record<string, unknown>,
    ).services;
    const removed = previousServices.filter((service) =>
      !retainedServices.includes(service)
    );
    if (removed.length > 0) {
      const retainedPaths = new Set(
        CANONICAL_INTAKE_FIELDS
          .filter((spec) =>
            spec.appliesToServices.some((service) =>
              retainedServices.includes(service)
            )
          )
          .map((spec) => spec.storagePath),
      );
      const retainedRoots = new Set(
        [...retainedPaths].map((path) => path.split(".")[0]),
      );
      for (const spec of CANONICAL_INTAKE_FIELDS) {
        if (
          spec.storagePath === "services" ||
          retainedPaths.has(spec.storagePath) ||
          !spec.appliesToServices.some((service) => removed.includes(service))
        ) continue;
        const root = spec.storagePath.split(".")[0];
        // If the retained services do not use this container at all, remove
        // the complete root. This also clears backward-compatible legacy
        // members that are intentionally absent from the canonical contract.
        deleteStoragePath(
          nextFields as unknown as Record<string, unknown>,
          retainedRoots.has(root) ? spec.storagePath : root,
        );
        delete nextProvenance[spec.fieldId];
        delete nextStatus[root as keyof QuoteSessionFields];
      }
    }
  }
  for (const k of opts.markVerified ?? []) {
    nextStatus[k] = "verified";
    nextProvenance[k] = "verified_lookup";
  }
  for (const k of opts.markDerived ?? []) {
    nextStatus[k] = "derived";
    nextProvenance[k] = "verified_lookup";
  }
  for (const k of opts.markDefaulted ?? []) {
    nextStatus[k] = "defaulted";
    nextProvenance[k] = "approved_business_default";
  }
  for (const k of opts.markCustomerEstimate ?? []) {
    nextProvenance[k] = "customer_estimate";
  }
  for (const k of opts.markConfirmedSummary ?? []) {
    nextProvenance[k] = "confirmed_summary";
  }
  nextFields.answerProvenance = nextProvenance;
  // Backward-compatible sessions may have a screen profile but no provenance.
  // Do not synthesize "unknown" during an unrelated contact/address update;
  // that would invalidate an otherwise current quote. Populate provenance only
  // when this merge actually captures/corrects the screen profile, or when the
  // persisted record already participates in the provenance contract.
  if (
    nextFields.screenProfile &&
    (Object.prototype.hasOwnProperty.call(patch, "screenProfile") ||
      nextFields.screenProfileProvenance != null)
  ) {
    nextFields.screenProfileProvenance = nextStatus.screenProfile ?? "unknown";
  }
  const priceChanged = beforePriceKey !== sessionInputsKey(nextFields);
  const bookingChanged =
    beforeBookingKey !== sessionBookingInputsKey(nextFields);
  if (priceChanged) {
    delete nextFields.lastQuoteResult;
    if (nextFields.voiceJourney) {
      nextFields.voiceJourney = {
        ...nextFields.voiceJourney,
        requestedNextStep: "none",
        quoteContext: null,
        delivery: null,
        availability: null,
        booking: { status: "not_started" },
      };
    }
  } else if (bookingChanged && nextFields.voiceJourney) {
    nextFields.voiceJourney = {
      ...nextFields.voiceJourney,
      availability: null,
      booking: { status: "not_started" },
    };
  }
  return {
    ...prev,
    fields: nextFields,
    fieldStatus: nextStatus,
    quoteStatus: priceChanged ? "none" : prev.quoteStatus,
    bookingReady: priceChanged || bookingChanged ? false : prev.bookingReady,
    lastStep: priceChanged ? null : prev.lastStep,
  };
}

// Fields whose validity depends on WHOLE-HOME pricing (sqft-based engine).
// A scope flip whole_home ↔ partial must invalidate ONLY these; address,
// contact, notes, and conversation history are preserved.
const WHOLE_HOME_PRICING_FIELDS: (keyof QuoteSessionFields)[] = [
  "squareFootage",
  "windowCleaningSides",
];
const PARTIAL_PRICING_FIELDS: (keyof QuoteSessionFields)[] = [
  "windowCount",
  "partialAreas",
  "partialAccessNotes",
  "partialWindowPrice",
  "partialWindowRuleVersion",
];

/** Apply a scope change while preserving unrelated captured facts. Invalidates
 *  ONLY the fields whose meaning depends on the previous scope's pricing. */
export function changeWindowScope(
  prev: QuoteSession,
  nextScope: NonNullable<QuoteSessionFields["windowCleaningScope"]>,
): QuoteSession {
  const currentScope = prev.fields.windowCleaningScope;
  if (currentScope === nextScope) return prev;
  const nextFields: QuoteSessionFields = { ...prev.fields };
  const nextStatus = { ...prev.fieldStatus };
  const invalidate = (keys: (keyof QuoteSessionFields)[]) => {
    for (const k of keys) {
      delete (nextFields as Record<string, unknown>)[k];
      delete nextStatus[k];
    }
  };
  if (currentScope === "whole_home" && nextScope === "partial") {
    invalidate(WHOLE_HOME_PRICING_FIELDS);
  }
  if (currentScope === "partial" && nextScope === "whole_home") {
    invalidate(PARTIAL_PRICING_FIELDS);
  }
  nextFields.windowCleaningScope = nextScope;
  nextStatus.windowCleaningScope = "captured";
  delete nextFields.lastQuoteResult;
  if (nextFields.voiceJourney) {
    nextFields.voiceJourney = {
      ...nextFields.voiceJourney,
      quoteContext: null,
      delivery: null,
      availability: null,
      booking: { status: "not_started" },
    };
  }
  return {
    ...prev,
    fields: nextFields,
    fieldStatus: nextStatus,
    quoteStatus: "none",
    bookingReady: false,
    lastStep: null,
  };
}

/** Merge one commercial location into the array without flattening existing
 *  locations to a note. Locations are matched by normalized address. */
export function addCommercialLocation(
  prev: QuoteSession,
  loc: NonNullable<QuoteSessionFields["commercialLocations"]>[number],
): QuoteSession {
  const list = [...(prev.fields.commercialLocations ?? [])];
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const idx = list.findIndex((x) =>
    norm(x.address) && norm(x.address) === norm(loc.address)
  );
  if (idx >= 0) list[idx] = { ...list[idx], ...loc };
  else list.push(loc);
  return mergeFields(prev, { commercialLocations: list });
}

/** Which fields are still required for canonical pricing of the CURRENT
 *  selected services. Mirrors the pricing engine's declared inputs; does NOT
 *  introduce new pricing rules. */
export function computeRequired(fields: QuoteSessionFields): string[] {
  const evaluation = evaluateQuoteIntake(
    fields as unknown as Record<string, unknown>,
  );
  const missing = [
    ...evaluation.requiredToPrice,
    ...evaluation.productPolicyRequired,
  ];
  if (
    evaluation.services.includes("commercial_window_bid") &&
    !(fields.preferredContactMethods?.length)
  ) {
    missing.push("preferredContactMethods");
  }
  return [...new Set(missing)];
}

export function isReadyToPrice(fields: QuoteSessionFields): boolean {
  return computeRequired(fields).length === 0;
}

export function isReadyToBook(session: QuoteSession): boolean {
  const f = session.fields;
  const intake = evaluateQuoteIntake(f as unknown as Record<string, unknown>);
  const duration = resolveAuthoritativeDuration(f.lastQuoteResult ?? null);
  const mixedReviewBookable = session.quoteStatus === "manual_review" &&
    Array.isArray(f.lastQuoteResult?.bookableServiceKeys) &&
    f.lastQuoteResult.bookableServiceKeys.length > 0;
  return (
    (session.quoteStatus === "firm" || session.quoteStatus === "estimated" ||
      mixedReviewBookable) &&
    computeRequired(f).length === 0 &&
    intake.ownerDecisions.length === 0 &&
    (intake.manualReview.length === 0 || mixedReviewBookable) &&
    intake.bookingRequired.length === 0 &&
    duration.status === "available" &&
    !!f.address &&
    !!f.email
  );
}

const QUESTION_PRIORITY: string[] = [
  "services",
  "windowCleaningScope",
  "windowCount",
  "commercialLocations",
  "preferredContactMethods",
  "squareFootage",
  "stories",
  "windowCleaningSides",
  "condition",
  "advancedWindowConditions",
  "hardWaterAffectedWindowEquivalents",
  "ladderAffectedWindowEquivalents",
  "addedInteriorWindowSides",
  "omittedWindowSides",
  "screenProfile",
  "solarScreenCoverage",
  "solarScreenAffectedWindowCount",
  "enclosedPatioProfile",
  "enclosureWindowCount",
  "enclosureWindowSides",
  "hardWaterPercent",
  "frenchPanesPercent",
  "ladderWorkCount",
  "houseWashPatioPricingMethod",
  "houseWashFrontPatioSqft",
  "houseWashBackPatioSqft",
  "gutterUndergroundDrainCount",
  "gutterGuardsLinearFeet",
  "drivewaySqft",
  "drivewaySurface",
  "pressureWashingSurface",
  "pressureWashSqft",
  "pressureWashingAreas",
  "solarPanelCount",
  "solarAccessProfile",
  "screenRepairCount",
  "screenRepairScopeType",
  "serviceAreaStatus",
  "city",
  "address",
  "name",
  "email",
  "phone",
];

export interface NextQuestionPlan {
  readyToPrice: boolean;
  readyToBook: boolean;
  missing: string[];
  nextField: string | null;
}

export function nextQuestion(session: QuoteSession): NextQuestionPlan {
  const missing = computeRequired(session.fields);
  const readyToPrice = missing.length === 0;
  const readyToBook = isReadyToBook(session);
  let nextField: string | null = null;
  for (const key of QUESTION_PRIORITY) {
    if (missing.includes(key)) {
      nextField = key;
      break;
    }
  }
  // The contract owns requirement discovery. The priority list only controls
  // presentation order, so an added contract field must never dead-end a
  // channel while readyToPrice is false.
  if (!nextField && missing.length > 0) nextField = missing[0];
  return { readyToPrice, readyToBook, missing, nextField };
}

export function fieldsFromFacts(facts: ConversationFacts): QuoteSessionFields {
  const p = facts.property ?? {};
  const c = facts.contact ?? {};
  return {
    services: facts.services,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: facts.address,
    squareFootage: p.squareFootage,
    stories: p.stories,
    windowCleaningSides: normalizeWindowCleaningSides(p.windowCleaningType) ??
      undefined,
    condition: p.condition,
    roofType: p.roofType,
    roofSeverity: p.roofSeverity,
    drivewaySqft: p.drivewaySqft,
    drivewaySurface: p.drivewaySurface,
    pressureWashSqft: p.pressureWashSqft,
    pressureWashSurface: p.pressureWashSurface,
    promotionId: facts.promotionId ?? null,
    discountCode: facts.discountCode ?? null,
    city: facts.roughQuote?.city,
  };
}

export function quoteStatusFromFacts(
  facts: ConversationFacts,
): QuoteSession["quoteStatus"] {
  const s = facts.quote?.status;
  if (s === "firm") return "firm";
  if (s === "estimated") return "estimated";
  if (s === "manual_review_required") return "manual_review";
  if (s === "error" || s === "pricing_unavailable") return "error";
  return "none";
}

function rowToSession(row: Record<string, unknown>): QuoteSession {
  return {
    id: row.id as string,
    organizationId: (row.organization_id as string | null) ?? null,
    channel: row.channel as QuoteSessionChannel,
    conversationIds: (row.conversation_ids as string[]) ?? [],
    customerId: (row.customer_id as string | null) ?? null,
    propertyId: (row.property_id as string | null) ?? null,
    quoteId: (row.quote_id as string | null) ?? null,
    fields: (row.fields as QuoteSessionFields) ?? {},
    fieldStatus: (row.field_status as QuoteSession["fieldStatus"]) ?? {},
    requiredRemaining: (row.required_remaining as string[]) ?? [],
    lastStep: (row.last_step as string | null) ?? null,
    quoteStatus: (row.quote_status as QuoteSession["quoteStatus"]) ?? "none",
    bookingReady: !!row.booking_ready,
    phoneE164: (row.phone_e164 as string | null) ?? null,
    emailNormalized: (row.email_normalized as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  return email.trim().toLowerCase() || null;
}
export function normalizePhone(phone?: string | null): string | null {
  // Strict: only valid US/Canada E.164 candidates are accepted. Short values
  // such as "0144" (last four digits echoed back from a confirmation prompt)
  // are rejected instead of being fabricated into "+0144".
  return normalizeUsCaE164(phone);
}

/** Find an existing session for this conversation, or (outside voice) a
 *  matching one across channels by verified phone/email; otherwise create.
 *  Voice never treats ANI/email alone as proof that a prior quote belongs to
 *  the caller. */
export async function findOrCreateForConversation(
  supabase: SB,
  args: {
    conversationId: string;
    channel: QuoteSessionChannel;
    phone?: string | null;
    email?: string | null;
    resolvedOrganizationId?: string | null;
  },
): Promise<QuoteSession> {
  const { conversationId, channel } = args;
  const organizationId = args.resolvedOrganizationId ?? null;
  if (channel === "voice" && !organizationId) {
    throw new Error("voice_organization_authority_required");
  }

  let conversationQuery = supabase
    .from("chat_conversations")
    .select("id, quote_session_id, organization_id")
    .eq("id", conversationId);
  conversationQuery = organizationId
    ? conversationQuery.eq("organization_id", organizationId)
    : conversationQuery.is("organization_id", null);
  const conv = await conversationQuery.maybeSingle();
  if (conv?.error || !conv?.data) {
    throw new Error("quote_session_conversation_unavailable");
  }
  const existingId: string | null = conv.data.quote_session_id ?? null;
  if (existingId) {
    let existingQuery = supabase.from("quote_sessions").select("*").eq(
      "id",
      existingId,
    );
    existingQuery = organizationId
      ? existingQuery.eq("organization_id", organizationId)
      : existingQuery.is("organization_id", null);
    const { data, error } = await existingQuery.maybeSingle();
    if (error || !data) {
      // A conversation with a stale or cross-organization session pointer is
      // an authority failure. Never hide it by creating a replacement row.
      throw new Error("quote_session_lineage_unavailable");
    }
    if (data) return rowToSession(data);
  }

  const phoneE164 = normalizePhone(args.phone);
  const emailNormalized = normalizeEmail(args.email);
  // Phone/email are identity selectors, never tenant authority. Voice cannot
  // reuse a prior quote session from either value without a separate verified
  // identity capability, which this API deliberately does not accept.
  if (channel !== "voice" && organizationId && (phoneE164 || emailNormalized)) {
    let q = supabase.from("quote_sessions").select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false }).limit(1);
    if (phoneE164) q = q.eq("phone_e164", phoneE164);
    else if (emailNormalized) q = q.eq("email_normalized", emailNormalized);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error("quote_session_lookup_failed");
    if (data) {
      const session = rowToSession(data);
      const nextIds = Array.from(
        new Set([...(session.conversationIds ?? []), conversationId]),
      );
      const sessionLink = await supabase.from("quote_sessions")
        .update({ conversation_ids: nextIds })
        .eq("id", session.id)
        .eq("organization_id", organizationId)
        .select("id")
        .maybeSingle();
      if (sessionLink?.error || !sessionLink?.data) {
        throw new Error("quote_session_link_failed");
      }
      const conversationLink = await supabase.from("chat_conversations")
        .update({ quote_session_id: session.id })
        .eq("id", conversationId)
        .eq("organization_id", organizationId)
        .select("id")
        .maybeSingle();
      if (conversationLink?.error || !conversationLink?.data) {
        throw new Error("quote_session_conversation_link_failed");
      }
      return { ...session, conversationIds: nextIds };
    }
  }

  const deterministicSessionId = organizationId
    ? await deterministicUuid(
      "quote-session",
      organizationId,
      conversationId,
    )
    : null;
  const insert = {
    ...(deterministicSessionId ? { id: deterministicSessionId } : {}),
    channel,
    conversation_ids: [conversationId],
    phone_e164: phoneE164,
    email_normalized: emailNormalized,
    organization_id: organizationId,
  } as Record<string, unknown>;
  const { data: insertedSession, error: createError } = await supabase
    .from("quote_sessions")
    .insert(insert)
    .select("*")
    .single();
  let created = insertedSession;
  const createdByThisAttempt = !createError && !!insertedSession;
  if (createError && deterministicSessionId && organizationId) {
    const reread = await supabase.from("quote_sessions").select("*")
      .eq("id", deterministicSessionId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!reread?.error) created = reread?.data ?? null;
  }
  if (
    !created || (created.organization_id ?? null) !== organizationId ||
    (deterministicSessionId && created.id !== deterministicSessionId) ||
    !Array.isArray(created.conversation_ids) ||
    !created.conversation_ids.includes(conversationId)
  ) {
    throw new Error("quote_session_create_failed");
  }
  let conversationUpdate = supabase.from("chat_conversations").update({
    quote_session_id: created.id,
  }).eq("id", conversationId);
  conversationUpdate = organizationId
    ? conversationUpdate.eq("organization_id", organizationId)
    : conversationUpdate.is("organization_id", null);
  conversationUpdate = conversationUpdate.is("quote_session_id", null);
  const conversationLink = await conversationUpdate
    .select("id, quote_session_id")
    .maybeSingle();
  if (conversationLink?.error) {
    throw new Error("quote_session_conversation_link_failed");
  }
  if (!conversationLink?.data) {
    let winnerQuery = supabase.from("chat_conversations")
      .select("quote_session_id, organization_id")
      .eq("id", conversationId);
    winnerQuery = organizationId
      ? winnerQuery.eq("organization_id", organizationId)
      : winnerQuery.is("organization_id", null);
    const winnerConversation = await winnerQuery.maybeSingle();
    const winnerId = winnerConversation?.data?.quote_session_id ?? null;
    if (winnerConversation?.error || !winnerId) {
      throw new Error("quote_session_conversation_link_failed");
    }
    if (winnerId !== created.id) {
      if (createdByThisAttempt) {
        let cleanup = supabase.from("quote_sessions").delete().eq(
          "id",
          created.id,
        );
        cleanup = organizationId
          ? cleanup.eq("organization_id", organizationId)
          : cleanup.is("organization_id", null);
        await cleanup;
      }
      let winnerSessionQuery = supabase.from("quote_sessions").select("*")
        .eq("id", winnerId);
      winnerSessionQuery = organizationId
        ? winnerSessionQuery.eq("organization_id", organizationId)
        : winnerSessionQuery.is("organization_id", null);
      const winnerSession = await winnerSessionQuery.maybeSingle();
      if (winnerSession?.error || !winnerSession?.data) {
        throw new Error("quote_session_lineage_unavailable");
      }
      return rowToSession(winnerSession.data);
    }
  }
  return rowToSession(created);
}

/**
 * Strict read-only lookup: returns the QuoteSession bound to the given
 * conversation, or null. Never inserts, never updates, never links a session
 * across conversations. Callers that must remain read-only (e.g. the booking
 * readiness tool) MUST use this instead of findOrCreateForConversation.
 */
export async function findByConversation(
  supabase: SB,
  conversationId: string,
  resolvedOrganizationId?: string | null,
): Promise<QuoteSession | null> {
  try {
    return await findByConversationStrict(
      supabase,
      conversationId,
      resolvedOrganizationId,
    );
  } catch {
    return null;
  }
}

/**
 * Authority-sensitive variant of findByConversation. A conversation with no
 * linked quote is an ordinary null result; storage failures, missing scoped
 * conversations, and stale/cross-organization links remain explicit errors.
 */
export async function findByConversationStrict(
  supabase: SB,
  conversationId: string,
  resolvedOrganizationId?: string | null,
): Promise<QuoteSession | null> {
  if (!conversationId) {
    throw new Error("quote_session_conversation_unavailable");
  }
  const organizationId = resolvedOrganizationId ?? null;
  let conversationQuery = supabase
    .from("chat_conversations")
    .select("quote_session_id, organization_id")
    .eq("id", conversationId);
  conversationQuery = organizationId
    ? conversationQuery.eq("organization_id", organizationId)
    : conversationQuery.is("organization_id", null);
  const { data: conv, error: conversationError } = await conversationQuery
    .maybeSingle();
  if (conversationError || !conv) {
    throw new Error("quote_session_conversation_unavailable");
  }
  const sid: string | null = conv.quote_session_id ?? null;
  if (!sid) return null;
  let sessionQuery = supabase
    .from("quote_sessions")
    .select("*")
    .eq("id", sid);
  sessionQuery = organizationId
    ? sessionQuery.eq("organization_id", organizationId)
    : sessionQuery.is("organization_id", null);
  const { data, error } = await sessionQuery.maybeSingle();
  if (error || !data) throw new Error("quote_session_lineage_unavailable");
  return rowToSession(data);
}

/** Sync a session from the orchestrator's current ConversationFacts. Primary
 *  write path: every persistFacts() call also mirrors here so voice/web/SMS
 *  edit the same canonical object. */
export async function syncFromFacts(
  supabase: SB,
  sessionId: string,
  facts: ConversationFacts,
  resolvedOrganizationId?: string | null,
): Promise<void> {
  if (!sessionId) return;
  const organizationId = resolvedOrganizationId ?? null;
  let rowQuery = supabase.from("quote_sessions").select("*").eq(
    "id",
    sessionId,
  );
  rowQuery = organizationId
    ? rowQuery.eq("organization_id", organizationId)
    : rowQuery.is("organization_id", null);
  const { data: row, error } = await rowQuery.maybeSingle();
  if (error || !row) {
    if (organizationId) throw new Error("quote_session_sync_lookup_failed");
    return;
  }
  const prev = rowToSession(row);
  const patch = fieldsFromFacts(facts);
  const merged = mergeFields(prev, patch);
  const required = computeRequired(merged.fields);
  const quoteStatus = quoteStatusFromFacts(facts);
  const bookingReady = isReadyToBook({ ...merged, quoteStatus });
  const update: Record<string, unknown> = {
    fields: merged.fields,
    field_status: merged.fieldStatus,
    required_remaining: required,
    quote_status: quoteStatus,
    booking_ready: bookingReady,
    last_step: facts.quote?.inputsKey
      ? "quoted"
      : (facts.services?.length ? "identifying_need" : "new"),
  };
  const phone = normalizePhone(facts.contact?.phone);
  const email = normalizeEmail(facts.contact?.email);
  if (phone) update.phone_e164 = phone;
  if (email) update.email_normalized = email;
  let updateQuery = supabase.from("quote_sessions").update(update).eq(
    "id",
    sessionId,
  );
  updateQuery = organizationId
    ? updateQuery.eq("organization_id", organizationId)
    : updateQuery.is("organization_id", null);
  if (organizationId) {
    const { data, error: updateError } = await updateQuery.select("id")
      .maybeSingle();
    if (updateError || !data) {
      throw new Error("quote_session_sync_update_failed");
    }
  } else {
    await updateQuery;
  }
}

function valueAtPath(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (current, segment) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[segment]
        : undefined,
    value,
  );
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value === undefined ? null : value;
}

/**
 * Canonical price/policy fingerprint. Field discovery comes from the shared
 * intake contract, not a second handwritten service list. It deliberately
 * includes provenance and confirmed recap fields because those can change a
 * mathematically firm result into a policy-blocked result without changing the
 * arithmetic inputs.
 */
export function sessionInputsKey(fields: QuoteSessionFields): string {
  const source = {
    ...(fields as unknown as Record<string, unknown>),
    services: evaluateQuoteIntake(fields as unknown as Record<string, unknown>)
      .services.slice().sort(),
  };
  const contractValues: Record<string, unknown> = {};
  const includedFieldIds = new Set<string>();
  const selectedServices = evaluateQuoteIntake(source).services;
  const storyNeutralWindowOnly = selectedServices.length === 1 &&
    selectedServices[0] === "window_cleaning";
  for (const spec of CANONICAL_INTAKE_FIELDS) {
    if (storyNeutralWindowOnly && spec.fieldId === "stories") continue;
    if (
      spec.appliesToServices.some((service) =>
        selectedServices.includes(service)
      ) &&
      (spec.stage === "service_selection" || spec.stage === "pre_price" ||
        spec.stage === "post_price_upsell" || spec.changesPrice ||
        spec.category === "manual_review_trigger" ||
        spec.category === "owner_decision_required")
    ) {
      contractValues[spec.fieldId] = valueAtPath(source, spec.storagePath);
      includedFieldIds.add(spec.fieldId);
    }
  }
  const confirmed = fields.confirmationSummary;
  const priceProvenance = Object.fromEntries(
    Object.entries(fields.answerProvenance ?? {})
      .filter(([fieldId]) => includedFieldIds.has(fieldId)),
  );
  return JSON.stringify(stableValue({
    contractValues,
    // Discounts predate the canonical intake manifest and are deliberately
    // not a voice question. They are still a price-changing persisted input,
    // so changing an authorized legacy discount must invalidate a cached quote.
    externalPricingValues: {
      discountCode: fields.discountCode?.trim().toUpperCase() || null,
    },
    answerProvenance: priceProvenance,
    confirmationSummary: confirmed
      ? {
        confirmed: confirmed.confirmed === true,
        confirmedFieldIds: [...(confirmed.confirmedFieldIds ?? [])]
          .filter((fieldId) => includedFieldIds.has(fieldId))
          .sort(),
      }
      : null,
  }));
}

/** Context that must remain fixed while availability or booking is offered. */
export function sessionBookingInputsKey(fields: QuoteSessionFields): string {
  return JSON.stringify(stableValue({
    priceInputsKey: sessionInputsKey(fields),
    address: fields.address?.trim().toLowerCase() ?? null,
    city: fields.city?.trim().toLowerCase() ?? null,
    state: fields.state?.trim().toUpperCase() ?? null,
    zip: fields.zip?.trim() ?? null,
    serviceAreaStatus: fields.serviceAreaStatus ?? null,
    customer: {
      name: fields.name?.trim() ?? null,
      email: fields.email?.trim().toLowerCase() ?? null,
      phone: fields.phone ?? null,
    },
  }));
}
