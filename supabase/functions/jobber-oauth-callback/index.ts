import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    
    // Get the frontend URL for redirects
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://bluladderbid.lovable.app";
    
    if (error) {
      console.error("OAuth error:", error);
      return Response.redirect(`${frontendUrl}/admin?jobber_error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return Response.redirect(`${frontendUrl}/admin?jobber_error=no_code`);
    }

    // Exchange code for tokens
    const clientId = Deno.env.get("JOBBER_CLIENT_ID");
    const clientSecret = Deno.env.get("JOBBER_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!clientId || !clientSecret) {
      console.error("Missing Jobber credentials");
      return Response.redirect(`${frontendUrl}/admin?jobber_error=missing_credentials`);
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://api.getjobber.com/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${supabaseUrl}/functions/v1/jobber-oauth-callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return Response.redirect(`${frontendUrl}/admin?jobber_error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    console.log("Jobber token response:", JSON.stringify(tokenData, null, 2));
    
    // Calculate expiration time - default to 1 hour if not provided
    const expiresInSeconds = parseInt(tokenData.expires_in || tokenData.expiresIn || "3600");
    console.log("Calculated expires_in seconds:", expiresInSeconds);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    console.log("Expiration date:", expiresAt.toISOString());

    // Store tokens in Supabase
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete any existing tokens (single admin connection)
    await supabase.from("jobber_oauth_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert new tokens
    const { error: insertError } = await supabase.from("jobber_oauth_tokens").insert({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt.toISOString(),
      scope: tokenData.scope || null,
    });

    if (insertError) {
      console.error("Failed to store tokens:", insertError);
      return Response.redirect(`${frontendUrl}/admin?jobber_error=storage_failed`);
    }

    console.log("Jobber OAuth successful, tokens stored");
    return Response.redirect(`${frontendUrl}/admin?jobber_success=true`);
    
  } catch (error) {
    console.error("OAuth callback error:", error);
    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://bluladderbid.lovable.app";
    return Response.redirect(`${frontendUrl}/admin?jobber_error=unknown`);
  }
});
