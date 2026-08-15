import { BLULADDER_KLAMATH } from "./bluladderKlamath";
import {
  BLULADDER_KLAMATH_PRICING_DRAFT,
  BLULADDER_KLAMATH_TRAVEL_POLICY,
} from "./bluladderKlamathPricingDraft";

export const KLAMATH_FIRST_WAVE_AUTOMATED_SERVICE_KEYS = [
  "window_cleaning",
  "gutter_cleaning",
  "house_wash",
  "pressure_washing",
] as const;

export const KLAMATH_MANUAL_REVIEW_SERVICE_KEYS = [
  "solar_panel_cleaning",
  "christmas_lights",
  "commercial_exterior_cleaning",
  "storefront_window_cleaning",
] as const;

/**
 * Exact, non-runtime candidate for owner review. It deliberately references the
 * independent Klamath draft and never imports a live DFW configuration.
 */
export const KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE = {
  schemaVersion: 1,
  tenantKey: "bluladder-klamath",
  purpose: "pricing_duration_owner_review",
  profileKey: BLULADDER_KLAMATH.pricing.profileKey,
  profileVersion: BLULADDER_KLAMATH.pricing.version,
  automatedServiceKeys: KLAMATH_FIRST_WAVE_AUTOMATED_SERVICE_KEYS,
  manualReviewServiceKeys: KLAMATH_MANUAL_REVIEW_SERVICE_KEYS,
  pricing: {
    window_cleaning: BLULADDER_KLAMATH_PRICING_DRAFT.window_cleaning,
    window_addons: BLULADDER_KLAMATH_PRICING_DRAFT.window_addons,
    gutter_cleaning: BLULADDER_KLAMATH_PRICING_DRAFT.gutter_cleaning,
    house_wash: BLULADDER_KLAMATH_PRICING_DRAFT.house_wash,
    pressure_washing: BLULADDER_KLAMATH_PRICING_DRAFT.pressure_washing,
  },
  durationPolicy: BLULADDER_KLAMATH_PRICING_DRAFT.duration_policy,
  taxPolicy: BLULADDER_KLAMATH_PRICING_DRAFT.tax_policy,
  travelPolicy: BLULADDER_KLAMATH_TRAVEL_POLICY,
  promotion99Enabled:
    BLULADDER_KLAMATH_PRICING_DRAFT.window_promo_99?.active ?? false,
  pricingRuntimeEnabled: false,
  activationAllowed: false,
} as const;

export const KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT = {
  algorithm: "sha256",
  serialization: "canonical_json_sorted_keys_pretty_2_trailing_newline",
  sha256: "d69f072d0510393304cc382ec0140c385a7d8bb2302b6ccdab7592149e1e21a4",
} as const;

export interface KlamathPricingDurationReviewEnvelope {
  candidate: typeof KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE;
  candidateFingerprint:
    typeof KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT;
  ownerApproval: {
    status: "pending" | "approved";
    recordRef: string | null;
    approvedAt: string | null;
  };
  contractTestsPassed: boolean;
}

export interface KlamathPricingDurationReviewResult {
  status: "blocked" | "eligible_for_pricing_duration_gate";
  activationAllowed: false;
  blockers: readonly string[];
}

export const KLAMATH_PRICING_DURATION_REVIEW_TEMPLATE:
  KlamathPricingDurationReviewEnvelope = {
    candidate: KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE,
    candidateFingerprint:
      KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT,
    ownerApproval: {
      status: "pending",
      recordRef: null,
      approvedAt: null,
    },
    contractTestsPassed: false,
  };

const TOP_LEVEL_KEYS = new Set([
  "candidate",
  "candidateFingerprint",
  "ownerApproval",
  "contractTestsPassed",
]);
const FINGERPRINT_KEYS = new Set(["algorithm", "serialization", "sha256"]);
const APPROVAL_KEYS = new Set(["status", "recordRef", "approvedAt"]);
const SENSITIVE_FIELD_PATTERN =
  /(?:secret|token|password|api.?key|grant.?key|header|provider.?id|account.?id|phone.?number|email.?address|webhook.?url|tool.?url)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeJson(left)) ===
    JSON.stringify(canonicalizeJson(right));
}

function validUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).valueOf());
}

function inspectFields(
  value: unknown,
  allowed: ReadonlySet<string> | null,
  path: string,
  blockers: string[],
): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      blockers.push(`sensitive_field_present:${path}.${key}`);
    } else if (allowed && !allowed.has(key)) {
      blockers.push(`unexpected_field:${path}.${key}`);
    }
    if (child && typeof child === "object") {
      inspectFields(child, null, `${path}.${key}`, blockers);
    }
  }
}

/**
 * Evaluates only whether protected launch evidence may mark the independent
 * pricing-and-duration gate true. It cannot enable pricing or activation.
 */
export function evaluateKlamathPricingDurationReview(
  input: unknown,
): KlamathPricingDurationReviewResult {
  const blockers: string[] = [];
  inspectFields(input, TOP_LEVEL_KEYS, "$", blockers);
  if (!isRecord(input)) {
    return { status: "blocked", activationAllowed: false, blockers };
  }

  if (!sameJson(input.candidate, KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE)) {
    blockers.push("candidate_snapshot_mismatch");
  }

  inspectFields(
    input.candidateFingerprint,
    FINGERPRINT_KEYS,
    "$.candidateFingerprint",
    blockers,
  );
  if (
    !sameJson(
      input.candidateFingerprint,
      KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT,
    )
  ) {
    blockers.push("candidate_fingerprint_mismatch");
  }

  inspectFields(input.ownerApproval, APPROVAL_KEYS, "$.ownerApproval", blockers);
  if (!isRecord(input.ownerApproval) || input.ownerApproval.status !== "approved") {
    blockers.push("owner_approval_missing");
  } else if (
    typeof input.ownerApproval.recordRef !== "string" ||
    !/^(?:github-issue-\d+|owner-approval-\d{4}-\d{2}-\d{2})$/.test(
      input.ownerApproval.recordRef,
    ) ||
    typeof input.ownerApproval.approvedAt !== "string" ||
    !validUtcTimestamp(input.ownerApproval.approvedAt)
  ) {
    blockers.push("owner_approval_invalid");
  }

  if (input.contractTestsPassed !== true) {
    blockers.push("contract_tests_not_verified");
  }

  if (
    BLULADDER_KLAMATH.pricing.status !== "draft" ||
    BLULADDER_KLAMATH.pricing.runtimeEnabled ||
    BLULADDER_KLAMATH.activationAllowed ||
    BLULADDER_KLAMATH.customerTrafficAllowed
  ) {
    blockers.push("repository_runtime_boundary_open");
  }

  const normalized = [...new Set(blockers)].sort();
  return {
    status: normalized.length
      ? "blocked"
      : "eligible_for_pricing_duration_gate",
    activationAllowed: false,
    blockers: normalized,
  };
}
