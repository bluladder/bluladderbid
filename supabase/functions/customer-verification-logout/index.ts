// Revoke the current portal session and clear the cookie.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { extractPortalToken, sha256Hex, clearPortalCookie } from "../_shared/customerVerification.ts";

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
  if (raw) {
    const hash = await sha256Hex(raw);
    await supabase.from("customer_portal_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("session_token_hash", hash);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Set-Cookie": clearPortalCookie() },
  });
});