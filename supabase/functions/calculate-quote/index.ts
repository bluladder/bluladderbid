// ============================================================================
// calculate-quote — the single AUTHORITATIVE, server-side quote endpoint.
// Every customer-facing system (website booking, AI chat, future voice agent)
// gets its firm price here. It never trusts a client-submitted total, never
// uses fallback prices, and recalculates the entire quote from the live config.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculateQuote, type QuoteInput } from "../_shared/pricingEngine.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Abuse protection before doing any work.
  const rl = rateLimit(req, { limit: 60, windowMs: 60000 });
  if (!rl.allowed) {
    return json({ status: "rate_limited", error: "Too many requests, please slow down." }, 429);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ status: "missing_information", error: "Invalid request body" }, 400);
    }

    // Optional validated discount passthrough. We re-validate the code server-side
    // (active / not expired / under max uses) so the AI or client cannot invent one.
    let discount = null;
    const rawDiscount = (body as Record<string, unknown>).discount as
      | { code?: string }
      | undefined;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    if (rawDiscount?.code) {
      const code = String(rawDiscount.code).toUpperCase().trim();
      if (/^[A-Z0-9]{3,20}$/.test(code)) {
        const { data: dc } = await supabase
          .from("discount_codes")
          .select("code, discount_type, discount_value, is_active, expires_at, usage_count, max_uses")
          .eq("code", code)
          .maybeSingle();
        const valid =
          dc &&
          dc.is_active &&
          (!dc.expires_at || new Date(dc.expires_at) >= new Date()) &&
          (dc.max_uses === null || (dc.usage_count ?? 0) < dc.max_uses);
        if (valid) {
          discount = {
            type: dc.discount_type === "percentage" ? "percentage" : "fixed",
            value: Number(dc.discount_value),
            code: dc.code,
          };
        }
      }
    }

    const loaded = await loadPricing(supabase);
    if (!loaded.ok || !loaded.pricing) {
      // Fail safe — never guess prices.
      console.error("calculate-quote: pricing unavailable", loaded.error, loaded.missingKeys);
      return json(
        {
          status: "pricing_unavailable",
          firm: false,
          error: "Pricing is temporarily unavailable. Please try again shortly.",
          missingKeys: loaded.missingKeys,
        },
        503,
      );
    }

    const input: QuoteInput = {
      homeDetails: (body as Record<string, unknown>).homeDetails as QuoteInput["homeDetails"],
      additionalServices: (body as Record<string, unknown>)
        .additionalServices as QuoteInput["additionalServices"],
      discount,
    };

    if (!input.homeDetails || !input.additionalServices) {
      return json({ status: "missing_information", error: "homeDetails and additionalServices are required" }, 400);
    }

    const result = calculateQuote(input, loaded.pricing, loaded.ruleVersion);
    return json(result, 200);
  } catch (e) {
    console.error("calculate-quote error:", e);
    // Do not leak internal details to customers.
    return json({ status: "error", firm: false, error: "Could not calculate a quote right now." }, 500);
  }
});