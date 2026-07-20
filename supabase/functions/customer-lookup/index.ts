import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { rateLimit, sharedRateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// STAGE A SECURITY LOCKDOWN
// -------------------------
// This endpoint previously returned customer PII (name, phone, address,
// bookings, quotes) to any anonymous caller that submitted a matching email
// address. That is a data-enumeration risk and has been disabled.
//
// Until the passwordless customer portal (Supabase Auth + Twilio Verify /
// email OTP) lands, the endpoint intentionally returns a single generic,
// non-enumerating response for every request. It NEVER reveals whether the
// email or phone belongs to a customer, and never returns booking, quote,
// appointment, address, name or phone data.
//
// Do not "temporarily" re-enable partial responses here — reintroducing any
// existence signal (even a boolean "found") re-opens the enumeration path.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Defensive throttle even though the response body carries no PII.
  const rl = rateLimit(req, { limit: 12, windowMs: 60_000 });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders },
    });
  }
  // Shared, cross-instance limiter — stops distributed enumeration attempts
  // that would slip past a single instance's in-memory window.
  const shared = await sharedRateLimit(req, {
    key: "customer-lookup",
    limit: 30,
    windowMs: 60_000,
  });
  if (!shared.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders },
    });
  }

  // Drain the body so the caller cannot use response timing to distinguish
  // "email known" from "email unknown". No lookup is performed.
  try { await req.json(); } catch { /* ignore */ }

  return new Response(
    JSON.stringify({
      verified: false,
      message: "Secure verification is required to load saved customer information.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    },
  );
});
