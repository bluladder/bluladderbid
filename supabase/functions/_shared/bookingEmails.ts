// ============================================================================
// bookingEmails.ts — post-booking transactional email delivery.
//
// Sends TWO independent messages after a booking succeeds AND has a valid
// Jobber visit id:
//   1. Customer booking confirmation → the customer's email.
//   2. Internal owner booking alert   → OWNER_NOTIFICATION_EMAIL (default
//      ben@bluladder.com).
//
// Each channel is independent: one failing must NOT block the other. Each
// send is deduplicated per (booking, channel) using a deterministic key
// written into notification_events, so refreshes, React rerenders, retries
// and webhook replays never send twice.
//
// All sending flows through the shared emailConfig (BluLadder / alerts@ /
// info@bluladder.com). Test-identity recipients are permanently suppressed
// and recorded as suppressed_test_identity rather than reported as sent.
// ============================================================================
import { sendEmail } from "./emailConfig.ts";
import { checkSuppression } from "./suppression.ts";
import { getAppUrl } from "./appUrl.ts";
import {
  buildPrepBlocks,
  hasPrepAlreadyBeenSent,
  loadActivePrepConfigs,
  markPrepSent,
  renderPrepHtml,
  type PrepConfig,
} from "./bookingPreparation.ts";

const CUSTOMER_HELP_SMS = "(469) 747-2877";
const OFFICE_REPLY = "info@bluladder.com";
const APP_URL = getAppUrl();

function getOwnerRecipient(): string {
  return (Deno.env.get("OWNER_NOTIFICATION_EMAIL") || "ben@bluladder.com").trim();
}

function fmtPrice(n: number | null | undefined): string {
  if (typeof n !== "number") return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);
}

function fmtDateChicago(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return String(iso); }
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

interface ServiceLine { name: string; price?: number; quantity?: number }

function renderServiceLines(services: ServiceLine[]): string {
  return (services || []).map((s) => {
    const qty = s.quantity && s.quantity > 1 ? ` × ${s.quantity}` : "";
    const price = typeof s.price === "number" ? ` — ${fmtPrice(s.price)}` : "";
    return `<li style="margin:4px 0">${escapeHtml(s.name)}${qty}${price}</li>`;
  }).join("");
}

