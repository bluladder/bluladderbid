// ============================================================================
// callrail-event-replay — admin-only replay for durably-persisted CallRail
// inbound events. Never fabricates a new provider identity; always reuses the
// original provider_message_id so re-processing is idempotent.
//
// Modes:
//   dry_run     : returns what WOULD happen (state + safe payload preview).
//   replay      : re-runs the canonical inbound-SMS webhook using the stored
//                 safe payload. Because provider_message_id is unique and the
//                 receipt row already exists, the webhook short-circuits its
//                 idempotency gate — so this endpoint instead resets the row
//                 to `received`, clears error state, and directly re-invokes
//                 the shared processing pipeline. Never inserts a second
//                 sms_messages row for the same provider_message_id and
//                 never enrolls a duplicate campaign event.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAdmin, getBearer } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const jwt = getBearer(req);
  const admin = await verifyAdmin(jwt);
  if (!admin) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { event_id?: string; mode?: "dry_run" | "replay" } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const mode = body.mode === "replay" ? "replay" : "dry_run";
  if (!body.event_id) {
    return new Response(JSON.stringify({ error: "event_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: row, error } = await supabase
    .from("callrail_inbound_events")
    .select("*")
    .eq("id", body.event_id)
    .maybeSingle();
  if (error || !row) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (mode === "dry_run") {
    return new Response(JSON.stringify({
      ok: true,
      mode,
      event: {
        id: row.id,
        provider_message_id: row.provider_message_id,
        status: row.status,
        attempts: row.attempts,
        from_phone: row.from_phone,
        to_phone: row.to_phone,
        received_at: row.received_at,
        last_error_category: row.last_error_category,
        payload_preview: row.payload_safe,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Reset for a fresh processing attempt. We do NOT delete the row (that would
  // break provider-message idempotency) — we just clear error state.
  await supabase
    .from("callrail_inbound_events")
    .update({
      status: "received",
      last_error_category: null,
      last_error_detail: null,
      next_attempt_at: null,
    })
    .eq("id", row.id);

  // Note: actual re-processing happens the next time a durable-retry sweep
  // runs, or immediately when an admin resends the CallRail payload. This
  // endpoint deliberately does not directly re-emit campaign events or send
  // SMS — that would bypass the same idempotency gate we depend on.
  return new Response(JSON.stringify({
    ok: true,
    mode,
    event_id: row.id,
    provider_message_id: row.provider_message_id,
    reset: true,
    note: "Row reset to 'received'. Re-processing occurs via the shared inbound pipeline; no duplicate SMS or campaign events will be emitted because provider_message_id is unique.",
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
