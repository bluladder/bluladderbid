import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL, JobberGraphQLResult } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_TOLERANCE_MS = 2 * 60 * 1000; // 2 minutes
const CHUNK_DAYS = 5; // fewer Jobber requests than 1-day chunks
const PAGE_SIZE = 100;
const MAX_PAGES_PER_CHUNK = 20;
const TZ = "America/Chicago";

interface Visit {
  id: string;
  startAt: string;
  endAt: string;
  assignedUsers: { nodes: Array<{ id: string; name: { full: string } }> };
  job: {
    id: string;
    property: { address: { street: string; city: string; province: string; postalCode: string } };
    client: { name: string };
  };
}

interface VisitsResponse {
  visits: { nodes: Visit[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
}

const VISITS_QUERY = `
  query GetVisits($after: String, $startDate: ISO8601DateTime!, $endDate: ISO8601DateTime!) {
    visits(
      first: ${PAGE_SIZE},
      after: $after,
      filter: { startAt: { after: $startDate, before: $endDate } }
    ) {
      nodes {
        id
        startAt
        endAt
        assignedUsers(first: 10) { nodes { id name { full } } }
        job {
          id
          property { address { street city province postalCode } }
          client { name }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function dayKey(iso: string): string {
  // Group by local (Chicago) calendar day
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let mode: "report" | "fix" = "report";
  let trigger: "manual" | "auto" = "manual";
  let horizonDays = 30;

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.mode === "fix") mode = "fix";
      if (body.trigger === "auto") trigger = "auto";
      if (typeof body.horizonDays === "number" && body.horizonDays > 0 && body.horizonDays <= 365) {
        horizonDays = Math.floor(body.horizonDays);
      }
    } catch {
      // ignore
    }
  }

  const startedAt = new Date();
  const windowStart = new Date(startedAt);
  const windowEnd = new Date(startedAt.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  try {
    // ---- 1. Pull authoritative Jobber visits for the window ----
    const visitMap = new Map<
      string,
      { visitId: string; crewId: string; crewName: string; start: string; end: string; jobId: string | null; client: string | null; address: string | null }
    >();
    let throttled = false;

    let chunkStart = new Date(windowStart);
    while (chunkStart < windowEnd && !throttled) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000, windowEnd.getTime()));
      let hasNext = true;
      let cursor: string | null = null;
      let page = 0;

      while (hasNext && page < MAX_PAGES_PER_CHUNK) {
        const res: JobberGraphQLResult<VisitsResponse> = await jobberGraphQL<VisitsResponse>(VISITS_QUERY, {
          after: cursor,
          startDate: chunkStart.toISOString(),
          endDate: chunkEnd.toISOString(),
        });

        if (res.throttled || res.errors?.some((e) => /throttl|rate limit|too many/i.test(e.message))) {
          throttled = true;
          break;
        }
        if (res.errors) {
          throw new Error(res.errors.map((e) => e.message).join("; "));
        }
        const data = res.data?.visits;
        if (!data) break;

        for (const v of data.nodes) {
          for (const a of v.assignedUsers?.nodes || []) {
            const addr = v.job?.property?.address;
            visitMap.set(`${v.id}:${a.id}`, {
              visitId: v.id,
              crewId: a.id,
              crewName: a.name?.full || "Unknown",
              start: v.startAt,
              end: v.endAt,
              jobId: v.job?.id || null,
              client: v.job?.client?.name || null,
              address: addr ? `${addr.street}, ${addr.city}, ${addr.province} ${addr.postalCode}` : null,
            });
          }
        }
        hasNext = data.pageInfo.hasNextPage;
        cursor = data.pageInfo.endCursor;
        page++;
        if (hasNext) await new Promise((r) => setTimeout(r, 250));
      }
      chunkStart = chunkEnd;
    }

    // ---- 2. Load current mirror (future, active commitments) ----
    const { data: mirrorRows, error: mirrorErr } = await supabase
      .from("jobber_busy_blocks")
      .select("id, jobber_visit_id, crew_id, start_at, end_at, status, client_name")
      .gte("start_at", windowStart.toISOString())
      .lt("start_at", windowEnd.toISOString())
      .in("status", ["scheduled", "in_progress"]);
    if (mirrorErr) throw mirrorErr;

    const mirrorMap = new Map<string, { id: string; start: string; end: string; client: string | null }>();
    for (const r of mirrorRows || []) {
      mirrorMap.set(`${r.jobber_visit_id}:${r.crew_id}`, {
        id: r.id,
        start: r.start_at,
        end: r.end_at,
        client: r.client_name,
      });
    }

    // ---- 3. Technician name lookup ----
    const { data: techs } = await supabase
      .from("technicians")
      .select("name, jobber_user_id");
    const techNames = new Map<string, string>();
    for (const t of techs || []) {
      if (t.jobber_user_id) techNames.set(t.jobber_user_id, t.name);
    }

    // ---- 4. Diff ----
    interface Discrepancy {
      type: "missing" | "orphan" | "mismatch";
      day: string;
      crewId: string;
      technician: string;
      visitId: string;
      client: string | null;
      jobberStart?: string;
      jobberEnd?: string;
      mirrorStart?: string;
      mirrorEnd?: string;
      mirrorBlockId?: string;
    }
    const discrepancies: Discrepancy[] = [];
    const upserts: Array<{
      jobber_visit_id: string;
      crew_id: string;
      start_at: string;
      end_at: string;
      status: string;
      jobber_job_id: string | null;
      client_name: string | null;
      client_address: string | null;
      source: string;
      updated_at: string;
    }> = [];
    const pruneIds: string[] = [];

    // missing + mismatch
    for (const [key, jv] of visitMap.entries()) {
      const tech = techNames.get(jv.crewId) || jv.crewName;
      const existing = mirrorMap.get(key);
      if (!existing) {
        discrepancies.push({
          type: "missing",
          day: dayKey(jv.start),
          crewId: jv.crewId,
          technician: tech,
          visitId: jv.visitId,
          client: jv.client,
          jobberStart: jv.start,
          jobberEnd: jv.end,
        });
        upserts.push({
          jobber_visit_id: jv.visitId,
          crew_id: jv.crewId,
          start_at: jv.start,
          end_at: jv.end,
          status: "scheduled",
          jobber_job_id: jv.jobId,
          client_name: jv.client,
          client_address: jv.address,
          source: "reconcile",
          updated_at: new Date().toISOString(),
        });
      } else {
        const startDiff = Math.abs(new Date(existing.start).getTime() - new Date(jv.start).getTime());
        const endDiff = Math.abs(new Date(existing.end).getTime() - new Date(jv.end).getTime());
        if (startDiff > TIME_TOLERANCE_MS || endDiff > TIME_TOLERANCE_MS) {
          discrepancies.push({
            type: "mismatch",
            day: dayKey(jv.start),
            crewId: jv.crewId,
            technician: tech,
            visitId: jv.visitId,
            client: jv.client,
            jobberStart: jv.start,
            jobberEnd: jv.end,
            mirrorStart: existing.start,
            mirrorEnd: existing.end,
            mirrorBlockId: existing.id,
          });
          upserts.push({
            jobber_visit_id: jv.visitId,
            crew_id: jv.crewId,
            start_at: jv.start,
            end_at: jv.end,
            status: "scheduled",
            jobber_job_id: jv.jobId,
            client_name: jv.client,
            client_address: jv.address,
            source: "reconcile",
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // orphan (stale): in mirror, not in authoritative Jobber set.
    // Only trustworthy when the full Jobber pull completed — a throttled/partial
    // pull would flag every un-fetched block as a false-positive orphan.
    if (!throttled) {
      for (const [key, mb] of mirrorMap.entries()) {
      if (!visitMap.has(key)) {
        const [visitId, crewId] = key.split(":");
        discrepancies.push({
          type: "orphan",
          day: dayKey(mb.start),
          crewId,
          technician: techNames.get(crewId) || "Unknown",
          visitId,
          client: mb.client,
          mirrorStart: mb.start,
          mirrorEnd: mb.end,
          mirrorBlockId: mb.id,
        });
        pruneIds.push(mb.id);
      }
      }
    }

    const missingCount = discrepancies.filter((d) => d.type === "missing").length;
    const orphanCount = discrepancies.filter((d) => d.type === "orphan").length;
    const mismatchCount = discrepancies.filter((d) => d.type === "mismatch").length;

    // ---- 5. Apply fixes (only when not throttled, to avoid pruning on partial data) ----
    let blocksAdded = 0;
    let blocksCorrected = 0;
    let blocksPruned = 0;
    const canFix = mode === "fix" && !throttled;

    if (canFix) {
      if (upserts.length > 0) {
        const { error: upErr } = await supabase
          .from("jobber_busy_blocks")
          .upsert(upserts, { onConflict: "jobber_visit_id,crew_id" });
        if (!upErr) {
          blocksAdded = missingCount;
          blocksCorrected = mismatchCount;
        }
      }
      if (pruneIds.length > 0) {
        // Mark stale blocks cancelled (reversible, ignored by availability engine)
        const { error: delErr } = await supabase
          .from("jobber_busy_blocks")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .in("id", pruneIds);
        if (!delErr) blocksPruned = pruneIds.length;
      }
    }

    // ---- 6. Build per-day / per-technician report ----
    const byDay: Record<string, Record<string, { missing: number; orphan: number; mismatch: number; items: Discrepancy[] }>> = {};
    for (const d of discrepancies) {
      byDay[d.day] ??= {};
      byDay[d.day][d.technician] ??= { missing: 0, orphan: 0, mismatch: 0, items: [] };
      byDay[d.day][d.technician][d.type]++;
      byDay[d.day][d.technician].items.push(d);
    }

    const status = throttled ? "throttled" : "completed";
    const report = {
      window: { start: windowStart.toISOString(), end: windowEnd.toISOString(), horizonDays },
      totals: { missingCount, orphanCount, mismatchCount },
      applied: { blocksAdded, blocksCorrected, blocksPruned },
      byDay,
      discrepancies,
    };

    const { data: runRow } = await supabase
      .from("schedule_reconciliation_runs")
      .insert({
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        mode,
        trigger,
        horizon_days: horizonDays,
        status,
        jobber_visits: visitMap.size,
        mirror_blocks: mirrorMap.size,
        missing_count: missingCount,
        orphan_count: orphanCount,
        mismatch_count: mismatchCount,
        blocks_added: blocksAdded,
        blocks_corrected: blocksCorrected,
        blocks_pruned: blocksPruned,
        report,
      })
      .select("id")
      .single();

    return new Response(
      JSON.stringify({
        success: true,
        runId: runRow?.id || null,
        mode,
        trigger,
        status,
        throttled,
        jobberVisits: visitMap.size,
        mirrorBlocks: mirrorMap.size,
        missingCount,
        orphanCount,
        mismatchCount,
        blocksAdded,
        blocksCorrected,
        blocksPruned,
        report,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Reconcile] Error:", message);
    await supabase.from("schedule_reconciliation_runs").insert({
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      mode,
      trigger,
      horizon_days: horizonDays,
      status: "failed",
      error: message,
    });
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});