import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Basic email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: "Invalid email format" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up customer by exact email match
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, email, first_name, last_name, phone, address")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (customerError) {
      console.error("Customer lookup error:", customerError);
      return new Response(JSON.stringify({ error: "Lookup failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!customer) {
      return new Response(JSON.stringify({ customer: null, bookings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Fetch past bookings for this customer
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, reference_number, scheduled_start, status, total, home_details_json, services_json")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(10);

    return new Response(JSON.stringify({ customer, bookings: bookings || [] }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Error in customer-lookup:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
