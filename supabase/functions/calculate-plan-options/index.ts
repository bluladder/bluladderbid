// ============================================================================
// calculate-plan-options — AUTHORITATIVE batch plan/recurring quote endpoint.
// Computes multiple priced plan scenarios (one-time, quarterly, semiannual,
// annual, bundles, add-ons) from the SAME canonical pricing engine used by
// calculate-quote. It never trusts a client-supplied price or discount, applies
// recurring/bundle rules only through the engine, validates every scenario, and
// returns each option INDEPENDENTLY so one manual-review option can't corrupt
// the valid ones.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculatePlanOptions,
  computeBundleTiers,
  type EngineAdditionalServices,
  type EngineHomeDetails,
  type PlanScenario,
} from "../_shared/pricingEngine.ts";
import { loadPricing } from "../_shared/loadPricing.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Guardrails against malformed / extreme requests.
const MAX_OPTIONS = 8;
const MAX_ID_LEN = 64;
const VALID_CADENCE = new Set(["one_time", "monthly", "annual"]);

function sanitizeScenario(raw: unknown, index: number): PlanScenario | { error: string } {
  if (!raw || typeof raw !== "object") return { error: `scenario[${index}] is not an object` };
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === "string" && o.id.trim() ? o.id.slice(0, MAX_ID_LEN) : `option_${index}`;

  if (!o.additionalServices || typeof o.additionalServices !== "object") {
    return { error: `scenario[${index}] missing additionalServices` };
  }

  const cadence =
    typeof o.billingCadence === "string" && VALID_CADENCE.has(o.billingCadence)
      ? (o.billingCadence as PlanScenario["billingCadence"])
      : undefined;

  // serviceFrequencies: only numeric, clamped 1..12 (visits/year).
  let serviceFrequencies: Record<string, number> | undefined;
  if (o.serviceFrequencies && typeof o.serviceFrequencies === "object") {
    serviceFrequencies = {};
    for (const [k, v] of Object.entries(o.serviceFrequencies as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 1 && n <= 12) serviceFrequencies[k.slice(0, 40)] = Math.floor(n);
    }
  }

  const bundleKey =
    typeof o.bundleKey === "string" && o.bundleKey.trim() ? o.bundleKey.slice(0, 40) : undefined;

  // Discounts/promotions are re-validated by the engine/DB; we pass through only
  // structurally, never numeric client prices.
  let promotion: PlanScenario["promotion"] = null;
  if (o.promotion && typeof o.promotion === "object") {
    const p = o.promotion as Record<string, unknown>;
    if (typeof p.id === "string") {
      const windowCount = Number(p.windowCount);
      promotion = { id: p.id.slice(0, 60), windowCount: Number.isFinite(windowCount) ? windowCount : NaN };
    }
  }

  return {
    id,
    label: typeof o.label === "string" ? o.label.slice(0, 120) : undefined,
    billingCadence: cadence,
    additionalServices: o.additionalServices as EngineAdditionalServices,
    serviceFrequencies,
    bundleKey,
    promotion,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = rateLimit(req, { limit: 40, windowMs: 60000 });
  if (!rl.allowed) {
    return json({ status: "rate_limited", error: "Too many requests, please slow down." }, 429);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ status: "missing_information", error: "Invalid request body" }, 400);
    }

    const homeDetails = (body as Record<string, unknown>).homeDetails as EngineHomeDetails | undefined;
    if (!homeDetails || typeof homeDetails !== "object") {
      return json({ status: "missing_information", error: "homeDetails is required" }, 400);
    }

    const mode = (body as Record<string, unknown>).mode;

    // -----------------------------------------------------------------------
    // BUNDLE TIERS MODE — good/better/best plan tiers for the website. Uses the
    // canonical `computeBundleTiers` (the former frontend `useServicePricing`
    // math, now server-authoritative). Prices come only from the engine.
    // -----------------------------------------------------------------------
    if (mode === "bundle_tiers") {
      const additionalServices = (body as Record<string, unknown>).additionalServices;
      if (!additionalServices || typeof additionalServices !== "object") {
        return json({ status: "missing_information", error: "additionalServices is required" }, 400);
      }

      const supabaseBundle = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const loadedBundle = await loadPricing(supabaseBundle);
      if (!loadedBundle.ok || !loadedBundle.pricing) {
        console.error("calculate-plan-options(bundle_tiers): pricing unavailable", loadedBundle.error);
        return json(
          { status: "pricing_unavailable", error: "Pricing is temporarily unavailable. Please try again shortly." },
          503,
        );
      }
      const tiersResult = computeBundleTiers(
        { homeDetails, additionalServices: additionalServices as EngineAdditionalServices },
        loadedBundle.pricing,
        loadedBundle.ruleVersion,
      );
      return json({ status: "ok", mode: "bundle_tiers", ...tiersResult }, 200);
    }

    const rawScenarios = (body as Record<string, unknown>).scenarios;
    if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
      return json({ status: "missing_information", error: "scenarios must be a non-empty array" }, 400);
    }
    if (rawScenarios.length > MAX_OPTIONS) {
      return json(
        { status: "error", error: `Too many options requested (max ${MAX_OPTIONS}).` },
        400,
      );
    }

    const scenarios: PlanScenario[] = [];
    for (let i = 0; i < rawScenarios.length; i++) {
      const s = sanitizeScenario(rawScenarios[i], i);
      if ("error" in s) return json({ status: "missing_information", error: s.error }, 400);
      scenarios.push(s);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const loaded = await loadPricing(supabase);
    if (!loaded.ok || !loaded.pricing) {
      console.error("calculate-plan-options: pricing unavailable", loaded.error, loaded.missingKeys);
      return json(
        {
          status: "pricing_unavailable",
          error: "Pricing is temporarily unavailable. Please try again shortly.",
          missingKeys: loaded.missingKeys,
        },
        503,
      );
    }

    const result = calculatePlanOptions({ homeDetails, scenarios }, loaded.pricing, loaded.ruleVersion);
    return json({ status: "ok", ...result }, 200);
  } catch (e) {
    console.error("calculate-plan-options error:", e);
    return json({ status: "error", error: "Could not calculate plan options right now." }, 500);
  }
});
