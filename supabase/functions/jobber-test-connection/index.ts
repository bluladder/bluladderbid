import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getJobberAccessToken } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lightweight test query - just fetch account info
const TEST_QUERY = `
  query TestConnection {
    account {
      id
      name
    }
  }
`;

interface AccountResponse {
  account: {
    id: string;
    name: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authentication
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } }
  });

  // Verify user is admin
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsError } = await supabaseAnon.auth.getClaims(token);
  
  if (claimsError || !claims?.claims?.sub) {
    return new Response(
      JSON.stringify({ error: "Invalid token" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const userId = claims.claims.sub as string;
  
  const { data: hasRole } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  
  if (!hasRole) {
    return new Response(
      JSON.stringify({ error: "Admin access required" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
    );
  }

  try {
    console.log("[TestConnection] Getting access token...");
    const accessToken = await getJobberAccessToken();
    
    if (!accessToken) {
      return new Response(
        JSON.stringify({ 
          connected: false,
          error: "No valid Jobber access token",
          message: "Please reconnect to Jobber"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log("[TestConnection] Making test API call...");
    const startTime = Date.now();
    
    const response = await fetch("https://api.getjobber.com/api/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
      },
      body: JSON.stringify({ query: TEST_QUERY }),
    });

    const latencyMs = Date.now() - startTime;

    // Extract rate limit headers
    const rateLimitHeaders = {
      limit: response.headers.get("X-RateLimit-Limit"),
      remaining: response.headers.get("X-RateLimit-Remaining"),
      reset: response.headers.get("X-RateLimit-Reset"),
      retryAfter: response.headers.get("Retry-After"),
    };

    console.log("[TestConnection] Rate limit headers:", rateLimitHeaders);

    if (response.status === 429) {
      return new Response(
        JSON.stringify({
          connected: true,
          throttled: true,
          message: "Connection works but API is currently throttled",
          rateLimit: rateLimitHeaders,
          latencyMs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TestConnection] API error:", errorText);
      return new Response(
        JSON.stringify({
          connected: false,
          error: `API error: ${response.status}`,
          details: errorText,
          latencyMs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const result: { data?: AccountResponse; errors?: Array<{ message: string; extensions?: { code?: string } }> } = await response.json();

    // Check for GraphQL errors
    if (result.errors?.length) {
      const isThrottled = result.errors.some(e => e.extensions?.code === "THROTTLED");
      
      if (isThrottled) {
        return new Response(
          JSON.stringify({
            connected: true,
            throttled: true,
            message: "Connection works but API is currently throttled",
            rateLimit: rateLimitHeaders,
            latencyMs,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          connected: false,
          error: result.errors[0]?.message || "GraphQL error",
          latencyMs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Success!
    return new Response(
      JSON.stringify({
        connected: true,
        throttled: false,
        accountName: result.data?.account?.name,
        accountId: result.data?.account?.id,
        rateLimit: rateLimitHeaders,
        latencyMs,
        message: "Jobber connection is healthy",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    console.error("[TestConnection] Error:", error);
    
    return new Response(
      JSON.stringify({
        connected: false,
        error: error instanceof Error ? error.message : "Connection test failed",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }
});
