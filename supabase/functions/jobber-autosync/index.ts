import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getJobberAccessToken } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= Configuration =============
const CONFIG = {
  // Near-term sync: refresh frequently, covers next 30 days
  nearTermHorizonDays: 30,
  nearTermMinIntervalMinutes: 15,
  
  // Far-term sync: expand gradually to 365 days, add 30 days per run
  farTermChunkDays: 30,
  farTermMaxHorizonDays: 365,
  farTermMinIntervalHours: 24,
  
  // Rate limiting for Jobber API
  minRequestDelayMs: 2000,
  maxRequestDelayMs: 3000,
  maxRetries: 6,
  retryBaseMs: 1000,
  retryMultiplier: 2,
  retryCapMs: 30000,
  
  // Per-chunk settings
  chunkDays: 1,
  pageSize: 100,
  maxPagesPerChunk: 20,
};

interface Visit {
  id: string;
  startAt: string;
  endAt: string;
  assignedUsers: { nodes: Array<{ id: string; name: { full: string } }> };
  job: {
    id: string;
    property: {
      address: {
        street: string;
        city: string;
        province: string;
        postalCode: string;
      };
    };
    client: { name: string };
  };
}

interface VisitsResponse {
  visits: {
    nodes: Visit[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

interface GraphQLResult<T> {
  data?: T;
  errors?: GraphQLError[];
}

// ============= Rate-Limited GraphQL Client =============
let lastRequestTime = 0;

async function rateLimitedDelay(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const targetDelay = CONFIG.minRequestDelayMs + 
    Math.random() * (CONFIG.maxRequestDelayMs - CONFIG.minRequestDelayMs);
  
  if (elapsed < targetDelay) {
    await new Promise(resolve => setTimeout(resolve, targetDelay - elapsed));
  }
  lastRequestTime = Date.now();
}

function calculateBackoff(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const retryAfterSeconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(retryAfterSeconds)) {
      return Math.min(retryAfterSeconds * 1000, CONFIG.retryCapMs);
    }
  }
  
  const baseDelay = CONFIG.retryBaseMs * Math.pow(CONFIG.retryMultiplier, attempt);
  const jitter = Math.random() * 0.3 * baseDelay;
  return Math.min(baseDelay + jitter, CONFIG.retryCapMs);
}

async function jobberGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphQLResult<T>> {
  const accessToken = await getJobberAccessToken();
  
  if (!accessToken) {
    return { errors: [{ message: "No valid Jobber access token" }] };
  }

  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    await rateLimitedDelay();
    
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

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const backoff = calculateBackoff(attempt, retryAfter);
        console.log(`[Throttle] 429 received, backing off ${Math.round(backoff)}ms`);
        
        if (attempt < CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        return { errors: [{ message: "Rate limit exceeded after max retries" }] };
      }

      if (!response.ok) {
        return { errors: [{ message: `API error: ${response.status}` }] };
      }

      const jsonResult = await response.json() as GraphQLResult<T>;
      
      if (jsonResult.errors?.some((e: GraphQLError) => 
        e.extensions?.code === "THROTTLED"
      )) {
        const backoff = calculateBackoff(attempt);
        if (attempt < CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        return { errors: [{ message: "Throttled after max retries" }] };
      }
      
      return jsonResult;
      
    } catch (error) {
      console.error(`Request failed (attempt ${attempt + 1}):`, error);
      if (attempt < CONFIG.maxRetries) {
        const backoff = calculateBackoff(attempt);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
  
  return { errors: [{ message: "Max retries exceeded" }] };
}

// ============= Visits Query =============
const VISITS_QUERY = `
  query GetVisits($after: String, $startDate: ISO8601DateTime!, $endDate: ISO8601DateTime!) {
    visits(
      first: ${CONFIG.pageSize},
      after: $after,
      filter: {
        startAt: { after: $startDate, before: $endDate }
      }
    ) {
      nodes {
        id
        startAt
        endAt
        assignedUsers {
          nodes {
            id
            name { full }
          }
        }
        job {
          id
          property {
            address {
              street
              city
              province
              postalCode
            }
          }
          client { name }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// deno-lint-ignore no-explicit-any
async function syncChunk(
  supabase: SupabaseClient<any>,
  startDate: Date,
  endDate: Date
): Promise<{ visits: number; blocks: number; throttled: boolean }> {
  const allVisits: Visit[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let page = 0;

  console.log(`[Chunk] Syncing ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

  while (hasNextPage && page < CONFIG.maxPagesPerChunk) {
    const graphResult: GraphQLResult<VisitsResponse> = await jobberGraphQL<VisitsResponse>(VISITS_QUERY, {
      after: cursor,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    if (graphResult.errors?.some((e: GraphQLError) => 
      e.message.includes("Throttled") || e.message.includes("Rate limit")
    )) {
      console.log(`[Chunk] Throttled after ${allVisits.length} visits`);
      return { visits: allVisits.length, blocks: 0, throttled: true };
    }

    if (graphResult.errors) {
      console.error("[Chunk] API errors:", graphResult.errors);
      break;
    }

    const visitsData = graphResult.data?.visits;
    if (!visitsData) break;

    allVisits.push(...visitsData.nodes);
    hasNextPage = visitsData.pageInfo.hasNextPage;
    cursor = visitsData.pageInfo.endCursor;
    page++;

    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Upsert visits to busy blocks
  let blocksInserted = 0;
  for (const visit of allVisits) {
    const assignees = visit.assignedUsers?.nodes || [];
    
    for (const assignee of assignees) {
      const address = visit.job?.property?.address;
      const fullAddress = address 
        ? `${address.street}, ${address.city}, ${address.province} ${address.postalCode}`
        : null;

      const { error } = await supabase
        .from("jobber_busy_blocks")
        .upsert(
          {
            jobber_visit_id: visit.id,
            crew_id: assignee.id,
            start_at: visit.startAt,
            end_at: visit.endAt,
            status: 'scheduled',
            jobber_job_id: visit.job?.id || null,
            client_name: visit.job?.client?.name || null,
            client_address: fullAddress,
            source: 'jobber',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'jobber_visit_id' }
        );

      if (!error) blocksInserted++;
    }
  }

  console.log(`[Chunk] Synced ${allVisits.length} visits, ${blocksInserted} blocks`);
  return { visits: allVisits.length, blocks: blocksInserted, throttled: false };
}

// ============= Main Handler =============
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get autosync config
    const { data: config } = await supabase
      .from("autosync_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle();

    if (!config?.enabled) {
      return new Response(
        JSON.stringify({ message: "Autosync is disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const results: { nearTerm?: object; farTerm?: object } = {};

    // ============= Near-Term Sync =============
    const lastNearTerm = config.last_near_term_sync 
      ? new Date(config.last_near_term_sync)
      : null;
    
    const nearTermIntervalMs = (config.near_term_interval_minutes || CONFIG.nearTermMinIntervalMinutes) * 60 * 1000;
    const shouldRunNearTerm = !lastNearTerm || 
      (now.getTime() - lastNearTerm.getTime() >= nearTermIntervalMs);

    if (shouldRunNearTerm) {
      console.log("[Autosync] Running near-term sync...");
      
      const nearTermDays = config.near_term_horizon_days || CONFIG.nearTermHorizonDays;
      const nearTermEnd = new Date(now.getTime() + nearTermDays * 24 * 60 * 60 * 1000);
      
      let totalVisits = 0;
      let totalBlocks = 0;
      let throttled = false;
      
      // Sync in 1-day chunks
      let currentStart = new Date(now);
      while (currentStart < nearTermEnd && !throttled) {
        const currentEnd = new Date(currentStart.getTime() + CONFIG.chunkDays * 24 * 60 * 60 * 1000);
        
        const chunkResult = await syncChunk(supabase, currentStart, currentEnd);
        totalVisits += chunkResult.visits;
        totalBlocks += chunkResult.blocks;
        throttled = chunkResult.throttled;
        
        currentStart = currentEnd;
      }
      
      // Update last sync time
      await supabase
        .from("autosync_config")
        .update({ 
          last_near_term_sync: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", "default");
      
      results.nearTerm = {
        syncedDays: nearTermDays,
        totalVisits,
        totalBlocks,
        throttled,
      };
      
      console.log(`[Autosync] Near-term complete: ${totalVisits} visits, ${totalBlocks} blocks`);
    }

    // ============= Far-Term Sync =============
    const lastFarTerm = config.last_far_term_sync 
      ? new Date(config.last_far_term_sync)
      : null;
    
    const farTermIntervalMs = (config.far_term_daily_chunk_days || 1) * 24 * 60 * 60 * 1000;
    const shouldRunFarTerm = !lastFarTerm || 
      (now.getTime() - lastFarTerm.getTime() >= farTermIntervalMs);

    const currentHorizon = config.far_term_current_horizon_days || CONFIG.nearTermHorizonDays;
    const maxHorizon = config.far_term_max_horizon_days || CONFIG.farTermMaxHorizonDays;
    
    if (shouldRunFarTerm && currentHorizon < maxHorizon) {
      console.log("[Autosync] Running far-term sync...");
      
      const chunkDays = config.far_term_daily_chunk_days || CONFIG.farTermChunkDays;
      const newHorizon = Math.min(currentHorizon + chunkDays, maxHorizon);
      
      // Sync the new chunk (from currentHorizon to newHorizon)
      const chunkStart = new Date(now.getTime() + currentHorizon * 24 * 60 * 60 * 1000);
      const chunkEnd = new Date(now.getTime() + newHorizon * 24 * 60 * 60 * 1000);
      
      let totalVisits = 0;
      let totalBlocks = 0;
      let throttled = false;
      
      let currentStart = new Date(chunkStart);
      while (currentStart < chunkEnd && !throttled) {
        const currentEnd = new Date(currentStart.getTime() + CONFIG.chunkDays * 24 * 60 * 60 * 1000);
        
        const chunkResult = await syncChunk(supabase, currentStart, currentEnd);
        totalVisits += chunkResult.visits;
        totalBlocks += chunkResult.blocks;
        throttled = chunkResult.throttled;
        
        currentStart = currentEnd;
      }
      
      // Update horizon and last sync time
      await supabase
        .from("autosync_config")
        .update({ 
          last_far_term_sync: now.toISOString(),
          far_term_current_horizon_days: throttled ? currentHorizon : newHorizon,
          updated_at: now.toISOString(),
        })
        .eq("id", "default");
      
      results.farTerm = {
        previousHorizon: currentHorizon,
        newHorizon: throttled ? currentHorizon : newHorizon,
        totalVisits,
        totalBlocks,
        throttled,
      };
      
      console.log(`[Autosync] Far-term complete: horizon ${currentHorizon} -> ${newHorizon}`);
    }

    // Also update the main sync state for availability engine
    if (results.nearTerm || results.farTerm) {
      await supabase
        .from("jobber_sync_state")
        .upsert({
          id: "default",
          last_backfill_at: now.toISOString(),
          backfill_in_progress: false,
          updated_at: now.toISOString(),
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: now.toISOString(),
        ...results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Autosync] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Autosync failed", 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
