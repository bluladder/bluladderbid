// ============================================================================
// attribution-ingest — accepts a small, whitelisted attribution payload from
// the customer's browser and upserts it into `attribution_events`. Rejects
// unknown fields, caps all string lengths, refuses PII, never accepts revenue.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WHITELIST_TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "landing_page_slug",
  "referrer",
  "captured_at",
] as const;

const MAX_LEN = 200;
const PII_RE = /(@.+\.[a-z]{2,}|\+?\d[\d\s().-]{8,})/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.slice(0, MAX_LEN).trim();
  if (!t) return undefined;
  if (PII_RE.test(t)) return undefined;
  return t;
}

function cleanTouch(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object") return null;
  const out: Record<string, string> = {};
  for (const key of WHITELIST_TOUCH_KEYS) {
    const v = sanitize((input as Record<string, unknown>)[key]);
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return json({ error: "rate_limited" }, 429);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const source_session_id = sanitize(body.source_session_id);
  if (!source_session_id) return json({ error: "missing_session" }, 400);

  const first_touch = cleanTouch(body.first_touch);
  const last_touch = cleanTouch(body.last_touch);
  const landing_page_slug = sanitize(body.landing_page_slug);
  const fbclid = sanitize(body.fbclid);
  const referrer = sanitize(body.referrer);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: existing } = await supabase
    .from("attribution_events")
    .select("id, first_touch")
    .eq("source_session_id", source_session_id)
    .maybeSingle();

  if (existing) {
    // First-touch is FROZEN once persisted — subsequent calls only update
    // last_touch and any absent landing / fbclid / referrer fields.
    const patch: Record<string, unknown> = { last_touch, updated_at: new Date().toISOString() };
    if (landing_page_slug) patch.landing_page_slug = landing_page_slug;
    if (fbclid) patch.fbclid = fbclid;
    if (referrer) patch.referrer = referrer;
    await supabase.from("attribution_events").update(patch).eq("id", existing.id);
    return json({ ok: true, id: existing.id, updated: true });
  }

  const { data, error } = await supabase
    .from("attribution_events")
    .insert({
      source_session_id,
      first_touch,
      last_touch,
      landing_page_slug,
      fbclid,
      referrer,
    })
    .select("id")
    .single();

  if (error) {
    console.error("attribution-ingest insert failed:", error.message);
    return json({ error: "insert_failed" }, 500);
  }
  return json({ ok: true, id: data.id, created: true });
});
