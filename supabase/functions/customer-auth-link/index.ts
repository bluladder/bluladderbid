// Called after a customer signs in with Google or an email magic link via
// Lovable-managed auth. Verifies the caller's Supabase JWT, then deterministically
// matches / creates the customer_accounts row keyed by auth_user_id.
//
// Design invariants:
//  - never trust a customer_id or email from the browser body
//  - never merge two existing customer records; ambiguous matches refuse
//  - never overwrite operational customer email / phone from the OAuth identity
//  - writes to customer_auth_link_events for admin audit
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return t.length ? t : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser(token);
  const user = u?.user;
  if (uErr || !user) return json({ error: "unauthorized" }, 401);

  const authEmail = normEmail(user.email);
  const provider = (user.app_metadata as { provider?: string } | null)?.provider ?? "unknown";
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Idempotency: already linked → return.
  const { data: existing } = await service
    .from("customer_accounts")
    .select("id, customer_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (existing) {
    return json({ status: "already_linked", customer_account_id: existing.id });
  }

  // Deterministic match by normalized email.
  let outcome: "linked_existing" | "linked_new_account" | "ambiguous" | "error" = "error";
  let matched_count = 0;
  let customerId: string | null = null;

  if (authEmail) {
    const { data: matches } = await service
      .from("customers")
      .select("id")
      .ilike("email", authEmail);
    matched_count = matches?.length ?? 0;
    if (matched_count === 1) {
      customerId = matches![0].id;
      outcome = "linked_existing";
    } else if (matched_count > 1) {
      await service.from("customer_auth_link_events").insert({
        auth_user_id: user.id, auth_email: authEmail, auth_provider: provider,
        outcome: "ambiguous", matched_count,
        detail: "multiple customer rows share this email; manual review required",
      });
      return json({ status: "ambiguous", contact_support: true }, 200);
    }
  }

  // No match → create a minimal profile so the portal has something to point at.
  if (!customerId) {
    const { data: created, error: cErr } = await service
      .from("customers")
      .insert({ email: authEmail, first_name: null, last_name: null, phone: null, address: null })
      .select("id")
      .single();
    if (cErr || !created) {
      await service.from("customer_auth_link_events").insert({
        auth_user_id: user.id, auth_email: authEmail, auth_provider: provider,
        outcome: "error", detail: cErr?.message ?? "customer insert failed",
      });
      return json({ error: "link_failed" }, 500);
    }
    customerId = created.id;
    outcome = "linked_new_account";
  }

  const { data: acct, error: aErr } = await service
    .from("customer_accounts")
    .insert({
      customer_id: customerId,
      verified_email: authEmail,
      auth_user_id: user.id,
      auth_provider: provider,
      auth_linked_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (aErr || !acct) {
    await service.from("customer_auth_link_events").insert({
      auth_user_id: user.id, auth_email: authEmail, auth_provider: provider,
      outcome: "error", customer_id: customerId, detail: aErr?.message ?? "account insert failed",
    });
    return json({ error: "link_failed" }, 500);
  }

  await service.from("customer_auth_link_events").insert({
    auth_user_id: user.id, auth_email: authEmail, auth_provider: provider,
    outcome, customer_id: customerId, matched_count,
  });

  return json({ status: outcome, customer_account_id: acct.id });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}