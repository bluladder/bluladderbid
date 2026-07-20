// ============================================================================
// quote-decline — records a customer decline for a firm quote and emits the
// canonical `quote_declined` event through the campaign engine. This never
// inserts enrollments or queue rows directly — campaign-event owns that.
//
// Access model (mirrors QuoteView, which loads the quote by id alone):
//   * The caller must present the quote id, AND either
//     - the email on file for that quote (case-insensitive), OR
//     - a valid admin / service-role token.
// This keeps the customer-facing "Decline" action anonymous-safe (same trust
// as opening the quote link) while still requiring possession of the shared
// email + the shared link — no random enumeration.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";
import { requireAdminOrService } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_REASONS = new Set([
  "price_too_high",
  "chose_another_provider",
  "timing_wrong",
  "no_longer_needed",
  "other",
]);

interface Body {
  quote_id?: string;
  email?: string | null;
  reason?: string;
  notes?: string | null;
  source?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }

  const quoteId = (body.quote_id || "").trim();
  const reason = (body.reason || "").trim();
  const email = (body.email || "").trim().toLowerCase() || null;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
  const source = (body.source || "customer_quote_view").slice(0, 64);

  if (!quoteId) return json(400, { error: "quote_id is required" });
  if (!ALLOWED_REASONS.has(reason)) return json(400, { error: "invalid_reason" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("id, status, customer_id, customer_email, customer_phone, pricing_rule_version, declined_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (qErr) return json(500, { error: "lookup_failed" });
  if (!quote) return json(404, { error: "quote_not_found" });

  // Authorization: admin/service OR matching email on the quote.
  const authz = await requireAdminOrService(req);
  const emailOnFile = (quote.customer_email || "").trim().toLowerCase();
  const emailMatches = !!email && !!emailOnFile && email === emailOnFile;
  if (!authz.ok && !emailMatches) {
    return json(403, { error: "forbidden" });
  }

  // Terminal statuses that we won't overwrite.
  if (quote.status === "converted") {
    return json(409, { error: "already_booked" });
  }

  const nowIso = new Date().toISOString();

  // Idempotent: if already declined, return the existing decline as success.
  if (quote.status === "declined" && quote.declined_at) {
    return json(200, { ok: true, idempotent: true, quote_id: quoteId });
  }

  const { error: updErr } = await supabase
    .from("quotes")
    .update({
      status: "declined",
      declined_at: nowIso,
      decline_reason: reason,
      decline_notes: notes,
      decline_source: authz.ok && !emailMatches ? "admin" : source,
      decline_version: quote.pricing_rule_version ?? null,
      declined_by: authz.userId ?? null,
      last_activity_at: nowIso,
    })
    .eq("id", quoteId);
  if (updErr) return json(500, { error: "update_failed" });

  // Emit through the canonical engine. Idempotency key is per-quote so a
  // replay never double-enrolls or double-stops.
  try {
    await emitCampaignEvent({
      eventName: "quote_declined",
      idempotencyKey: `quote_declined:${quoteId}`,
      email: quote.customer_email,
      phone: quote.customer_phone,
      customerId: quote.customer_id,
      source: "quote-decline",
      subject: "Quote declined",
      recoverySupabase: supabase,
      metadata: {
        quote_id: quoteId,
        quote_status: "declined",
        decline_reason: reason,
        lead_source: "website_quote",
      },
    });
  } catch (e) {
    console.warn("quote-decline emit failed:", e instanceof Error ? e.message : e);
  }

  return json(200, { ok: true, quote_id: quoteId });
});