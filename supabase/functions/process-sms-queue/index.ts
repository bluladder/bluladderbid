import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCallRailConfig, sendCallRailSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Processes due, pending SMS (campaign follow-ups + any retries). Invoked by cron.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const config = getCallRailConfig();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("sms_messages")
    .select("id, to_number, body, attempts")
    .eq("status", "pending")
    .lte("send_at", nowIso)
    .order("send_at", { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;

  for (const msg of due || []) {
    if (!config) {
      await supabase.from("sms_messages").update({
        status: "failed", error: "CallRail not configured", attempts: (msg.attempts ?? 0) + 1,
      }).eq("id", msg.id);
      failed++;
      continue;
    }
    const result = await sendCallRailSms(config, msg.to_number as string, msg.body as string);
    if (result.ok) {
      await supabase.from("sms_messages").update({
        status: "sent", sent_at: new Date().toISOString(),
        callrail_message_id: result.messageId ?? null, attempts: (msg.attempts ?? 0) + 1, error: null,
      }).eq("id", msg.id);
      sent++;
    } else {
      const attempts = (msg.attempts ?? 0) + 1;
      // Give up after 3 attempts; otherwise leave pending for the next run.
      await supabase.from("sms_messages").update({
        status: attempts >= 3 ? "failed" : "pending", error: result.error ?? "send failed", attempts,
      }).eq("id", msg.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: (due || []).length, sent, failed }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});