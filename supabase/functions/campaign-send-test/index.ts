// ============================================================================
// campaign-send-test — admin-only endpoint that renders a single campaign
// step and (optionally) sends it as a test email to a supplied recipient.
//
// Never enrolls, never writes a campaign_message row, never touches the real
// audience. All sends flow through the canonical `sendEmail` path so the
// global email suppression list still blocks known-bad addresses.
//
// Actions:
//   POST { action: "preview", step_id }                → { subject, html }
//   POST { action: "send_test", step_id, to }          → { ok, providerId? }
//   POST { action: "audience_estimate", campaign_id }  → { active, total, suppressed }
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { sendEmail } from "../_shared/emailConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function renderSample(tpl: string): string {
  // Deterministic sample tokens — enough to make the preview realistic.
  const sample: Record<string, string> = {
    first_name: "Sample",
    customer_first_name: "Sample",
    customer_name: "Sample Customer",
    quote_url: "https://quote.bluladder.com/quote/preview",
    booking_management_url: "https://quote.bluladder.com/booking/preview",
    quote_total: "$1,240",
    scheduled_date: "the day of your service",
    service_summary: "Full-service window cleaning + soft-wash house wash",
    business_name: "BluLadder",
    support_phone: "(469) 747-2877",
  };
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => sample[k] ?? `{{${k}}}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authz = await requireAdminOrService(req);
  if (!authz.ok) {
    const hadToken = !!req.headers.get("Authorization");
    return json({ error: hadToken ? "Forbidden" : "Unauthorized" }, hadToken ? 403 : 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: {
    action?: "preview" | "send_test" | "audience_estimate";
    step_id?: string;
    campaign_id?: string;
    to?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "preview" || body.action === "send_test") {
    if (!body.step_id) return json({ error: "step_id required" }, 400);
    const { data: step, error } = await supabase
      .from("sms_campaign_steps")
      .select("id, channel, subject, body_template, campaign_id")
      .eq("id", body.step_id)
      .maybeSingle();
    if (error || !step) return json({ error: "Step not found" }, 404);
    if (step.channel !== "email") return json({ error: "Only email steps are previewable here" }, 400);

    const subject = renderSample(step.subject ?? "");
    const html = renderSample(step.body_template ?? "");

    if (body.action === "preview") {
      return json({ subject, html, step_id: step.id, campaign_id: step.campaign_id });
    }

    const to = (body.to ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: "Valid `to` email required" }, 400);
    const result = await sendEmail({ to, subject: `[TEST] ${subject}`, html });
    return json({
      ok: result.ok,
      providerMessageId: result.providerMessageId,
      failure: result.ok ? null : result.failure,
    }, result.ok ? 200 : 502);
  }

  if (body.action === "audience_estimate") {
    if (!body.campaign_id) return json({ error: "campaign_id required" }, 400);
    // Bounded, coarse counts — enough for the admin to sanity-check scope.
    const [{ count: active }, { count: total }, { count: suppressed }] = await Promise.all([
      supabase.from("campaign_enrollments").select("id", { count: "exact", head: true })
        .eq("campaign_id", body.campaign_id).eq("status", "active"),
      supabase.from("campaign_enrollments").select("id", { count: "exact", head: true })
        .eq("campaign_id", body.campaign_id),
      supabase.from("campaign_enrollments").select("id", { count: "exact", head: true })
        .eq("campaign_id", body.campaign_id).eq("suppressed", true),
    ]);
    return json({
      active: active ?? 0,
      total: total ?? 0,
      suppressed: suppressed ?? 0,
    });
  }

  return json({ error: "Unknown action" }, 400);
});
