import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Throttle per-IP to prevent enumerating/harvesting customer records by
  // submitting many arbitrary email addresses.
  const rl = rateLimit(req, { limit: 8, windowMs: 60_000 });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders },
    });
  }

  try {
    const { email, mode = "basic" } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

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
      return new Response(JSON.stringify({ customer: null, bookings: [], appointments: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Mode: "basic" returns past bookings for the customer lookup flow
    // Mode: "appointments" returns upcoming appointments for the my-appointments page
    if (mode === "appointments") {
      const { data: appointments } = await supabase
        .from("bookings")
        .select(`
          id,
          reference_number,
          status,
          scheduled_start,
          scheduled_end,
          duration_minutes,
          total,
          subtotal,
          discount_amount,
          discount_code,
          services_json,
          home_details_json,
          technician:technicians(name)
        `)
        .eq("customer_id", customer.id)
        .in("status", ["scheduled", "confirmed", "pending"])
        .not("scheduled_start", "is", null)
        .gte("scheduled_start", new Date().toISOString())
        .order("scheduled_start", { ascending: true });

      // Also return saved quotes so customers can revisit them for future reference.
      const { data: quotes } = await supabase
        .from("quotes")
        .select(
          "id, status, total, services_json, home_details_json, created_at, expires_at"
        )
        .or(`customer_id.eq.${customer.id},customer_email.eq.${normalizedEmail}`)
        .order("created_at", { ascending: false })
        .limit(20);

      return new Response(JSON.stringify({
        customer: { id: customer.id },
        appointments: appointments || [],
        quotes: quotes || [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Default: basic mode - past bookings for customer lookup
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
