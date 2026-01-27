import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface JobberTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

// Get valid Jobber access token, refreshing if needed
export async function getJobberAccessToken(): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get current tokens
  const { data: tokens, error } = await supabase
    .from("jobber_oauth_tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !tokens) {
    console.error("No Jobber tokens found:", error);
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  let expiresAt: Date;
  try {
    expiresAt = new Date(tokens.expires_at);
    if (isNaN(expiresAt.getTime())) {
      throw new Error("Invalid expires_at date");
    }
  } catch (error) {
    console.error("Invalid token expiration date, forcing refresh:", error);
    // Force refresh by setting expiration to past
    expiresAt = new Date(0);
  }
  
  const now = new Date(Date.now() + 5 * 60 * 1000);

  if (now < expiresAt) {
    return tokens.access_token;
  }

  // Token expired, refresh it
  console.log("Refreshing Jobber access token...");
  
  const clientId = Deno.env.get("JOBBER_CLIENT_ID");
  const clientSecret = Deno.env.get("JOBBER_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("Missing Jobber credentials for refresh");
    return null;
  }

  const refreshResponse = await fetch("https://api.getjobber.com/api/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!refreshResponse.ok) {
    const errorText = await refreshResponse.text();
    console.error("Token refresh failed:", errorText);
    return null;
  }

  const newTokenData = await refreshResponse.json();
  
  // Safely parse expires_in - default to 1 hour if not provided
  const expiresInSeconds = parseInt(String(newTokenData.expires_in || 3600), 10);
  if (isNaN(expiresInSeconds) || expiresInSeconds <= 0) {
    console.error("Invalid expires_in value:", newTokenData.expires_in);
    return null;
  }
  const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  // Update tokens in database
  const { error: updateError } = await supabase
    .from("jobber_oauth_tokens")
    .update({
      access_token: newTokenData.access_token,
      refresh_token: newTokenData.refresh_token,
      expires_at: newExpiresAt.toISOString(),
    })
    .eq("id", tokens.id);

  if (updateError) {
    console.error("Failed to update tokens:", updateError);
  }

  return newTokenData.access_token;
}

// Execute GraphQL query against Jobber API
export async function jobberGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const accessToken = await getJobberAccessToken();
  
  if (!accessToken) {
    return { errors: [{ message: "No valid Jobber access token" }] };
  }

  const response = await fetch("https://api.getjobber.com/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Jobber API error:", errorText);
    return { errors: [{ message: `API error: ${response.status}` }] };
  }

  return await response.json();
}
