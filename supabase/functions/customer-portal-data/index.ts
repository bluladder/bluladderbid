// Server-authoritative portal data endpoint. Reads only rows for the customer
// linked to a validated portal session. Never trust a browser-supplied customer
// id, phone, or email.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { extractPortalToken, getActivePortalSession } from "../_shared/customerVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
  "Access-Control-Allow-Credentials": "true",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const raw = extractPortalToken(req);
  const session = raw ? await getActivePortalSession(supabase, raw) : null;
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: account } = await supabase
    .from("customer_accounts")
    .select("customer_id")
    .eq("id", session.customer_account_id)
    .single();
  if (!account) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const customerId = account.customer_id;

  const [customer, quotes, upcoming, completed] = await Promise.all([
    supabase.from("customers")
      .select("first_name, last_name, address")
      .eq("id", customerId).maybeSingle(),
    supabase.from("quotes")
      .select("id, created_at, total, status, services_json, address")
      .eq("customer_id", customerId)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("bookings")
      .select("id, reference_number, scheduled_start, scheduled_end, status, address, services_json, total")
      .eq("customer_id", customerId)
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .order("scheduled_start", { ascending: true })
      .limit(20),
    supabase.from("bookings")
      .select("id, reference_number, scheduled_start, status, address, services_json, total")
      .eq("customer_id", customerId)
      .eq("status", "completed")
      .order("scheduled_start", { ascending: false })
      .limit(20),
  ]);

  return new Response(JSON.stringify({
    customer: customer.data ?? null,
    recent_quotes: quotes.data ?? [],
    upcoming_appointments: upcoming.data ?? [],
    previous_work: completed.data ?? [],
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});