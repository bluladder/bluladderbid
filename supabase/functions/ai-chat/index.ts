// ============================================================================
// ai-chat — public HTTP boundary for the BluLadder website chat widget.
// The ONLY thing the browser talks to. It:
//   * rate-limits and validates input
//   * loads/creates a conversation scoped to the caller's session token
//   * persists messages
//   * runs the channel-independent orchestrator (shared with future voice)
//   * returns only customer-safe state (no internal IDs, no prices it invented)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runOrchestrator } from "../_shared/aiOrchestrator.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_MESSAGE_LEN = 2000;
const MAX_MESSAGES_PER_CONVO = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rl = rateLimit(req, { limit: 20, windowMs: 60000 });
  if (!rl.allowed) return json({ error: "Too many messages, please slow down." }, 429);

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400);

    const sessionToken = String((body as any).sessionToken || "").slice(0, 100);
    const rawMessage = (body as any).message;
    if (!sessionToken || !/^[A-Za-z0-9_-]{8,100}$/.test(sessionToken)) {
      return json({ error: "Invalid session" }, 400);
    }
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) {
      return json({ error: "Empty message" }, 400);
    }
    const message = rawMessage.slice(0, MAX_MESSAGE_LEN);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let { data: convo } = await supabase
      .from("chat_conversations")
      .select("id, session_token")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (!convo) {
      const { data: created, error } = await supabase
        .from("chat_conversations")
        .insert({ session_token: sessionToken, channel: "web", campaign_status: "chat_lead_created" })
        .select("id, session_token")
        .single();
      if (error || !created) return json({ error: "Could not start chat" }, 500);
      convo = created;
    }

    const { data: msgRows } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convo.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES_PER_CONVO);

    const history = (msgRows ?? [])
      .filter((m) => typeof m.content === "string" && m.content.length > 0)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

    if (history.length >= MAX_MESSAGES_PER_CONVO) {
      return json({ error: "This conversation is quite long — let me connect you with the team.", conversationEnded: true }, 200);
    }

    await supabase.from("chat_messages").insert({ conversation_id: convo.id, role: "user", content: message });

    const result = await runOrchestrator({
      supabase, conversationId: convo.id, sessionToken, channel: "web", history, userMessage: message,
    });

    await supabase.from("chat_messages").insert({ conversation_id: convo.id, role: "assistant", content: result.reply });
    await supabase.from("chat_conversations").update({ last_activity_at: new Date().toISOString() }).eq("id", convo.id);

    return json({ reply: result.reply, events: result.events });
  } catch (e) {
    console.error("ai-chat error:", e instanceof Error ? e.message : e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
