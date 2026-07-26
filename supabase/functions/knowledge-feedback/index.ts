// ============================================================================
// knowledge-feedback — public "Report a bad AI answer" endpoint.
// Rate-limited, bounded input; writes go through the report_knowledge_feedback
// SECURITY DEFINER RPC so anon callers can file a report without any table
// grants on knowledge_feedback itself. Never exposes internal knowledge IDs.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const rl = rateLimit(req, { limit: 5, windowMs: 60000 });
  if (!rl.allowed) return json({ error: "Too many reports — please try again in a minute." }, 429);

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid request" }, 400);

    const conversationId = typeof body.conversationId === "string" ? body.conversationId.slice(0, 64) : null;
    const messageId      = typeof body.messageId      === "string" ? body.messageId.slice(0, 64)      : null;
    const answerText     = typeof body.answerText     === "string" ? body.answerText.slice(0, 4000)   : "";
    const reporterNote   = typeof body.reporterNote   === "string" ? body.reporterNote.slice(0, 2000) : "";
    if (!answerText && !reporterNote) return json({ error: "Empty report" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Pull provenance server-side from the message row so a caller cannot
    // fabricate the knowledge_keys attribution.
    let keys: string[] = [];
    if (messageId) {
      const { data: msg } = await supabase
        .from("chat_messages").select("ai_metadata").eq("id", messageId).maybeSingle();
      const meta = (msg?.ai_metadata ?? {}) as Record<string, unknown>;
      const rk = meta.retrieved_knowledge_keys;
      if (Array.isArray(rk)) keys = rk.filter((k) => typeof k === "string").slice(0, 20) as string[];
    }

    const { data, error } = await supabase.rpc("report_knowledge_feedback", {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_knowledge_keys: keys,
      p_answer_text: answerText,
      p_reporter_note: reporterNote,
      p_created_by: null,
    });
    if (error) return json({ error: "Could not record feedback" }, 500);
    return json({ ok: true, id: data });
  } catch {
    return json({ error: "Something went wrong" }, 500);
  }
});