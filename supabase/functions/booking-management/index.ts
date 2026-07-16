// Booking-management token endpoint.
//
// The link sent in the confirmation SMS/email carries a one-time BOOTSTRAP
// token. First successful validation atomically marks the row consumed and
// mints a short-lived booking-scoped SESSION token that grants access ONLY
// to that single booking — never quote history, previous work, or the full
// portal. Re-use of the bootstrap token afterwards fails closed.
//
// Endpoints:
//   POST { token }         — redeem bootstrap → { session_token, booking }
//   POST { session_token } — reuse booking-scoped session → { booking }
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sha256Hex, generateSessionToken } from "../_shared/customerVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOOKING_SESSION_TTL_SECONDS = 30 * 60; // 30 minutes

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const err = (msg: string, status = 401) => new Response(
    JSON.stringify({ error: msg }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );

  const body = await req.json().catch(() => ({}));
  const bootstrap = typeof body?.token === "string" ? body.token : null;
  const sessionToken = typeof body?.session_token === "string" ? body.session_token : null;

  // --- Path A: reuse a booking-scoped session ------------------------------
  if (sessionToken && !bootstrap) {
    if (sessionToken.length < 20) return err("invalid");
    const hash = await sha256Hex(sessionToken);
    const { data: sess } = await supabase
      .from("booking_management_tokens")
      .select("id, booking_id, management_session_hash, management_session_expires_at, revoked_at")
      .eq("management_session_hash", hash)
      .maybeSingle();
    if (!sess || sess.revoked_at) return err("expired_or_invalid");
    if (!sess.management_session_expires_at || new Date(sess.management_session_expires_at).getTime() < Date.now()) {
      return err("expired_or_invalid");
    }
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, reference_number, scheduled_start, scheduled_end, address, status, services_json, total")
      .eq("id", sess.booking_id)
      .maybeSingle();
    if (!booking) return err("not_found", 404);
    return new Response(JSON.stringify({ booking }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- Path B: redeem bootstrap token exactly once --------------------------
  if (!bootstrap || bootstrap.length < 20) return err("invalid", 400);
  const bootstrapHash = await sha256Hex(bootstrap);

  const newSession = generateSessionToken();
  const newSessionHash = await sha256Hex(newSession);
  const now = new Date();
  const sessionExpires = new Date(now.getTime() + BOOKING_SESSION_TTL_SECONDS * 1000);

  // Atomic single-winner consumption: the UPDATE only fires when consumed_at
  // is NULL and the token is still valid. Postgres serializes concurrent
  // updates to the same row, so exactly one caller receives the returned row.
  const { data: consumed, error: consumeErr } = await supabase
    .from("booking_management_tokens")
    .update({
      consumed_at: now.toISOString(),
      last_used_at: now.toISOString(),
      use_count: 1,
      management_session_hash: newSessionHash,
      management_session_expires_at: sessionExpires.toISOString(),
    })
    .eq("token_hash", bootstrapHash)
    .is("consumed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .select("id, booking_id")
    .maybeSingle();

  if (consumeErr || !consumed) return err("expired_or_invalid");

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, reference_number, scheduled_start, scheduled_end, address, status, services_json, total")
    .eq("id", consumed.booking_id)
    .maybeSingle();
  if (!booking) return err("not_found", 404);

  return new Response(JSON.stringify({
    session_token: newSession,
    expires_at: sessionExpires.toISOString(),
    booking,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});