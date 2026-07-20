// ============================================================================
// chat-quote — RETIRED. Kept as a thin 410 Gone stub so any stale caller gets
// a deterministic response instead of silently duplicating logic. The
// canonical AI + pricing path is `ai-chat` (browser chat) and `calculate-quote`
// (server-authoritative pricing). This endpoint no longer:
//   * hosts its own AI prompt
//   * chooses its own model
//   * computes prices
//   * persists quotes
//   * defines its own tools
// If you land here from an old client, migrate to `ai-chat`.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({
      error: "gone",
      message:
        "chat-quote has been retired. Use the canonical ai-chat endpoint for conversational quotes and calculate-quote for server-authoritative pricing.",
      canonical_endpoints: { chat: "ai-chat", pricing: "calculate-quote" },
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
