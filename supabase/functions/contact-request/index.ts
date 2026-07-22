// ============================================================================
// contact-request — customer-initiated "Contact BluLadder" backend notify.
//
// Replaces the old mailto:/sms: draft flow. Public POST from the booking-help
// component. For each unique request_key we:
//   1. Insert into public.contact_requests (unique constraint = idempotency).
//   2. Send exactly one owner email through the shared sendEmail() pipeline.
//   3. Return a stable confirmation payload; repeated POSTs return dedup=true.
//
// PII stays server-side; no draft is ever opened in the customer's mail/SMS
// client. The owner recipient is OWNER_NOTIFICATION_EMAIL (defaults to
// ben@bluladder.com), matching the booking confirmation flow.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendEmail } from "../_shared/emailConfig.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function ownerRecipient(): string {
  return (Deno.env.get("OWNER_NOTIFICATION_EMAIL") || "ben@bluladder.com").trim();
}

function fmtPrice(n: unknown): string {
  const num = typeof n === "number" ? n : Number(n);
  if (!isFinite(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(num);
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

interface ContactPayload {
  requestKey: string;
  source?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  propertyAddress?: string;
  quoteId?: string;
  bookingId?: string;
  services?: Array<{ name?: string; price?: number }> | null;
  total?: number | null;
  appointmentStatus?: string;
  note?: string;
  pageUrl?: string;
}

function renderHtml(p: ContactPayload): { subject: string; html: string } {
  const who = p.customerName?.trim() || "A customer";
  const subject = `New customer contact request — ${who}`;
  const svcHtml = Array.isArray(p.services) && p.services.length
    ? `<ul style="margin:6px 0 0;padding-left:18px">${p.services
        .map((s) => `<li>${escapeHtml(s?.name ?? "Service")}${typeof s?.price === "number" ? ` — ${fmtPrice(s.price)}` : ""}</li>`)
        .join("")}</ul>`
    : `<p style="margin:6px 0 0">—</p>`;
  const noteHtml = p.note?.trim()
    ? `<h3 style="margin:16px 0 6px 0">Customer note</h3><p style="white-space:pre-wrap;margin:0">${escapeHtml(p.note)}</p>`
    : "";
  const inner = `
    <div style="max-width:600px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#ffffff">
      <div style="background:#1e40af;padding:16px;border-radius:8px 8px 0 0;text-align:center;color:#fff">
        <h1 style="margin:0;font-size:20px">Customer contact request</h1>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;padding:20px">
        <h3 style="margin:0 0 6px 0">Customer</h3>
        <p style="margin:2px 0">${escapeHtml(who)}</p>
        <p style="margin:2px 0">${escapeHtml(p.customerEmail || "—")}${p.customerPhone ? " · " + escapeHtml(p.customerPhone) : ""}</p>
        <p style="margin:2px 0">${escapeHtml(p.propertyAddress || "—")}</p>
        <h3 style="margin:16px 0 6px 0">Context</h3>
        <p style="margin:2px 0">Appointment status: <strong>${escapeHtml(p.appointmentStatus || "—")}</strong></p>
        <p style="margin:2px 0">Quote ID: ${escapeHtml(p.quoteId || "—")}</p>
        <p style="margin:2px 0">Booking ID: ${escapeHtml(p.bookingId || "—")}</p>
        <p style="margin:2px 0">Total: ${fmtPrice(p.total)}</p>
        <p style="margin:2px 0">Page: ${escapeHtml(p.pageUrl || "—")}</p>
        <h3 style="margin:16px 0 6px 0">Services</h3>
        ${svcHtml}
        ${noteHtml}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0"/>
        <p style="font-size:12px;color:#64748b;margin:0">Reply directly to the customer at
          ${p.customerEmail ? `<a href="mailto:${escapeHtml(p.customerEmail)}">${escapeHtml(p.customerEmail)}</a>` : "the email above"}.
        </p>
      </div>
    </div>`;
  return { subject, html: inner };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Public endpoint — throttle abusive callers per IP.
  const rl = rateLimit(req, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  const raw = await req.json().catch(() => ({}));
  const payload = raw as ContactPayload;
  const requestKey = typeof payload?.requestKey === "string" ? payload.requestKey.trim() : "";
  if (!requestKey || requestKey.length < 8 || requestKey.length > 128) {
    return new Response(JSON.stringify({ error: "requestKey required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idempotency: if this request_key already exists, return the prior outcome.
  const { data: existing } = await supabase
    .from("contact_requests")
    .select("id, owner_notification_status, created_at")
    .eq("request_key", requestKey)
    .maybeSingle();
  if (existing) {
    return new Response(JSON.stringify({
      ok: true, dedup: true, id: existing.id,
      ownerStatus: existing.owner_notification_status, sentAt: existing.created_at,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const ipHash = await sha256Hex(
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );

  const { data: inserted, error: insErr } = await supabase
    .from("contact_requests")
    .insert({
      request_key: requestKey,
      source: payload.source || "booking_help_contact",
      customer_name: payload.customerName ?? null,
      customer_email: payload.customerEmail ?? null,
      customer_phone: payload.customerPhone ?? null,
      property_address: payload.propertyAddress ?? null,
      quote_id: payload.quoteId ?? null,
      booking_id: payload.bookingId ?? null,
      services: payload.services ?? null,
      total: typeof payload.total === "number" ? payload.total : null,
      appointment_status: payload.appointmentStatus ?? null,
      note: payload.note ?? null,
      page_url: payload.pageUrl ?? null,
      ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    // Concurrent insert may have won the unique race — retry the lookup.
    if (insErr && String(insErr.message).includes("duplicate")) {
      const { data: race } = await supabase
        .from("contact_requests").select("id, owner_notification_status").eq("request_key", requestKey).maybeSingle();
      if (race) {
        return new Response(JSON.stringify({ ok: true, dedup: true, id: race.id, ownerStatus: race.owner_notification_status }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: "insert_failed", detail: insErr?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { subject, html } = renderHtml(payload);
  const send = await sendEmail({
    to: ownerRecipient(),
    subject,
    html,
    fromNameOverride: "BluLadder Contact Request",
  });

  const status = send.ok ? "sent" : (send.failure?.reachedProvider ? "provider_rejected" : "delivery_failed");
  await supabase.from("contact_requests").update({
    owner_notification_status: status,
    owner_provider_message_id: send.ok ? send.providerMessageId : null,
    owner_error: send.ok ? null : (send.failure?.message ?? "send_failed"),
  }).eq("id", inserted.id);

  return new Response(JSON.stringify({
    ok: true,
    dedup: false,
    id: inserted.id,
    ownerStatus: status,
    providerMessageId: send.ok ? send.providerMessageId : null,
    error: send.ok ? null : (send.failure?.message ?? null),
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});