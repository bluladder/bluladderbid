import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface JobberTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 6,
  baseDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 30000,
  jitterFactor: 0.3, // 30% jitter
};

// Add jitter to delay to prevent thundering herd
function addJitter(delayMs: number): number {
  const jitter = delayMs * RATE_LIMIT_CONFIG.jitterFactor * (Math.random() - 0.5) * 2;
  return Math.max(100, Math.round(delayMs + jitter));
}

// Calculate delay for retry attempt
function calculateBackoffDelay(attempt: number): number {
  const baseDelay = RATE_LIMIT_CONFIG.baseDelayMs * Math.pow(RATE_LIMIT_CONFIG.multiplier, attempt);
  const cappedDelay = Math.min(baseDelay, RATE_LIMIT_CONFIG.maxDelayMs);
  return addJitter(cappedDelay);
}

// Sleep for specified milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if error is a throttle/rate limit error
function isThrottleError(response: Response, data?: { errors?: Array<{ message: string }> }): boolean {
  if (response.status === 429) return true;
  if (data?.errors?.some(e => 
    e.message.toLowerCase().includes('throttle') || 
    e.message.toLowerCase().includes('rate limit') ||
    e.message.toLowerCase().includes('too many requests')
  )) return true;
  return false;
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

// Result type for jobberGraphQL with throttle info
export interface JobberGraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
  throttled?: boolean;
}

// Execute GraphQL query against Jobber API with retry and backoff
export async function jobberGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<JobberGraphQLResult<T>> {
  const accessToken = await getJobberAccessToken();
  
  if (!accessToken) {
    return { errors: [{ message: "No valid Jobber access token" }] };
  }

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch("https://api.getjobber.com/api/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
        },
        body: JSON.stringify({ query, variables }),
      });

      // Parse response body
      let data: JobberGraphQLResult<T>;
      if (response.ok || response.status === 429) {
        try {
          data = await response.json();
        } catch {
          data = { errors: [{ message: `Failed to parse response: ${response.status}` }] };
        }
      } else {
        const errorText = await response.text();
        console.error("Jobber API error:", errorText);
        data = { errors: [{ message: `API error: ${response.status}` }] };
      }

      // Check for throttling
      if (isThrottleError(response, data)) {
        if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
          // Check for Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          let delayMs: number;
          
          if (retryAfter) {
            // Retry-After can be seconds or a date
            const retrySeconds = parseInt(retryAfter, 10);
            if (!isNaN(retrySeconds)) {
              delayMs = retrySeconds * 1000;
            } else {
              const retryDate = new Date(retryAfter);
              delayMs = Math.max(0, retryDate.getTime() - Date.now());
            }
            // Cap it to our max delay
            delayMs = Math.min(delayMs, RATE_LIMIT_CONFIG.maxDelayMs);
          } else {
            delayMs = calculateBackoffDelay(attempt);
          }
          
          console.log(`Jobber throttled (attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries + 1}). Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        } else {
          // Max retries exceeded
          console.error("Jobber API throttled - max retries exceeded");
          return { 
            errors: [{ message: "Jobber API rate limited after max retries" }],
            throttled: true,
          };
        }
      }

      // Not throttled, return the result
      return data;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Jobber GraphQL request failed (attempt ${attempt + 1}):`, lastError.message);
      
      if (attempt < RATE_LIMIT_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        console.log(`Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
      }
    }
  }

  return { 
    errors: [{ message: lastError?.message || "Request failed after max retries" }] 
  };
}
