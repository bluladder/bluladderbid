// Booking-management token endpoint. Given a raw opaque token (never persisted),
// validates the hash against booking_management_tokens and returns view/action
// access limited to a single booking.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sha256Hex } from "../_shared/customerVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const token = url.searchParams.get("t") || (await req.json().catch(() => ({}))).token;
  if (typeof token !== "string" || token.length < 20) {
    return new Response(JSON.stringify({ error: "invalid" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const hash = await sha256Hex(token);
  const { data: row } = await supabase
    .from("booking_management_tokens")
    .select("id, booking_id, expires_at, consumed_at, revoked_at, use_count")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) {
    return new Response(JSON.stringify({ error: "expired_or_invalid" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("booking_management_tokens").update({
    last_used_at: new Date().toISOString(),
    use_count: (row.use_count ?? 0) + 1,
  }).eq("id", row.id);

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, reference_number, scheduled_start, scheduled_end, address, status, services_json, total")
    .eq("id", row.booking_id)
    .maybeSingle();
  if (!booking) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ booking }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});