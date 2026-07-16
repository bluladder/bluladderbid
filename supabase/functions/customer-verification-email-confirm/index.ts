// Passwordless customer verification — EMAIL fallback.
// The client uses supabase.auth.signInWithOtp + verifyOtp to prove ownership
// of an email address via Supabase Auth. This endpoint receives the resulting
// Supabase access token, resolves an unambiguous internal customer match on
// the SERVER using the verified email claim, and issues a memory-only portal
// session. Typed-but-unverified emails cannot reach this code path because we
// only trust the email inside the Supabase-verified JWT.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  sha256Hex,
  generateSessionToken,
  loadVerificationConfig,
  clientIp,
} from "../_shared/customerVerification.ts";

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

  const generic = (extra: Record<string, unknown> = {}, status = 200) =>
    new Response(JSON.stringify({ verified: false, ...extra }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return generic({}, 401);

    // Validate the JWT with Supabase Auth — never trust a client-supplied email.
    const { data: userRes, error: userErr } = await supabase.auth.getUser(jwt);
    const authUser = userRes?.user;
    if (userErr || !authUser?.email || !authUser.email_confirmed_at) return generic({}, 401);
    const verifiedEmail = authUser.email.toLowerCase();

    // Server-side, case-insensitive match against internal customers.
    const { data: matches } = await supabase
      .from("customers")
      .select("id, email")
      .not("email", "is", null);
    const candidateIds = (matches ?? [])
      .filter((c: { email: string | null }) => (c.email ?? "").toLowerCase() === verifiedEmail)
      .map((c: { id: string }) => c.id);

    if (candidateIds.length > 1) {
      await supabase.from("customer_account_match_issues").insert({
        verified_email: verifiedEmail,
        candidate_customer_ids: candidateIds,
      });
      return new Response(JSON.stringify({ verified: false, ambiguous: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (candidateIds.length === 0) {
      return new Response(JSON.stringify({ verified: true, guest: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerId = candidateIds[0];
    const cfg = await loadVerificationConfig(supabase);
    const ipHash = await sha256Hex(clientIp(req));

    let accountId: string;
    const { data: existing } = await supabase
      .from("customer_accounts")
      .select("id")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (existing) {
      accountId = existing.id;
      await supabase.from("customer_accounts")
        .update({ last_verified_at: new Date().toISOString() })
        .eq("id", accountId);
    } else {
      // Email-only match: use verified email as a stable stand-in phone slot is
      // NOT appropriate; store under a distinct account row keyed by customer.
      const { data: created, error: createErr } = await supabase
        .from("customer_accounts")
        .insert({ customer_id: customerId, verified_email: verifiedEmail })
        .select("id")
        .single();
      if (createErr || !created) return generic({}, 500);
      accountId = created.id;
    }

    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const absoluteExp = new Date(Date.now() + cfg.session_absolute_seconds * 1000).toISOString();
    await supabase.from("customer_portal_sessions").insert({
      session_token_hash: tokenHash,
      customer_account_id: accountId,
      ip_hash: ipHash,
      absolute_expires_at: absoluteExp,
    });

    return new Response(JSON.stringify({ verified: true, guest: false, session_token: token, expires_at: absoluteExp }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return generic({}, 500);
  }
});