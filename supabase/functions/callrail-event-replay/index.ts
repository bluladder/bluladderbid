// ============================================================================
// callrail-event-replay — admin-only replay for durably-persisted CallRail
// inbound events. Never fabricates a new provider identity; always reuses the
// original provider_message_id so re-processing is idempotent.
//
// Modes:
//   dry_run     : returns what WOULD happen (state + safe payload preview).
//   replay      : atomically claims the existing receipt row (SELECT ... FOR
//                 UPDATE) via `claim_callrail_event_for_replay`, records who
//                 requested the replay and when, then invokes the SAME
//                 canonical persisted-event processor used by the initial
//                 webhook and the automatic retry sweep. Never re-inserts
//                 the provider event, never mints a new provider_message_id,
//                 never duplicates the inbound sms_messages row, AI reply,
//                 campaign event, opt-in/opt-out, or BOOK-IT reply.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAdmin, getBearer } from "../_shared/auth.ts";
import { processPersistedCallRailEvent } from "../_shared/callrailEventProcessor.ts";

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
  const actorId: string | null = typeof admin === "string" ? admin : null;

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
        replay_count: row.replay_count ?? 0,
        replay_requested_by: row.replay_requested_by ?? null,
        replay_requested_at: row.replay_requested_at ?? null,
        payload_preview: row.payload_safe,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Atomically claim the row for reprocessing (records replay actor + time,
  // increments replay_count, clears error state, sets status='processing').
  // If the row is already in 'processing' from a concurrent worker we back
  // off rather than double-processing.
  const { data: claim, error: claimErr } = await supabase
    .rpc("claim_callrail_event_for_replay", { _id: row.id, _actor: actorId });
  if (claimErr) {
    return new Response(JSON.stringify({ error: "claim_failed", detail: claimErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const claimed = Array.isArray(claim) && claim.length > 0 ? claim[0] : null;
  if (!claimed) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if ((claimed as { prior_status?: string }).prior_status === "processing") {
    return new Response(JSON.stringify({
      ok: false, error: "already_processing",
      note: "Another worker is currently processing this event. Try again shortly.",
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Invoke the SAME canonical processor used by the initial webhook and the
  // automatic retry sweep. The processor is idempotent — no duplicate SMS,
  // AI reply, campaign event, opt-in/out, or BOOK-IT auto-reply is emitted.
  const result = await processPersistedCallRailEvent(supabase, row.id);

  return new Response(JSON.stringify({
    ok: result.ok,
    mode,
    event_id: row.id,
    provider_message_id: row.provider_message_id,
    action: result.action,
    replay_actor: actorId,
    replayed_at: new Date().toISOString(),
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
