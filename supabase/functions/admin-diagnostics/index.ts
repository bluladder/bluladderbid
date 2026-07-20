// ============================================================================
// admin-diagnostics — read-only launch-integrity view for admins. Returns the
// resolved production app URL, the scheduling/AI model in use, the current
// prompt/orchestrator version, and whether provider webhook secrets are
// configured. NEVER returns secret values — only presence booleans.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
  if (!admin.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isProduction =
    !!Deno.env.get("DENO_DEPLOYMENT_ID") || Deno.env.get("APP_ENV") === "production";

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
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
