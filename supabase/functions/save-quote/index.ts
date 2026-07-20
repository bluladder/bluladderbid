// ============================================================================
// save-quote — persists a customer-initiated quote as saved or emailed, so it
// stays available for 30 days and enters the "quote_saved" lifecycle stage.
// - Idempotent per (customer, source_session_id) so re-clicks update the same row.
// - When action = "email", sends a transactional link to the recipient via the
//   existing Resend path (emailConfig.ts). No marketing content.
// - Never fires a Meta conversion event and never creates a Jobber record.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendEmail } from "../_shared/emailConfig.ts";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";
import { getAppUrl } from "../_shared/appUrl.ts";
import { computeAuthoritativeQuote } from "../_shared/authoritativeQuote.ts";
import { mintQuoteResumeToken, revokeQuoteResumeTokens } from "../_shared/quoteResumeTokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};


interface Body {
  action: "save" | "email";
  mode?: "one_time" | "plan";
  quoteType?: "one_time" | "recurring_plan";
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  total: number;
  subtotal: number;
  services: Array<{ name: string; amount?: number }>;
  homeDetails: Record<string, unknown>;
  additionalServices?: Record<string, unknown>;
  sourceSessionId?: string | null;
  utmParams?: Record<string, unknown> | null;
  attribution?: Record<string, unknown> | null;
  ruleVersion?: number | null;
  engineVersion?: string | null;
  lineItems?: unknown;
  planSnapshot?: Record<string, unknown> | null;
  planScenario?: Record<string, unknown> | null;
  discount?: { code?: string } | null;
  promotion?: { id?: string; windowCount?: number } | null;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]));
}

function money(n: number) { return `$${Math.round(n).toLocaleString("en-US")}`; }

