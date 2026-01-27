import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Visit {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  assignedServicers: { nodes: Array<{ id: string; name: string }> };
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

// Fetch all visits from Jobber within a date range
async function fetchAllVisits(startDate: string, endDate: string): Promise<Visit[]> {
  const allVisits: Visit[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let page = 0;
  const maxPages = 50; // Safety limit

  const query = `
    query GetVisits($after: String, $startDate: ISO8601DateTime!, $endDate: ISO8601DateTime!) {
      visits(
        first: 100,
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
          status
          assignedServicers {
            nodes {
              id
              name
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

  while (hasNextPage && page < maxPages) {
    console.log(`Fetching visits page ${page + 1}...`);
    
    // deno-lint-ignore no-explicit-any
    const result: { data?: VisitsResponse; errors?: Array<{ message: string }> } = await jobberGraphQL<VisitsResponse>(query, {
      after: cursor,
      startDate,
      endDate,
    });

    if (result.errors) {
      console.error("Jobber API errors:", result.errors);
      throw new Error(result.errors[0]?.message || "Failed to fetch visits");
    }

    const visitsData = result.data?.visits;
    if (!visitsData) {
      break;
    }

    allVisits.push(...visitsData.nodes);
    hasNextPage = visitsData.pageInfo.hasNextPage;
    cursor = visitsData.pageInfo.endCursor;
    page++;
  }

  console.log(`Fetched ${allVisits.length} total visits across ${page} pages`);
  return allVisits;
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
  
  // Check admin role using service client with explicit user_id
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
    // Check if backfill is already in progress
    const { data: syncState, error: stateError } = await supabase
      .from("jobber_sync_state")
      .select("*")
      .eq("id", "default")
      .single();

    if (stateError) throw stateError;

    // Prevent concurrent backfills
    if (syncState.backfill_in_progress) {
      const startedAt = new Date(syncState.backfill_started_at);
      const elapsed = Date.now() - startedAt.getTime();
      
      // Allow restart if stuck for more than 10 minutes
      if (elapsed < 10 * 60 * 1000) {
        return new Response(
          JSON.stringify({ 
            error: "Backfill already in progress",
            startedAt: syncState.backfill_started_at 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
        );
      }
    }

    // Prevent too frequent backfills (5 minute minimum)
    if (syncState.last_backfill_at) {
      const lastBackfill = new Date(syncState.last_backfill_at);
      const elapsed = Date.now() - lastBackfill.getTime();
      
      if (elapsed < 5 * 60 * 1000) {
        const waitSeconds = Math.ceil((5 * 60 * 1000 - elapsed) / 1000);
        return new Response(
          JSON.stringify({ 
            error: `Please wait ${waitSeconds} seconds before syncing again`,
            lastBackfillAt: syncState.last_backfill_at 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
        );
      }
    }

    // Parse request body for horizon days
    let horizonDays = syncState.backfill_horizon_days || 60;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.horizonDays && [30, 60, 90].includes(body.horizonDays)) {
          horizonDays = body.horizonDays;
        }
      } catch {
        // Use default
      }
    }

    // Mark backfill as in progress
    await supabase
      .from("jobber_sync_state")
      .update({ 
        backfill_in_progress: true,
        backfill_started_at: new Date().toISOString(),
        backfill_horizon_days: horizonDays,
      })
      .eq("id", "default");

    // Calculate date range
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7); // Include past week for context
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + horizonDays);

    console.log(`Syncing visits from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Fetch all visits from Jobber
    const visits = await fetchAllVisits(startDate.toISOString(), endDate.toISOString());

    // Clear existing blocks in the date range (except manually created ones)
    await supabase
      .from("jobber_busy_blocks")
      .delete()
      .eq("source", "jobber")
      .gte("start_at", startDate.toISOString())
      .lte("start_at", endDate.toISOString());

    // Upsert all visits as busy blocks
    let insertedCount = 0;
    let errorCount = 0;

    for (const visit of visits) {
      const assignees = visit.assignedServicers?.nodes || [];
      
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
              status: visit.status?.toLowerCase() || 'scheduled',
              jobber_job_id: visit.job?.id || null,
              client_name: visit.job?.client?.name || null,
              client_address: fullAddress,
              source: 'jobber',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'jobber_visit_id' }
          );

        if (error) {
          console.error("Failed to upsert busy block:", error);
          errorCount++;
        } else {
          insertedCount++;
        }
      }
    }

    // Update sync state
    await supabase
      .from("jobber_sync_state")
      .update({
        backfill_in_progress: false,
        last_backfill_at: new Date().toISOString(),
        backfill_horizon_days: horizonDays,
      })
      .eq("id", "default");

    console.log(`Sync complete: ${insertedCount} blocks inserted, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        visitsProcessed: visits.length,
        blocksInserted: insertedCount,
        errors: errorCount,
        horizonDays,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Sync failed:", error);

    // Reset backfill state on error
    await supabase
      .from("jobber_sync_state")
      .update({ backfill_in_progress: false })
      .eq("id", "default");

    return new Response(
      JSON.stringify({ 
        error: "Sync failed",
        details: error instanceof Error ? error.message : String(error)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});