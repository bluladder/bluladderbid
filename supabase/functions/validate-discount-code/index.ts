import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit } from "../_shared/rateLimit.ts";
import { validateDiscountCodeAuthoritatively } from "../_shared/discountCodeValidation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit: 10 requests per minute per IP
  const rateLimitResult = rateLimit(req, { limit: 10, windowMs: 60000 });

  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        valid: false,
        error: "Too many requests. Please try again later.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 429,
      },
    );
  }

  try {
    const { code } = await req.json();

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Code is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    // Validate code format (alphanumeric, 3-20 chars) to prevent injection
    const sanitizedCode = code.toUpperCase().trim();
    if (!/^[A-Z0-9]{3,20}$/.test(sanitizedCode)) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid code format" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const validation = await validateDiscountCodeAuthoritatively(
      supabase,
      sanitizedCode,
    );

    if (validation.status === "invalid") {
      const message =
        validation.reason === "inactive"
          ? "This code is no longer active"
          : validation.reason === "expired"
            ? "This code has expired"
            : validation.reason === "exhausted"
              ? "This code has reached its maximum uses"
              : validation.reason === "unknown"
                ? "Invalid discount code"
                : "Failed to validate code";
      return new Response(JSON.stringify({ valid: false, error: message }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: validation.reason === "uncertain" ? 500 : 200,
      });
    }

    return new Response(
      JSON.stringify({
        valid: true,
        discount: {
          type: validation.discountType,
          value: validation.discountValue,
          code: validation.code,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ valid: false, error: "An error occurred" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
