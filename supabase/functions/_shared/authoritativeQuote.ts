// ============================================================================
// authoritativeQuote — thin wrapper that resolves a client save-quote payload
// into a SERVER-COMPUTED quote result. It never accepts a client-declared
// price, subtotal, discount amount, promotion value, or annual/monthly plan
// number as authoritative. All numbers come from the canonical pricing engine
// against the live pricing_config.
// ============================================================================
import { calculateQuote, calculatePlanOptions } from "./pricingEngine.ts";
import type {
  EngineAdditionalServices,
  EngineHomeDetails,
  PlanOptionResult,
  QuoteResult,
} from "./pricingEngine.ts";
import { loadPricing } from "./loadPricing.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type AuthoritativeQuoteType = "one_time" | "recurring_plan";

export interface AuthoritativeInput {
  quoteType: AuthoritativeQuoteType;
  homeDetails: EngineHomeDetails;
  additionalServices: EngineAdditionalServices;
  discount?: { code?: string } | null;
  promotion?: { id?: string; windowCount?: number } | null;
  /** Only for recurring_plan: the plan scenario the customer selected. */
  planScenario?: {
    id?: string;
    label?: string;
    billingCadence?: "one_time" | "monthly" | "annual";
    serviceFrequencies?: Record<string, number>;
    bundleKey?: string;
  } | null;
  /** Client-declared display values, used ONLY for tamper detection. */
  clientDisplay: {
    total: number;
    subtotal?: number;
    annualTotal?: number;
    monthlyPayment?: number;
    downPayment?: number;
  };
}

export interface AuthoritativeSuccess {
  ok: true;
  quoteType: AuthoritativeQuoteType;
  engineVersion: string;
  ruleVersion: number | null;
  /** Server-computed authoritative numbers. */
  authoritative: {
    total: number;
    subtotal: number;
    annualTotal?: number;
    monthlyPayment?: number;
    downPayment?: number;
    lineItems: unknown[];
    promotion: QuoteResult["promotion"];
    discount: QuoteResult["discount"];
    planOption?: PlanOptionResult;
  };
  /** Snapshot to persist verbatim on the quotes row. */
  snapshot: Record<string, unknown>;
}

export interface AuthoritativeFailure {
  ok: false;
  status:
    | "pricing_unavailable"
    | "missing_information"
    | "manual_review_required"
    | "pricing_mismatch"
    | "invalid_plan"
    | "invalid_payload";
  message: string;
  detail?: Record<string, unknown>;
}

export type AuthoritativeResult = AuthoritativeSuccess | AuthoritativeFailure;

// Reject the client-declared value if it disagrees with the server-computed
// value by more than $2 AND more than 2%. Small rounding drift is tolerated
// so long as neither threshold is exceeded — this catches actual tampering
// (a $500 quote submitted as $1) without failing on trivial UI rounding.
function totalsAgree(client: number, server: number): boolean {
  if (!Number.isFinite(client) || !Number.isFinite(server)) return false;
  const absDiff = Math.abs(client - server);
  if (absDiff <= 2) return true;
  const pct = server > 0 ? absDiff / server : 1;
  return pct <= 0.02;
}

