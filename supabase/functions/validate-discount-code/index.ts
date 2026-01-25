import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ valid: false, error: "Code is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: discountCode, error } = await supabase
      .from("discount_codes")
      .select("id, code, discount_type, discount_value, is_active, expires_at, usage_count, max_uses")
      .eq("code", code.toUpperCase().trim())
      .maybeSingle();

    if (error) {
      console.error("Database error:", error);
      return new Response(
        JSON.stringify({ valid: false, error: "Failed to validate code" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!discountCode) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid discount code" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Check if code is active
    if (!discountCode.is_active) {
      return new Response(
        JSON.stringify({ valid: false, error: "This code is no longer active" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Check expiration
    if (discountCode.expires_at && new Date(discountCode.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ valid: false, error: "This code has expired" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Check max uses
    if (discountCode.max_uses !== null && discountCode.usage_count >= discountCode.max_uses) {
      return new Response(
        JSON.stringify({ valid: false, error: "This code has reached its maximum uses" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        valid: true,
        discount: {
          type: discountCode.discount_type,
          value: discountCode.discount_value,
          code: discountCode.code,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ valid: false, error: "An error occurred" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