function renderEmail(opts: { firstName: string; total: number; services: Body["services"]; quoteUrl: string; expiresAt: string }) {
  const expDate = new Date(opts.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const services = opts.services.map((s) => `<li style="margin:4px 0;">${escapeHtml(s.name)}</li>`).join("");
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#0f172a;margin:0;padding:24px;">
    <div style="max-width:560px;margin:0 auto;">
      <h1 style="color:#1e3a8a;margin:0 0 12px;">Your BluLadder bid is saved</h1>
      <p>Hi ${escapeHtml(opts.firstName)},</p>
      <p>Here's the bid we prepared for you. It's held at <strong>${money(opts.total)}</strong> for 30 days (through <strong>${expDate}</strong>).</p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:16px 0;">
        <div style="font-size:14px;color:#334155;margin-bottom:8px;">Services included</div>
        <ul style="margin:0;padding-left:20px;color:#0f172a;">${services}</ul>
      </div>
      <p><a href="${opts.quoteUrl}" style="display:inline-block;background:#1e3a8a;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View & book this bid</a></p>
      <p style="font-size:12px;color:#64748b;margin-top:24px;">This is a transactional confirmation of a bid you requested. No further messages will be sent unless you opt in.</p>
    </div>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: "A valid email is required to save this bid." });
  }
  if (!body.services?.length || typeof body.total !== "number" || body.total <= 0) {
    return json(400, { error: "Add at least one service before saving this bid." });
  }
  const action: "save" | "email" = body.action === "email" ? "email" : "save";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1) Find or create the customer by email.
  let customerId: string | null = null;
  const { data: existing } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone")
    .eq("email", email)
    .maybeSingle();
  if (existing?.id) {
    customerId = existing.id;
    const patch: Record<string, unknown> = {};
    if (!existing.first_name && body.firstName) patch.first_name = body.firstName;
    if (!existing.last_name && body.lastName) patch.last_name = body.lastName;
    if (!existing.phone && body.phone) patch.phone = body.phone;
    if (Object.keys(patch).length) {
      await supabase.from("customers").update(patch).eq("id", customerId);
    }
  } else {
    const { data: created, error: cErr } = await supabase
      .from("customers")
      .insert({
        email,
        first_name: body.firstName ?? null,
        last_name: body.lastName ?? null,
        phone: body.phone ?? null,
      })
      .select("id")
      .single();
    if (cErr || !created) return json(500, { error: "Could not create customer record." });
    customerId = created.id;
  }

  const sessionId = body.sourceSessionId ?? null;
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const services_json: Record<string, unknown> = {
    services: body.services,
    lineItems: body.lineItems ?? null,
    mode: body.mode ?? "one_time",
    ...(body.planSnapshot ?? {}),
  };
  const home_details_json = body.homeDetails ?? {};

  // 2) Look up an existing saved/emailed quote for this session+customer.
  let quoteId: string | null = null;
  if (sessionId) {
    const { data: existingQ } = await supabase
      .from("quotes")
      .select("id, status")
      .eq("customer_id", customerId)
      .eq("source_session_id", sessionId)
      .in("status", ["saved", "emailed", "viewed", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingQ?.id) quoteId = existingQ.id;
  }

  const status = action === "email" ? "emailed" : "saved";
  const payload: Record<string, unknown> = {
    customer_id: customerId,
    customer_email: email,
    customer_name: [body.firstName, body.lastName].filter(Boolean).join(" ") || null,
    customer_phone: body.phone ?? null,
    services_json,
    home_details_json,
    subtotal: body.subtotal,
    total: body.total,
    status,
    expires_at: expiresAtIso,
    saved_at: nowIso,
    last_activity_at: nowIso,
    source_session_id: sessionId,
    utm_params_json: body.utmParams ?? null,
    attribution: body.attribution ?? null,
    pricing_engine_version: body.engineVersion ?? null,
    pricing_rule_version: body.ruleVersion ?? null,
  };
  if (action === "email") payload.emailed_at = nowIso;

  if (quoteId) {
    const { error } = await supabase.from("quotes").update(payload).eq("id", quoteId);
    if (error) return json(500, { error: "Could not update the saved bid." });
  } else {
    const { data: inserted, error } = await supabase
      .from("quotes")
      .insert(payload)
      .select("id")
      .single();
    if (error || !inserted) return json(500, { error: "Could not save the bid." });
    quoteId = inserted.id;

    // Supersede any older unbooked, non-superseded firm quotes for the same
    // (customer + session) so they no longer produce competing abandonment
    // events. Historical rows are preserved (superseded_by / superseded_at).
    if (sessionId && customerId) {
      const { data: olderRows } = await supabase
        .from("quotes")
        .select("id")
        .eq("customer_id", customerId)
        .eq("source_session_id", sessionId)
        .in("status", ["saved", "emailed", "viewed", "pending"])
        .is("converted_booking_id", null)
        .is("superseded_by", null)
        .neq("id", quoteId);
      const olderIds = (olderRows ?? []).map((r: { id: string }) => r.id);
      if (olderIds.length) {
        await supabase.from("quotes")
          .update({ superseded_by: quoteId, superseded_at: nowIso })
          .in("id", olderIds);
        // Stop pending quote_abandoned enrollments tied to those older quotes
        // and cancel their unsent messages. Historical enrollment rows are
        // preserved (status='stopped', reason='superseded_by_newer_quote').
        //
        // SCOPE: only enrollments whose triggering campaign_event.metadata
        // references one of the older quote ids are stopped. Enrollments from
        // OTHER quote journeys for the same customer are left untouched.
        const { data: evs } = await supabase
          .from("campaign_events")
          .select("id, metadata")
          .eq("customer_id", customerId)
          .eq("event_name", "quote_abandoned");
        const matchingEventIds = (evs ?? [])
          .filter((e: { metadata: Record<string, unknown> | null }) => {
            const qid = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).quote_id : null;
            return typeof qid === "string" && olderIds.includes(qid);
          })
          .map((e: { id: string }) => e.id);
        let enrIds: string[] = [];
        if (matchingEventIds.length) {
          const { data: enrs } = await supabase
            .from("campaign_enrollments")
            .select("id")
            .eq("customer_id", customerId)
            .eq("event_name", "quote_abandoned")
            .eq("status", "active")
            .in("campaign_event_id", matchingEventIds);
          enrIds = (enrs ?? []).map((r: { id: string }) => r.id);
        }
        if (enrIds.length) {
          await supabase.from("campaign_enrollments")
            .update({ status: "stopped", stopped_reason: "superseded_by_newer_quote", stopped_at: nowIso })
            .in("id", enrIds);
          await supabase.from("sms_messages")
            .update({ status: "cancelled", error: "Stopped: superseded_by_newer_quote", next_retry_at: null })
            .in("enrollment_id", enrIds).eq("status", "pending");
        }
      }
    }
  }

  const quoteUrl = `${getAppUrl()}/quote/${quoteId}`;

  // 3) Optional email send. Failure here still returns the saved quote.
  let emailStatus: "sent" | "skipped" | "failed" = "skipped";
  if (action === "email") {
    const res = await sendEmail({
      to: email,
      subject: "Your BluLadder bid — saved for 30 days",
      html: renderEmail({
        firstName: body.firstName || "there",
        total: body.total,
        services: body.services,
        quoteUrl,
        expiresAt: expiresAtIso,
      }),
    });
    emailStatus = res.ok ? "sent" : "failed";
  }

  // 4) Emit the canonical firm-quote event so first-touch attribution and
  // downstream campaigns (audience matching, consent, suppression, idempotency)
  // are handled by the SINGLE campaign engine. This never inserts enrollments
  // or queue rows directly — campaign-event owns that. Idempotency key is tied
  // to the quote id + pricing rule version so the same firm quote at the same
  // pricing version can only enter once.
  //
  // Not fired before a firm server-authoritative quote exists (this is after
  // the quotes-row insert succeeded with a positive total), not fired from
  // React rendering, and no customer PII beyond the identifiers required for
  // server-side resolution is carried in metadata.
  try {
    await emitCampaignEvent({
      eventName: "quote_calculated",
      idempotencyKey: `quote_calculated:${quoteId}:v${body.ruleVersion ?? 0}`,
      email,
      phone: body.phone ?? null,
      customerId,
      source: "save-quote",
      subject: action === "email" ? "Quote emailed" : "Quote saved",
      recoverySupabase: supabase,
      metadata: {
        lead_source: "website_quote",
        quote_status: "firm",
        quote_id: quoteId,
        quote_url: quoteUrl,
        pricing_rule_version: body.ruleVersion ?? null,
        pricing_engine_version: body.engineVersion ?? null,
        total: body.total,
        service_types: (body.services ?? []).map((s) => s?.name).filter(Boolean),
      },
    });
  } catch (e) {
    console.warn("save-quote: quote_calculated emit failed:", e instanceof Error ? e.message : e);
  }

  return json(200, { quoteId, quoteUrl, expiresAt: expiresAtIso, status, emailStatus });
});
