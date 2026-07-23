// ============================================================================
// sms-booking-reconcile — Phase 6B.2 reconciliation runner edge function.
//
// Invoked periodically (or on demand) to resolve failed_recoverable SMS
// booking confirmations whose failure_class is reconciliation-owned. See
// _shared/smsBookingReconcile.ts for the dispatcher logic. This entry
// point is a thin HTTP wrapper — Bearer auth against the service role key,
// with CORS for admin manual invocation.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runSmsBookingReconciliation } from "../_shared/smsBookingReconcile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "missing_env" }, 500);

  // Auth: require the service-role key (Bearer or apikey header). The
  // scheduler and admin trigger both send this.
  const authHeader = req.headers.get("authorization") ?? "";
  const apikeyHeader = req.headers.get("apikey") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (bearer !== serviceKey && apikeyHeader !== serviceKey) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabase = createClient(url, serviceKey);
  const result = await runSmsBookingReconciliation(supabase, {
    batchSize: Number(body?.batchSize) || undefined,
    lookbackDays: Number(body?.lookbackDays) || undefined,
  });

  return json({ success: result.ok, ...result });
});