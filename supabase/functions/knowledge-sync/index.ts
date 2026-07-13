// ============================================================================
// knowledge-sync — the ONE controlled BluLadder.com knowledge sync.
// Admin-triggered (or internal service). It fetches an EXPLICIT allowlist of
// BluLadder.com pages, hashes their cleaned text, and writes DRAFT knowledge
// records for review. It NEVER:
//   * crawls arbitrary domains or follows user-provided URLs
//   * auto-publishes a policy / price / guarantee / phone / service inclusion
//   * touches the canonical pricing configuration
// Why a dedicated function: no existing function performs bounded outbound web
// fetch, and exposing that from the public chat boundary would create an
// arbitrary-fetch surface. This function is admin/service-only and allowlisted.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  isAllowedKnowledgeUrl,
  hashContent,
  diffKnowledge,
  type ScrapedItem,
  type ExistingItem,
} from "../_shared/knowledgeSync.ts";
import { recordSystemIssue } from "../_shared/systemHealth.ts";

const BASE = "https://www.bluladder.com";
const DEFAULT_PATHS = ["/", "/faq", "/services", "/contact", "/guarantee"];
const MAX_PAGES = 12;
const MAX_BYTES = 500_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strip scripts/styles/comments/tags to plain text; bounded length. */
function cleanHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function titleFor(path: string): string {
  if (path === "/") return "Homepage overview";
  const seg = path.replace(/^\//, "").replace(/[-/]/g, " ");
  return seg.replace(/\b\w/g, (c) => c.toUpperCase());
}

function categoryFor(path: string): string {
  if (path.includes("faq")) return "faq";
  if (path.includes("guarantee")) return "guarantee";
  if (path.includes("contact")) return "contact";
  if (path.includes("polic")) return "policy";
  return "service";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // ---- Authz: an authenticated admin OR an internal service call. ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let authorized = token === serviceKey;
    if (!authorized && token) {
      const { data: u } = await supabase.auth.getUser(token);
      const uid = u?.user?.id;
      if (uid) {
        const { data: isAdmin } = await supabase.rpc("has_admin_level", {
          _user_id: uid, _min_level: "operations_admin",
        });
        authorized = !!isAdmin;
      }
    }
    if (!authorized) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const dryRun = (body as any).dryRun === true;
    const requestedPaths: string[] = Array.isArray((body as any).paths)
      ? (body as any).paths.slice(0, MAX_PAGES)
      : DEFAULT_PATHS;

    const scraped: ScrapedItem[] = [];
    const failures: string[] = [];

    for (const p of requestedPaths) {
      const url = p.startsWith("http") ? p : `${BASE}${p.startsWith("/") ? p : `/${p}`}`;
      // Hard allowlist gate — rejects arbitrary/external/old-market URLs.
      if (!isAllowedKnowledgeUrl(url)) {
        failures.push(`rejected (not allowlisted): ${url}`);
        continue;
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "BluLadderKnowledgeSync/1.0" } });
        clearTimeout(t);
        if (!resp.ok) { failures.push(`${url} -> HTTP ${resp.status}`); continue; }
        const raw = (await resp.text()).slice(0, MAX_BYTES);
        const text = cleanHtml(raw);
        if (text.length < 40) { failures.push(`${url} -> too little content`); continue; }
        const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
        scraped.push({
          knowledgeKey: `web:${path}`,
          title: titleFor(path),
          content: text,
          category: categoryFor(path),
          sourcePage: url,
        });
      } catch (e) {
        failures.push(`${url} -> ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (scraped.length === 0) {
      await recordSystemIssue(supabase, {
        issueType: "knowledge_sync_failure",
        dedupeKey: "knowledge_sync_failure",
        severity: "warning",
        suggestedAction: "Check BluLadder.com availability and the allowlist.",
        details: { failures },
      });
      return json({ ok: false, error: "No pages could be fetched.", failures }, 200);
    }

    // Compare against existing website-sourced records only.
    const { data: existingRows } = await supabase
      .from("business_knowledge")
      .select("knowledge_key, content, source_hash, review_status")
      .eq("source_type", "website");
    const existing: ExistingItem[] = (existingRows ?? []).map((r: any) => ({
      knowledgeKey: r.knowledge_key,
      content: r.content,
      sourceHash: r.source_hash,
      reviewStatus: r.review_status,
    }));

    const actions = diffKnowledge(scraped, existing);
    const summary = { unchanged: 0, new_draft: 0, changed_draft: 0, conflict: 0 };
    const diffs: any[] = [];

    for (const a of actions) {
      summary[a.type]++;
      if (a.type === "unchanged") {
        if (!dryRun) {
          await supabase.from("business_knowledge")
            .update({ last_checked_at: new Date().toISOString() })
            .eq("knowledge_key", a.knowledgeKey);
        }
        continue;
      }
      diffs.push({ key: a.knowledgeKey, type: a.type, title: a.item.title, requiresOwnerReview: a.requiresOwnerReview });
      if (dryRun) continue;

      const now = new Date().toISOString();
      const existingRow = existing.find((e) => e.knowledgeKey === a.knowledgeKey);
      if (existingRow) {
        // NEVER overwrite live published content — stage as pending for review.
        await supabase.from("business_knowledge").update({
          pending_content: a.item.content,
          pending_source_hash: a.hash,
          review_status: a.type === "conflict" ? "conflict" : "draft",
          requires_owner_review: a.requiresOwnerReview,
          last_checked_at: now,
          last_changed_at: now,
          source_page: a.item.sourcePage,
        }).eq("knowledge_key", a.knowledgeKey);
      } else {
        // New website material is created INACTIVE + draft (never customer-facing).
        await supabase.from("business_knowledge").insert({
          knowledge_key: a.knowledgeKey,
          category: a.item.category,
          title: a.item.title,
          content: a.item.content,
          is_active: false,
          source_type: "website",
          source_page: a.item.sourcePage,
          source_hash: a.hash,
          last_checked_at: now,
          last_changed_at: now,
          review_status: a.type === "conflict" ? "conflict" : "draft",
          requires_owner_review: a.requiresOwnerReview,
          priority: 200,
        });
      }
      if (a.type === "conflict") {
        await recordSystemIssue(supabase, {
          issueType: "knowledge_conflict",
          dedupeKey: `knowledge_conflict:${a.knowledgeKey}`,
          severity: "warning",
          associatedRef: a.knowledgeKey,
          suggestedAction: "Review website change; do not let it override canonical pricing/policy.",
        });
      }
    }

    return json({ ok: true, dryRun, summary, diffs, failures });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "sync failed" }, 500);
  }
});
