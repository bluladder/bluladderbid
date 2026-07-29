// ============================================================================
// quote-decline — records a customer decline for a firm quote and emits the
// canonical `quote_declined` event through the campaign engine. This never
// inserts enrollments or queue rows directly — campaign-event owns that.
//
// Access model:
//   * a customer must present the exact opaque resume capability scoped to the
//     quote; knowing a quote id or customer email is never authorization, OR
//   * a trusted admin / service-role caller may perform the transition.
// The write compare-and-sets the state observed during authorization so a
// concurrent booking conversion always wins over a late decline.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { canDeclineQuote, classifyQuoteDecline } from "../_shared/quoteDecline.ts";
import { verifyResumeToken } from "../_shared/quoteResumeTokens.ts";

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
  resume_token?: string | null;
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
  const resumeToken = typeof body.resume_token === "string" && body.resume_token
    ? body.resume_token
    : null;
  // Server-side hard length cap — never trust the client UI limit alone.
  const NOTES_MAX = 1000;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, NOTES_MAX) : null;
  const source = (body.source || "customer_quote_view").slice(0, 64);

  if (!quoteId) return json(400, { error: "quote_id is required" });
  if (!ALLOWED_REASONS.has(reason)) return json(400, { error: "invalid_reason" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Authorize before reading the quote so an unauthenticated caller cannot
  // distinguish an existing quote id from a nonexistent one.
  const authz = await requireAdminOrService(req);
  let tokenMatches = false;
  if (!authz.ok && resumeToken) {
    const verified = await verifyResumeToken(supabase, quoteId, resumeToken);
    tokenMatches = !!verified.ok;
  }
  if (!canDeclineQuote(authz.ok, tokenMatches)) {
    return json(403, { error: "forbidden" });
  }

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("id, status, pricing_rule_version, converted_booking_id, expires_at")
    .eq("id", quoteId)
    .maybeSingle();
  if (qErr) return json(500, { error: "lookup_failed" });
  if (!quote) return json(404, { error: "quote_not_found" });

  const initialDisposition = classifyQuoteDecline(quote);
  if (initialDisposition === "already_converted") {
    return json(409, { error: "already_booked" });
  }
  if (initialDisposition === "expired") return json(409, { error: "quote_expired" });
  if (initialDisposition === "state_conflict") {
    return json(409, { error: "quote_state_conflict" });
  }

  const nowIso = new Date().toISOString();
  let idempotent = initialDisposition === "already_declined";

  if (!idempotent) {
    const { data: updated, error: updErr } = await supabase
      .from("quotes")
      .update({
        status: "declined",
        declined_at: nowIso,
        decline_reason: reason,
        decline_notes: notes,
        decline_source: authz.ok ? "admin" : source,
        decline_version: quote.pricing_rule_version ?? null,
        declined_by: authz.userId ?? null,
        last_activity_at: nowIso,
      })
      .eq("id", quoteId)
      .eq("status", quote.status)
      .is("converted_booking_id", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .select("id")
      .maybeSingle();
    if (updErr) return json(500, { error: "update_failed" });

    if (!updated) {
      // The quote changed after the initial read. Re-read only transition
      // sentinels; never overwrite a concurrent conversion or unknown state.
      const { data: current, error: currentErr } = await supabase
        .from("quotes")
        .select("status, converted_booking_id, expires_at")
        .eq("id", quoteId)
        .maybeSingle();
      if (currentErr || !current) return json(409, { error: "quote_state_conflict" });
      const concurrentDisposition = classifyQuoteDecline(current);
      if (concurrentDisposition === "already_converted") {
        return json(409, { error: "already_booked" });
      }
      if (concurrentDisposition === "already_declined") {
        idempotent = true;
      } else if (concurrentDisposition === "expired") {
        return json(409, { error: "quote_expired" });
      } else {
        return json(409, { error: "quote_state_conflict" });
      }
    }
  }

  // The declined row is itself the durable outbox marker. The bounded
  // declined-quote repair sweep emits quote_declined after a short race grace,
  // and the delivery worker checks this authoritative status before every
  // quote follow-up send. A crash here therefore cannot lose the stop signal.
  return json(200, {
    ok: true,
    idempotent,
    quote_id: quoteId,
    follow_up_status: "pending_reconciliation",
  });
});