function shell(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f172a;background:#ffffff;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#1e40af;padding:18px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;">BluLadder</h1>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:22px;">${inner}</div>
  </div></body></html>`;
}

export interface BookingEmailContext {
  bookingId: string;
  referenceNumber: string;
  jobberVisitId: string;
  jobberJobId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  serviceAddress: string;
  services: ServiceLine[];
  subtotal: number;
  discountAmount: number;
  discountCode?: string | null;
  total: number;
  technicianName: string;
  durationMinutes?: number | null;
  customer: { firstName: string; lastName: string; email: string; phone?: string | null };
  utm?: { campaign?: string; content?: string; source?: string; medium?: string; landing_page_slug?: string } | null;
  attributionSource?: string | null;
}

function customerHtml(
  ctx: BookingEmailContext,
  prepBlocks: PrepConfig[],
): { subject: string; html: string } {
  const dt = fmtDateChicago(ctx.scheduledStart);
  const subject = `Your BluLadder appointment is confirmed — ${dt}`;
  const disc = ctx.discountAmount > 0
    ? `<tr><td style="color:#059669">Discount${ctx.discountCode ? ` (${escapeHtml(ctx.discountCode)})` : ""}</td><td align="right" style="color:#059669">-${fmtPrice(ctx.discountAmount)}</td></tr>`
    : "";
  // Prep block: uses admin-configured per-service instructions when present.
  // If none apply we fall back to a short generic block so the email always
  // has SOME preparation guidance. We never re-send this on reschedule; the
  // caller in sendBookingConfirmationEmails dedupes via
  // bookings.prep_email_sent_at before we get here.
  const prepHtml = prepBlocks.length > 0
    ? renderPrepHtml(prepBlocks)
    : `<h3 style="margin:20px 0 6px 0">How to prepare</h3>
       <ul style="margin:0;padding-left:18px">
         <li>Unlock exterior gates and clear a path to work areas.</li>
         <li>Move fragile décor and patio items away from windows and walls.</li>
         <li>Keep pets indoors during the visit.</li>
         <li>An outdoor water spigot must be accessible for washing services.</li>
       </ul>`;
  const inner = `
    <h2 style="color:#1e40af;margin:0 0 12px 0">Hi ${escapeHtml(ctx.customer.firstName || "there")},</h2>
    <p style="margin:0 0 14px 0">Your appointment is booked. Here are the details:</p>
    <h3 style="margin:18px 0 6px 0;color:#0f172a">Appointment</h3>
    <p style="margin:2px 0"><strong>When:</strong> ${escapeHtml(dt)} (Central Time)</p>
    <p style="margin:2px 0"><strong>Where:</strong> ${escapeHtml(ctx.serviceAddress)}</p>
    <p style="margin:2px 0"><strong>Reference #:</strong> ${escapeHtml(ctx.referenceNumber)}</p>
    <h3 style="margin:18px 0 6px 0">Services</h3>
    <ul style="margin:0;padding-left:18px">${renderServiceLines(ctx.services)}</ul>
    <table style="width:100%;margin-top:14px;border-top:1px solid #e5e7eb;padding-top:10px">
      <tr><td>Subtotal</td><td align="right">${fmtPrice(ctx.subtotal)}</td></tr>
      ${disc}
      <tr><td style="font-weight:700;padding-top:6px">Total</td><td align="right" style="font-weight:700;padding-top:6px">${fmtPrice(ctx.total)}</td></tr>
    </table>
    <p style="font-size:12px;color:#64748b;margin-top:4px">Payment is collected after service is complete.</p>
    ${prepHtml}
    <h3 style="margin:20px 0 6px 0">Weather policy</h3>
    <p style="margin:0">If severe weather makes your services unsafe or ineffective, we'll reach out to reschedule — no fee, no rebooking hassle.</p>
    <h3 style="margin:20px 0 6px 0">Need to change something?</h3>
    <p style="margin:0">Reply to this email at <a href="mailto:${OFFICE_REPLY}">${OFFICE_REPLY}</a> or text ${escapeHtml(CUSTOMER_HELP_SMS)}. You can also manage this appointment at
    <a href="${APP_URL}/my-appointments">${APP_URL}/my-appointments</a>.</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0"/>
    <p style="font-size:12px;color:#64748b;margin:0">© ${new Date().getFullYear()} BluLadder</p>
  `;
  return { subject, html: shell(inner) };
}

function ownerHtml(ctx: BookingEmailContext): { subject: string; html: string } {
  const dt = fmtDateChicago(ctx.scheduledStart);
  const name = `${ctx.customer.firstName ?? ""} ${ctx.customer.lastName ?? ""}`.trim() || "New customer";
  const subject = `New Booking: ${name} — ${dt}`;
  const durMin = ctx.durationMinutes ?? null;
  const durHrs = durMin ? Math.round(durMin / 6) / 10 : null;
  const inner = `
    <h2 style="color:#1e40af;margin:0 0 12px 0">New Booking</h2>
    <h3 style="margin:16px 0 6px 0">Customer</h3>
    <p style="margin:2px 0">${escapeHtml(name)}</p>
    <p style="margin:2px 0">${escapeHtml(ctx.customer.email)}${ctx.customer.phone ? " · " + escapeHtml(ctx.customer.phone) : ""}</p>
    <p style="margin:2px 0">${escapeHtml(ctx.serviceAddress)}</p>
    <h3 style="margin:16px 0 6px 0">Appointment</h3>
    <p style="margin:2px 0"><strong>${escapeHtml(dt)}</strong> (Central Time)</p>
    <p style="margin:2px 0">Tech / team: ${escapeHtml(ctx.technicianName || "—")}</p>
    ${durHrs ? `<p style="margin:2px 0">Estimated duration: ${durHrs} hrs (${durMin} min)</p>` : ""}
    <h3 style="margin:16px 0 6px 0">Services</h3>
    <ul style="margin:0;padding-left:18px">${renderServiceLines(ctx.services)}</ul>
    <table style="width:100%;margin-top:12px">
      <tr><td>Subtotal</td><td align="right">${fmtPrice(ctx.subtotal)}</td></tr>
      ${ctx.discountAmount > 0 ? `<tr><td>Discounts</td><td align="right">-${fmtPrice(ctx.discountAmount)}${ctx.discountCode ? ` (${escapeHtml(ctx.discountCode)})` : ""}</td></tr>` : ""}
      <tr><td style="font-weight:700">Booked revenue</td><td align="right" style="font-weight:700">${fmtPrice(ctx.total)}</td></tr>
    </table>
    <h3 style="margin:16px 0 6px 0">Attribution</h3>
    <p style="margin:2px 0">Source: ${escapeHtml(ctx.attributionSource || ctx.utm?.source || "—")}</p>
    <p style="margin:2px 0">Landing page: ${escapeHtml(ctx.utm?.landing_page_slug || "—")}</p>
    <p style="margin:2px 0">UTM campaign: ${escapeHtml(ctx.utm?.campaign || "—")}</p>
    <p style="margin:2px 0">UTM content: ${escapeHtml(ctx.utm?.content || "—")}</p>
    <h3 style="margin:16px 0 6px 0">IDs</h3>
    <p style="margin:2px 0">Reference: ${escapeHtml(ctx.referenceNumber)}</p>
    <p style="margin:2px 0">Booking ID: ${escapeHtml(ctx.bookingId)}</p>
    <p style="margin:2px 0">Jobber Job ID: ${escapeHtml(ctx.jobberJobId ?? "—")}</p>
    <p style="margin:2px 0">Jobber Visit ID: ${escapeHtml(ctx.jobberVisitId)}</p>
    <p style="margin:14px 0 0 0"><a href="${APP_URL}/admin?booking=${encodeURIComponent(ctx.bookingId)}">Open in BluLadder admin →</a></p>
  `;
  return { subject, html: shell(inner) };
}

export type ChannelStatus =
  | "sent"
  | "suppressed_test_identity"
  | "suppressed"
  | "provider_rejected"
  | "delivery_failed"
  | "not_attempted";

export interface ChannelResult {
  channel: "customer_email" | "owner_email";
  status: ChannelStatus;
  recipient: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  idempotencyKey: string;
  dedup: boolean;
}

// deno-lint-ignore no-explicit-any
async function alreadySent(supabase: any, bookingId: string, channel: string): Promise<boolean> {
  const { data } = await supabase
    .from("notification_events")
    .select("id, sent_at, suppressed")
    .eq("booking_id", bookingId)
    .eq("channel", channel)
    .not("sent_at", "is", null)
    .limit(1);
  if (data && data.length > 0) return true;
  // A prior explicit suppression of a test identity is also a terminal state.
  const { data: sup } = await supabase
    .from("notification_events")
    .select("id, suppressed_reason")
    .eq("booking_id", bookingId)
    .eq("channel", channel)
    .like("suppressed_reason", "test_identity%")
    .limit(1);
  return !!(sup && sup.length > 0);
}

// deno-lint-ignore no-explicit-any
async function logEvent(supabase: any, bookingId: string, channel: string, res: ChannelResult, subject: string) {
  try {
    await supabase.from("notification_events").insert({
      booking_id: bookingId,
      event_type: "booking_confirmed",
      triggered_by: "system",
      channel,
      sent_at: res.status === "sent" ? new Date().toISOString() : null,
      suppressed: res.status.startsWith("suppressed"),
      suppressed_reason: res.status === "suppressed_test_identity"
        ? "test_identity"
        : (res.status === "suppressed" ? "suppressed" : null),
      notification_content: {
        subject,
        recipient: res.recipient,
        idempotencyKey: res.idempotencyKey,
        providerMessageId: res.providerMessageId,
        status: res.status,
        error: res.errorMessage,
      },
    });
  } catch (e) {
    console.warn("notification_events insert failed", (e as Error).message);
  }
}

// deno-lint-ignore no-explicit-any
async function sendOne(
  supabase: any,
  channel: "customer_email" | "owner_email",
  ctx: BookingEmailContext,
  recipient: string,
  subject: string,
  html: string,
  fromName: string,
): Promise<ChannelResult> {
  const idempotencyKey = `${channel === "customer_email" ? "customer_booking_email" : "owner_booking_email"}_${ctx.bookingId}`;

  if (await alreadySent(supabase, ctx.bookingId, channel)) {
    return { channel, status: "sent", recipient, providerMessageId: null, errorMessage: null, idempotencyKey, dedup: true };
  }

  if (!recipient || !recipient.includes("@")) {
    const r: ChannelResult = { channel, status: "not_attempted", recipient: recipient || "", providerMessageId: null, errorMessage: "Missing recipient", idempotencyKey, dedup: false };
    await logEvent(supabase, ctx.bookingId, channel, r, subject);
    return r;
  }

  const sup = await checkSuppression(supabase, { email: recipient });
  if (sup.suppressed) {
    const isTest = sup.reason === "test_identity";
    const r: ChannelResult = {
      channel, recipient, providerMessageId: null,
      status: isTest ? "suppressed_test_identity" : "suppressed",
      errorMessage: sup.reason ? `Suppressed (${sup.reason})` : "Suppressed",
      idempotencyKey, dedup: false,
    };
    await logEvent(supabase, ctx.bookingId, channel, r, subject);
    return r;
  }

  const send = await sendEmail({ to: recipient, subject, html, fromNameOverride: fromName });
  const r: ChannelResult = send.ok
    ? { channel, status: "sent", recipient, providerMessageId: send.providerMessageId, errorMessage: null, idempotencyKey, dedup: false }
    : {
        channel, recipient, providerMessageId: null,
        status: send.failure?.reachedProvider ? "provider_rejected" : "delivery_failed",
        errorMessage: send.failure?.message || "Email provider failure",
        idempotencyKey, dedup: false,
      };
  await logEvent(supabase, ctx.bookingId, channel, r, subject);
  return r;
}

// deno-lint-ignore no-explicit-any
export async function sendBookingConfirmationEmails(supabase: any, ctx: BookingEmailContext): Promise<{
  customer: ChannelResult; owner: ChannelResult;
}> {
  if (!ctx.jobberVisitId) {
    const skip = (channel: "customer_email" | "owner_email", recipient: string): ChannelResult => ({
      channel, status: "not_attempted", recipient, providerMessageId: null,
      errorMessage: "Skipped: no Jobber visit id",
      idempotencyKey: `${channel === "customer_email" ? "customer_booking_email" : "owner_booking_email"}_${ctx.bookingId}`,
      dedup: false,
    });
    return { customer: skip("customer_email", ctx.customer.email), owner: skip("owner_email", getOwnerRecipient()) };
  }

  // Preparation instructions: load admin config, resolve per booked service,
  // and dedupe by bookings.prep_email_sent_at so a reschedule (which reuses
  // this same code path for the change confirmation) never repeats prep the
  // customer already received.
  const alreadySentPrep = await hasPrepAlreadyBeenSent(supabase, ctx.bookingId);
  const prepBlocks = alreadySentPrep
    ? [] // suppress prep on the reschedule confirmation copy
    : buildPrepBlocks(ctx.services ?? [], await loadActivePrepConfigs(supabase));

  const cust = customerHtml(ctx, prepBlocks);
  const own = ownerHtml(ctx);

  // Fire the two sends in parallel — one channel failing must never block the other.
  const [customer, owner] = await Promise.all([
    sendOne(supabase, "customer_email", ctx, ctx.customer.email, cust.subject, cust.html, "BluLadder"),
    sendOne(supabase, "owner_email", ctx, getOwnerRecipient(), own.subject, own.html, "BluLadder Booking Alert"),
  ]);

  // Mark prep as delivered ONLY on a successful first send that actually
  // contained the prep block. This preserves dedupe correctness: a suppressed
  // or provider-rejected send never counts as prep-delivered, and a repeated
  // send (dedup=true) does not overwrite the earlier authoritative marker.
  if (!alreadySentPrep && prepBlocks.length > 0 && customer.status === "sent" && !customer.dedup) {
    await markPrepSent(supabase, ctx.bookingId);
  }

  return { customer, owner };
}