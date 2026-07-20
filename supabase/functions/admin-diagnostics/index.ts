// ============================================================================
// admin-diagnostics — read-only launch-integrity view for admins. Returns the
// resolved production app URL, the scheduling/AI model in use, the current
// prompt/orchestrator version, and whether provider webhook secrets are
// configured. NEVER returns secret values — only presence booleans.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAdmin, getBearer } from "../_shared/auth.ts";
import { getAppUrl } from "../_shared/appUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bumped whenever the shared AI orchestrator / sms orchestrator prompt or
// tool contract materially changes. Surfaced to admins for release audits.
const ORCHESTRATOR_VERSION = "2026-07-20.smsOrchestrator.v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const jwt = getBearer(req);
  const admin = await verifyAdmin(jwt);
  if (!admin) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isProduction =
    !!Deno.env.get("DENO_DEPLOYMENT_ID") || Deno.env.get("APP_ENV") === "production";

  // Durability metrics for inbound CallRail events. Read-only counts; never
  // returns raw payloads or secrets.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const countByStatus = async (status: string) => {
    const { count } = await supabase
      .from("callrail_inbound_events")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    return count ?? 0;
  };
  const [pending, retryPending, failed, processed] = await Promise.all([
    countByStatus("received"),
    countByStatus("retry_pending"),
    countByStatus("failed"),
    countByStatus("processed"),
  ]);
  const { data: lastProcessed } = await supabase
    .from("callrail_inbound_events")
    .select("received_at, processed_at")
    .eq("status", "processed")
    .order("processed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: oldestUnprocessed } = await supabase
    .from("callrail_inbound_events")
    .select("received_at")
    .in("status", ["received", "retry_pending"])
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: nextRetry } = await supabase
    .from("callrail_inbound_events")
    .select("next_attempt_at")
    .eq("status", "retry_pending")
    .not("next_attempt_at", "is", null)
    .order("next_attempt_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const body = {
    app_url: getAppUrl(),
    environment: isProduction ? "production" : "preview",
    scheduling_model: Deno.env.get("AI_SCHEDULING_MODEL") ?? Deno.env.get("AI_MODEL") ?? "google/gemini-2.5-flash",
    orchestrator_version: ORCHESTRATOR_VERSION,
    secrets: {
      callrail_webhook_secret_configured: !!Deno.env.get("CALLRAIL_WEBHOOK_SECRET"),
      resend_webhook_secret_configured: !!Deno.env.get("RESEND_WEBHOOK_SECRET"),
      lovable_api_key_configured: !!Deno.env.get("LOVABLE_API_KEY"),
      callrail_api_configured: !!Deno.env.get("CALLRAIL_API_KEY"),
    },
    callrail_durability: {
      pending_count: pending,
      retry_pending_count: retryPending,
      failed_count: failed,
      processed_count: processed,
      last_processed_at: lastProcessed?.processed_at ?? null,
      oldest_unprocessed_received_at: oldestUnprocessed?.received_at ?? null,
      next_retry_at: nextRetry?.next_attempt_at ?? null,
      auto_retries_enabled: true,
    },
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
