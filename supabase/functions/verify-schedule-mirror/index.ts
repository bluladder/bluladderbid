import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrService } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Read-only schedule diagnostic. Restrict to cron/service or admin so the
  // technician schedule/customer visit data is never exposed anonymously.
  const authz = await requireAdminOrService(req);
  if (!authz.ok) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

    // Get all busy blocks for today and tomorrow
    const { data: busyBlocks, error: blocksError } = await supabase
      .from("jobber_busy_blocks")
      .select("*")
      .gte("start_at", today.toISOString())
      .lt("end_at", endOfTomorrow.toISOString())
      .order("start_at", { ascending: true });

    if (blocksError) throw blocksError;

    // Get all technicians
    const { data: technicians, error: techError } = await supabase
      .from("technicians")
      .select("id, name, jobber_user_id, is_active")
      .eq("is_active", true);

    if (techError) throw techError;

    // Group blocks by technician
    const techMap = new Map<string, { name: string; blocks: typeof busyBlocks }>();
    
    for (const tech of technicians || []) {
      techMap.set(tech.jobber_user_id, { name: tech.name, blocks: [] });
    }

    for (const block of busyBlocks || []) {
      const existing = techMap.get(block.crew_id);
      if (existing) {
        existing.blocks.push(block);
      }
    }

    // Build summary
    const techSummaries = Array.from(techMap.entries()).map(([jobberUserId, data]) => {
      const blocks = data.blocks || [];
      return {
        technicianName: data.name,
        jobberUserId,
        totalBlocks: blocks.length,
        todayBlocks: blocks.filter(b => new Date(b.start_at) >= today && new Date(b.start_at) < tomorrow).length,
        tomorrowBlocks: blocks.filter(b => new Date(b.start_at) >= tomorrow && new Date(b.start_at) < endOfTomorrow).length,
        earliestStart: blocks.length > 0 ? blocks[0].start_at : null,
        latestEnd: blocks.length > 0 ? blocks[blocks.length - 1].end_at : null,
        blocks: blocks.map(b => ({
          visitId: b.jobber_visit_id,
          start: b.start_at,
          end: b.end_at,
          client: b.client_name,
          status: b.status,
        })),
      };
    });

    // Get latest sync run
    const { data: latestRun } = await supabase
      .from("schedule_sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    // Get total blocks count
    const { count: totalBlocksCount } = await supabase
      .from("jobber_busy_blocks")
      .select("*", { count: "exact", head: true });

    const response = {
      summary: {
        dateRange: {
          today: today.toISOString().split('T')[0],
          tomorrow: tomorrow.toISOString().split('T')[0],
        },
        totalBlocksInMirror: totalBlocksCount || 0,
        blocksForTodayTomorrow: busyBlocks?.length || 0,
        activeTechnicians: technicians?.length || 0,
      },
      latestSync: latestRun ? {
        runId: latestRun.id,
        status: latestRun.status,
        chunksCompleted: `${latestRun.chunks_completed}/${latestRun.total_chunks}`,
        visitsProcessed: latestRun.visits_synced,
        blocksInserted: latestRun.blocks_inserted,
        lastError: latestRun.last_error,
        syncedThrough: latestRun.current_cursor_date,
      } : null,
      technicians: techSummaries,
      message: (busyBlocks?.length || 0) === 0 
        ? "⚠️ No busy blocks found for today/tomorrow. Either Jobber calendar is empty or sync hasn't completed."
        : `✅ Found ${busyBlocks?.length} busy blocks for today/tomorrow.`,
    };

    console.log("[Verify] Schedule Mirror Status:", JSON.stringify(response, null, 2));

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Verify] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
