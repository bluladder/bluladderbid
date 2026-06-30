import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getJobberAccessToken } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= Configuration =============
const CONFIG = {
  // Rate limiting: delay between successful requests (ms)
  // Increased from 300-500ms to prevent Jobber throttling
  minRequestDelayMs: 2000,
  maxRequestDelayMs: 3000,
  
  // Retry settings for throttled requests (exponential backoff)
  maxRetries: 6,
  retryBaseMs: 1000,      // 1s base
  retryMultiplier: 2,     // 1s, 2s, 4s, 8s, 16s, 32s
  retryCapMs: 30000,      // cap at 30s
  
  // Chunk settings - 1 day per request to minimize throttle risk
  defaultChunkDays: 1,
  defaultHorizonDays: 30,
  maxHorizonDays: 90,
  
  // Safety limits
  maxPagesPerChunk: 20,
  pageSize: 100,
};

// ============= Types =============
interface Visit {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  assignedUsers: { nodes: Array<{ id: string; name: { full: string } }> };
  job: {
    id: string;
    title: string;
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

interface SyncRun {
  id: string;
  status: string;
  from_date: string;
  to_date: string;
  chunk_days: number;
  current_cursor_date: string | null;
  chunks_completed: number;
  total_chunks: number;
  visits_synced: number;
  blocks_inserted: number;
  last_error: string | null;
}

// ============= Rate-Limited GraphQL Client =============
let lastRequestTime = 0;

async function rateLimitedDelay(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const targetDelay = CONFIG.minRequestDelayMs + 
    Math.random() * (CONFIG.maxRequestDelayMs - CONFIG.minRequestDelayMs);
  
  if (elapsed < targetDelay) {
    const waitTime = targetDelay - elapsed;
    console.log(`[RateLimit] Waiting ${Math.round(waitTime)}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastRequestTime = Date.now();
}

function calculateBackoff(attempt: number, retryAfterHeader?: string | null): number {
  // Respect Retry-After header if present
  if (retryAfterHeader) {
    const retryAfterSeconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(retryAfterSeconds)) {
      return Math.min(retryAfterSeconds * 1000, CONFIG.retryCapMs);
    }
  }
  
  // Exponential backoff with jitter
  const baseDelay = CONFIG.retryBaseMs * Math.pow(CONFIG.retryMultiplier, attempt);
  const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
  return Math.min(baseDelay + jitter, CONFIG.retryCapMs);
}

async function jobberGraphQLWithRetry<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphQLResult<T>> {
  const accessToken = await getJobberAccessToken();
  
  if (!accessToken) {
    return { errors: [{ message: "No valid Jobber access token" }] };
  }

  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    // Apply rate limiting before each request
    await rateLimitedDelay();
    
    try {
      console.log(`[Jobber] Making request (attempt ${attempt + 1}/${CONFIG.maxRetries + 1})`);
      
      const response = await fetch("https://api.getjobber.com/api/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
        },
        body: JSON.stringify({ query, variables }),
      });

      // Check for HTTP-level throttling
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const backoff = calculateBackoff(attempt, retryAfter);
        console.log(`[Throttle] HTTP 429 received. Retry-After: ${retryAfter}. Backing off ${Math.round(backoff)}ms`);
        
        if (attempt < CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        return { errors: [{ message: "Rate limit exceeded after max retries" }] };
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Jobber] API error ${response.status}:`, errorText);
        return { errors: [{ message: `API error: ${response.status}` }] };
      }

      const jsonResult: GraphQLResult<T> = await response.json();
      
      // Check for GraphQL-level throttling
      if (jsonResult.errors?.some((e: GraphQLError) => 
        e.extensions?.code === "THROTTLED"
      )) {
        const backoff = calculateBackoff(attempt);
        console.log(`[Throttle] GraphQL THROTTLED error. Backing off ${Math.round(backoff)}ms`);
        
        if (attempt < CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        
        return { errors: [{ message: "Throttled after max retries" }] };
      }
      
      // Success!
      return jsonResult;
      
    } catch (error) {
      console.error(`[Jobber] Request failed (attempt ${attempt + 1}):`, error);
      
      if (attempt < CONFIG.maxRetries) {
        const backoff = calculateBackoff(attempt);
        console.log(`[Retry] Waiting ${Math.round(backoff)}ms before retry`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
      throw error;
    }
  }
  
  return { errors: [{ message: "Max retries exceeded" }] };
}

// ============= Visits Fetching =============
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
        title
        startAt
        endAt
        assignedUsers {
          nodes {
            id
            name {
              full
            }
          }
        }
        job {
          id
          title
          property {
            address {
              street
              city
              province
              postalCode
            }
          }
          client {
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

async function fetchVisitsForChunk(
  startDate: string, 
  endDate: string
): Promise<{ visits: Visit[]; throttled: boolean; error?: string }> {
  const allVisits: Visit[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let page = 0;

  const startDay = startDate.split('T')[0];
  const endDay = endDate.split('T')[0];
  console.log(`[Chunk] 📅 Fetching visits: ${startDay} to ${endDay}`);

  while (hasNextPage && page < CONFIG.maxPagesPerChunk) {
    console.log(`[Chunk]   Page ${page + 1}...`);
    
    const result: GraphQLResult<VisitsResponse> = await jobberGraphQLWithRetry<VisitsResponse>(VISITS_QUERY, {
      after: cursor,
      startDate,
      endDate,
    });

    // Check for throttle exhaustion
    if (result.errors?.some((e: GraphQLError) => 
      e.message.includes("Throttled") || 
      e.message.includes("Rate limit")
    )) {
      console.log(`[Chunk] ⚠️ Throttle exhausted after ${allVisits.length} visits`);
      return { visits: allVisits, throttled: true, error: result.errors[0]?.message };
    }

    if (result.errors) {
      console.error("[Chunk] ❌ API errors:", result.errors);
      return { visits: allVisits, throttled: false, error: result.errors[0]?.message };
    }

    const visitsData = result.data?.visits;
    if (!visitsData) {
      break;
    }

    allVisits.push(...visitsData.nodes);
    hasNextPage = visitsData.pageInfo.hasNextPage;
    cursor = visitsData.pageInfo.endCursor;
    page++;

    // Small delay between pagination requests within same chunk
    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`[Chunk] ✅ Fetched ${allVisits.length} visits in ${page} page(s)`);
  return { visits: allVisits, throttled: false };
}

// ============= Sync Logic =============
// deno-lint-ignore no-explicit-any
async function upsertVisits(
  supabase: SupabaseClient<any>,
  visits: Visit[]
): Promise<{ inserted: number; errors: number }> {
  let insertedCount = 0;
  let errorCount = 0;

  for (const visit of visits) {
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
          { onConflict: 'jobber_visit_id,crew_id' }
        );

      if (error) {
        console.error("[Upsert] Failed:", error.message);
        errorCount++;
      } else {
        insertedCount++;
      }
    }
  }

  return { inserted: insertedCount, errors: errorCount };
}

function generateChunks(
  fromDate: Date, 
  toDate: Date, 
  chunkDays: number
): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let current = new Date(fromDate);
  
  while (current < toDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
    
    chunks.push({
      start: new Date(current),
      end: chunkEnd > toDate ? new Date(toDate) : chunkEnd,
    });
    
    current = chunkEnd;
  }
  
  return chunks;
}

// ============= Main Handler =============
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
    // Parse request body
    let horizonDays = CONFIG.defaultHorizonDays;
    let chunkDays = CONFIG.defaultChunkDays;
    let resumeRunId: string | null = null;
    
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.horizonDays && body.horizonDays > 0 && body.horizonDays <= CONFIG.maxHorizonDays) {
          horizonDays = body.horizonDays;
        }
        if (body.chunkDays && body.chunkDays >= 1 && body.chunkDays <= 14) {
          chunkDays = body.chunkDays;
        }
        if (body.resumeRunId) {
          resumeRunId = body.resumeRunId;
        }
      } catch {
        // Use defaults
      }
    }

    // Check for active sync run
    const { data: activeRun } = await supabase
      .from("schedule_sync_runs")
      .select("*")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeRun) {
      const startedAt = new Date(activeRun.started_at);
      const elapsed = Date.now() - startedAt.getTime();
      
      // Allow restart if stuck for more than 10 minutes
      if (elapsed < 10 * 60 * 1000) {
        return new Response(
          JSON.stringify({ 
            error: "Sync already in progress",
            runId: activeRun.id,
            startedAt: activeRun.started_at,
            progress: `${activeRun.chunks_completed}/${activeRun.total_chunks} chunks`
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
        );
      }
      
      // Mark stale run as failed
      await supabase
        .from("schedule_sync_runs")
        .update({ status: "failed", last_error: "Timed out" })
        .eq("id", activeRun.id);
    }

    // Check for resumable partial run (auto-resume if no explicit resumeRunId)
    let syncRun: SyncRun | null = null;
    
    if (resumeRunId) {
      // Explicit resume request
      const { data: existingRun } = await supabase
        .from("schedule_sync_runs")
        .select("*")
        .eq("id", resumeRunId)
        .eq("status", "partial")
        .maybeSingle();
      
      if (existingRun) {
        syncRun = existingRun as SyncRun;
        console.log(`[Resume] Resuming run ${syncRun.id} from ${syncRun.current_cursor_date}`);
      }
    } else {
      // Auto-resume: check for any partial run from today
      const { data: partialRun } = await supabase
        .from("schedule_sync_runs")
        .select("*")
        .eq("status", "partial")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (partialRun) {
        syncRun = partialRun as SyncRun;
        console.log(`[AutoResume] Found partial run ${syncRun.id} at ${syncRun.chunks_completed}/${syncRun.total_chunks} chunks. Resuming from ${syncRun.current_cursor_date}`);
      }
    }

    // Calculate date range
    const now = new Date();
    const fromDate = new Date(now);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + horizonDays);

    // Create or update sync run
    if (!syncRun) {
      const chunks = generateChunks(fromDate, toDate, chunkDays);
      
      const { data: newRun, error: createError } = await supabase
        .from("schedule_sync_runs")
        .insert({
          status: "running",
          from_date: fromDate.toISOString().split('T')[0],
          to_date: toDate.toISOString().split('T')[0],
          chunk_days: chunkDays,
          total_chunks: chunks.length,
        })
        .select()
        .single();
      
      if (createError) throw createError;
      syncRun = newRun as SyncRun;
      
      console.log(`[Sync] Created run ${syncRun.id}: ${chunks.length} chunks, ${chunkDays} days each`);
    } else {
      await supabase
        .from("schedule_sync_runs")
        .update({ status: "running" })
        .eq("id", syncRun.id);
    }

    // Generate chunks for processing
    const startFrom = syncRun.current_cursor_date 
      ? new Date(syncRun.current_cursor_date)
      : new Date(syncRun.from_date);
    const endAt = new Date(syncRun.to_date);
    
    const chunks = generateChunks(startFrom, endAt, syncRun.chunk_days);
    console.log(`[Sync] Processing ${chunks.length} chunks from ${startFrom.toISOString().split('T')[0]}`);

    let totalVisits = syncRun.visits_synced;
    let totalBlocks = syncRun.blocks_inserted;
    let chunksCompleted = syncRun.chunks_completed;
    let lastSuccessfulDate = startFrom;
    let throttled = false;
    let lastError: string | null = null;

    // Process chunks sequentially with delays
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = chunk.start.toISOString();
      const chunkEnd = chunk.end.toISOString();
      const chunkDay = chunkStart.split('T')[0];
      
      console.log(`\n[Sync] ━━━ Chunk ${i + 1}/${chunks.length}: ${chunkDay} ━━━`);

      // Fetch visits for this chunk
      const { visits, throttled: wasThrottled, error } = await fetchVisitsForChunk(chunkStart, chunkEnd);
      
      if (error && !wasThrottled) {
        lastError = error;
        console.error(`[Sync] ❌ Chunk ${i + 1} failed:`, error);
        break;
      }

      // Upsert whatever we got
      let insertedThisChunk = 0;
      if (visits.length > 0) {
        const { inserted, errors: upsertErrors } = await upsertVisits(supabase, visits);
        totalVisits += visits.length;
        totalBlocks += inserted;
        insertedThisChunk = inserted;
        
        if (upsertErrors > 0) {
          console.log(`[Sync] ⚠️ ${upsertErrors} upsert errors in chunk ${i + 1}`);
        }
      }

      chunksCompleted++;
      lastSuccessfulDate = chunk.end;

      // Update progress in database (partial save)
      await supabase
        .from("schedule_sync_runs")
        .update({
          chunks_completed: chunksCompleted,
          current_cursor_date: chunk.end.toISOString().split('T')[0],
          visits_synced: totalVisits,
          blocks_inserted: totalBlocks,
        })
        .eq("id", syncRun.id);

      console.log(`[Sync] ✅ Chunk ${i + 1}: ${visits.length} visits → ${insertedThisChunk} blocks inserted (total: ${totalBlocks})`);

      // If throttled, stop and return partial
      if (wasThrottled) {
        throttled = true;
        lastError = "Throttled by Jobber API";
        console.log(`[Sync] ⏸️ Pausing due to throttle. Completed ${chunksCompleted}/${chunks.length + syncRun.chunks_completed} chunks.`);
        break;
      }

      // Delay between chunks to be respectful of API limits
      if (i < chunks.length - 1) {
        const delay = CONFIG.minRequestDelayMs + Math.random() * (CONFIG.maxRequestDelayMs - CONFIG.minRequestDelayMs);
        console.log(`[Sync] 💤 Waiting ${Math.round(delay)}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Determine final status
    const allComplete = chunksCompleted >= chunks.length + syncRun.chunks_completed;
    const finalStatus = allComplete ? "completed" : throttled ? "partial" : lastError ? "failed" : "completed";

    // Update final state
    await supabase
      .from("schedule_sync_runs")
      .update({
        status: finalStatus,
        chunks_completed: chunksCompleted,
        current_cursor_date: lastSuccessfulDate.toISOString().split('T')[0],
        visits_synced: totalVisits,
        blocks_inserted: totalBlocks,
        last_error: lastError,
        completed_at: finalStatus === "completed" ? new Date().toISOString() : null,
      })
      .eq("id", syncRun.id);

    // Also update legacy sync state for backwards compatibility
    await supabase
      .from("jobber_sync_state")
      .update({
        backfill_in_progress: false,
        last_backfill_at: new Date().toISOString(),
      })
      .eq("id", "default");

    const response = {
      status: finalStatus,
      runId: syncRun.id,
      chunksCompleted,
      totalChunks: chunks.length + (syncRun.chunks_completed || 0),
      visitsProcessed: totalVisits,
      blocksInserted: totalBlocks,
      syncedThrough: lastSuccessfulDate.toISOString().split('T')[0],
      dateRange: {
        start: syncRun.from_date,
        end: syncRun.to_date,
      },
      ...(finalStatus === "partial" && {
        message: "Sync paused due to rate limiting. Click 'Resume Sync' to continue.",
        remainingChunks: chunks.length - (chunksCompleted - (syncRun.chunks_completed || 0)),
      }),
      ...(lastError && { error: lastError }),
    };

    console.log(`[Sync] Finished with status: ${finalStatus}`, response);

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: finalStatus === "failed" ? 500 : 200,
      }
    );

  } catch (error) {
    console.error("[Sync] Fatal error:", error);

    return new Response(
      JSON.stringify({ 
        error: "Sync failed",
        details: error instanceof Error ? error.message : String(error)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