export async function computeAuthoritativeQuote(
  supabase: SB,
  input: AuthoritativeInput,
): Promise<AuthoritativeResult> {
  if (!input || (input.quoteType !== "one_time" && input.quoteType !== "recurring_plan")) {
    return { ok: false, status: "invalid_payload", message: "quoteType must be one_time or recurring_plan" };
  }
  if (!input.homeDetails || typeof input.homeDetails !== "object") {
    return { ok: false, status: "missing_information", message: "homeDetails is required" };
  }
  if (!input.additionalServices || typeof input.additionalServices !== "object") {
    return { ok: false, status: "missing_information", message: "additionalServices is required" };
  }
  if (!input.clientDisplay || typeof input.clientDisplay.total !== "number") {
    return { ok: false, status: "invalid_payload", message: "clientDisplay.total is required" };
  }

  const loaded = await loadPricing(supabase);
  if (!loaded.ok || !loaded.pricing) {
    return {
      ok: false,
      status: "pricing_unavailable",
      message: "Pricing is temporarily unavailable.",
      detail: { missingKeys: loaded.missingKeys ?? [] },
    };
  }

  // --- Discount code re-validation (server-side, never trust client price) --
  let discount: { type: "percentage" | "fixed"; value: number; code: string } | null = null;
  if (input.discount?.code && typeof input.discount.code === "string") {
    const code = input.discount.code.toUpperCase().trim();
    if (/^[A-Z0-9]{3,20}$/.test(code)) {
      const { data: dc } = await supabase
        .from("discount_codes")
        .select("code, discount_type, discount_value, is_active, expires_at, usage_count, max_uses")
        .eq("code", code)
        .maybeSingle();
      const valid = dc && dc.is_active
        && (!dc.expires_at || new Date(dc.expires_at) >= new Date())
        && (dc.max_uses === null || (dc.usage_count ?? 0) < dc.max_uses);
      if (valid) {
        discount = {
          type: dc.discount_type === "percentage" ? "percentage" : "fixed",
          value: Number(dc.discount_value),
          code: dc.code,
        };
      }
    }
  }

  // --- Promotion re-validation via the engine itself ------------------------
  const promotion = input.promotion && typeof input.promotion.id === "string"
    ? { id: input.promotion.id.slice(0, 60), windowCount: Number(input.promotion.windowCount) }
    : null;

  if (input.quoteType === "one_time") {
    const q = calculateQuote(
      {
        homeDetails: input.homeDetails,
        additionalServices: input.additionalServices,
        discount,
        promotion: promotion ?? undefined,
      },
      loaded.pricing,
      loaded.ruleVersion,
    );

    if (q.status !== "firm") {
      return {
        ok: false,
        status: q.status === "missing_information" ? "missing_information" : "manual_review_required",
        message: q.explanation || "Quote could not be firm-priced.",
        detail: { missing: q.missing, manualReviewReasons: q.manualReviewReasons },
      };
    }
    if (!totalsAgree(input.clientDisplay.total, q.total)) {
      return {
        ok: false,
        status: "pricing_mismatch",
        message: "Displayed total does not match the authoritative price.",
        detail: { serverTotal: q.total, clientTotal: input.clientDisplay.total },
      };
    }
    return {
      ok: true,
      quoteType: "one_time",
      engineVersion: q.engineVersion,
      ruleVersion: q.ruleVersion,
      authoritative: {
        total: q.total,
        subtotal: q.subtotal,
        lineItems: q.lineItems,
        promotion: q.promotion,
        discount: q.discount,
      },
      snapshot: {
        engine: q.engineVersion,
        rule_version: q.ruleVersion,
        line_items: q.lineItems,
        subtotal: q.subtotal,
        total: q.total,
        discount: q.discount,
        promotion: q.promotion,
        estimated_duration_minutes: q.estimatedDurationMinutes,
        jobber_line_items: q.jobberLineItems,
      },
    };
  }

  // ---- recurring_plan ------------------------------------------------------
  const s = input.planScenario ?? {};
  const scenario = {
    id: (typeof s.id === "string" && s.id) || "plan",
    label: typeof s.label === "string" ? s.label.slice(0, 120) : undefined,
    billingCadence: (s.billingCadence === "one_time" || s.billingCadence === "monthly" || s.billingCadence === "annual")
      ? s.billingCadence : "monthly" as const,
    additionalServices: input.additionalServices,
    serviceFrequencies: s.serviceFrequencies && typeof s.serviceFrequencies === "object"
      ? Object.fromEntries(
          Object.entries(s.serviceFrequencies)
            .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 1 && Number(v) <= 12)
            .map(([k, v]) => [k.slice(0, 40), Math.floor(Number(v))]),
        )
      : undefined,
    bundleKey: typeof s.bundleKey === "string" ? s.bundleKey.slice(0, 40) : undefined,
    discount: discount ?? undefined,
    promotion: promotion ?? undefined,
  };

  const plan = calculatePlanOptions(
    { homeDetails: input.homeDetails, scenarios: [scenario] },
    loaded.pricing,
    loaded.ruleVersion,
  );
  const option = plan.options[0];
  if (!option || option.status !== "firm") {
    return {
      ok: false,
      status: option?.status === "missing_information" ? "missing_information" : "invalid_plan",
      message: "Plan scenario could not be firm-priced.",
      detail: { missing: option?.missing, manualReviewReasons: option?.manualReviewReasons },
    };
  }
  const serverAnnual = option.annualTotal ?? 0;
  if (serverAnnual <= 0) {
    return {
      ok: false,
      status: "invalid_plan",
      message: "Recurring plan resolved to zero — refusing to persist.",
    };
  }
  // Client's `total` for a plan is the annual total; verify parity.
  if (!totalsAgree(input.clientDisplay.total, serverAnnual)) {
    return {
      ok: false,
      status: "pricing_mismatch",
      message: "Displayed plan total does not match the authoritative price.",
      detail: { serverAnnual, clientTotal: input.clientDisplay.total },
    };
  }
  return {
    ok: true,
    quoteType: "recurring_plan",
    engineVersion: plan.engineVersion,
    ruleVersion: plan.ruleVersion,
    authoritative: {
      total: serverAnnual,
      subtotal: serverAnnual,
      annualTotal: serverAnnual,
      monthlyPayment: option.recurringAmount ?? undefined,
      downPayment: option.downPayment ?? undefined,
      lineItems: option.lineItems,
      promotion: option.promotion,
      discount: null,
      planOption: option,
    },
    snapshot: {
      engine: plan.engineVersion,
      rule_version: plan.ruleVersion,
      option_id: option.optionId,
      billing_cadence: option.billingCadence,
      frequency: option.frequency,
      line_items: option.lineItems,
      per_visit_total: option.perVisitTotal,
      annual_total: option.annualTotal,
      recurring_amount: option.recurringAmount,
      down_payment: option.downPayment,
      promotion: option.promotion,
      estimated_duration_minutes: option.estimatedDurationMinutes,
    },
  };
}
