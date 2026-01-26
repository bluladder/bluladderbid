import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getJobberAccessToken } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if we have stored tokens
    const { data: tokens, error } = await supabase
      .from("jobber_oauth_tokens")
      .select("expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !tokens) {
      return new Response(
        JSON.stringify({ connected: false, message: "No Jobber connection found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to get a valid access token (will refresh if needed)
    const accessToken = await getJobberAccessToken();

    if (!accessToken) {
      return new Response(
        JSON.stringify({ connected: false, message: "Jobber connection expired, please reconnect" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        connected: true,
        connectedSince: tokens.created_at,
        message: "Jobber is connected",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Connection status error:", error);
    return new Response(
      JSON.stringify({ connected: false, message: "Error checking Jobber connection" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
