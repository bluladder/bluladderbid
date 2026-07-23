// ============================================================================
// ownerNotifications — send Ben a concise SMS+email alert when a real
// customer message lands in the inbox, so he never sees "just a phone
// number". Reuses the existing sms_messages queue and the shared sendEmail
// helper so nothing new gets past suppression/opt-out checks.
//
// Idempotency: keyed on callrail_inbound_events.owner_notified_at. One
// provider message → at most one owner notification, forever. Duplicate
// webhook retries, delivery receipts, STOP/START, and internal system
// messages are excluded by the CALLER (callrailEventProcessor).
// ============================================================================
// deno-lint-ignore-file no-explicit-any
import { checkSuppression } from "./suppression.ts";
import { sendEmail } from "./emailConfig.ts";
import { getAppUrl } from "./appUrl.ts";
import type { ResolvedContext } from "./conversationContext.ts";

type Supa = any;

export interface OwnerNotifyInput {
  eventId: string;                // callrail_inbound_events.id
  providerMessageId: string;
  fromPhone: string;
  messagePreview: string;
  context: ResolvedContext;
}

export interface OwnerNotifyResult {
  notified: boolean;
  skippedReason?: string;
  recipients: number;
  smsQueued: number;
  emailSent: number;
}

/**
 * Build the exact SMS/email body. Concise, only available fields, always
 * ends with the deep link. Pure function — safe to unit-test.
 */
export function buildInboundOwnerMessage(
  input: Omit<OwnerNotifyInput, "eventId">,
  adminUrl: string,
): string {
  const c = input.context;
  const who = c.customerName
    ? `${c.customerName} (${input.fromPhone})`
    : input.fromPhone;
  const parts: (string | null)[] = [
    "BluLadder: new customer reply",
    `From: ${who}`,
    c.serviceAddress ? `Address: ${c.serviceAddress}` : null,
    c.latestQuoteId ? `Quote: ${c.latestQuoteId.slice(0, 8)}` : null,
    c.latestBookingId ? `Booking: ${c.latestBookingId.slice(0, 8)}` : null,
    c.matchNeedsReview ? "Customer match needs review" : null,
    input.messagePreview ? `Msg: ${input.messagePreview.slice(0, 160)}` : null,
    `Open: ${adminUrl}`,
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Notify escalation_recipients about a genuine inbound customer message.
 * Fail-soft: any recipient failure is logged, the others still get through.
 * Records `owner_notified_at` at the end so retries never double-send.
 */
export async function notifyOwnerOfInboundReply(
  supabase: Supa,
  input: OwnerNotifyInput,
): Promise<OwnerNotifyResult> {
  // Idempotency guard — re-check the row inside the transaction of intent.
  const { data: guard } = await supabase
    .from("callrail_inbound_events")
    .select("owner_notified_at")
    .eq("id", input.eventId)
    .maybeSingle();
  if (guard?.owner_notified_at) {
    return { notified: false, skippedReason: "already_notified", recipients: 0, smsQueued: 0, emailSent: 0 };
  }

  const { data: settings } = await supabase
    .from("escalation_settings").select("*").eq("singleton", true).maybeSingle();
  const alertsOn = !!settings?.internal_alerts_enabled;
  const emailOn = !!settings?.email_alerts_enabled;

  if (!alertsOn) {
    await supabase.from("callrail_inbound_events").update({
      owner_notification_skipped_reason: "internal_alerts_disabled",
    }).eq("id", input.eventId);
    return { notified: false, skippedReason: "internal_alerts_disabled", recipients: 0, smsQueued: 0, emailSent: 0 };
  }

  const { data: recipients } = await supabase
    .from("escalation_recipients").select("*").eq("is_enabled", true);
  const rs = (recipients ?? []) as Array<any>;
  if (rs.length === 0) {
    await supabase.from("callrail_inbound_events").update({
      owner_notification_skipped_reason: "no_recipient_configured",
    }).eq("id", input.eventId);
    return { notified: false, skippedReason: "no_recipient_configured", recipients: 0, smsQueued: 0, emailSent: 0 };
  }

  const adminUrl = `${getAppUrl()}/admin?tab=conversations&conversation=${input.context.conversationId}`;
  const body = buildInboundOwnerMessage(input, adminUrl);
  const subject = `BluLadder: new customer reply${input.context.matchNeedsReview ? " (match needs review)" : ""}`;
  const defaultEmail = (settings?.notify_email as string | null) ?? null;

  let smsQueued = 0;
  let emailSent = 0;
  const nowIso = new Date().toISOString();

  for (const r of rs) {
    // SMS via existing queue (respects suppression at delivery, but we also
    // mark the row as cancelled here so it never leaves BluLadder).
    try {
      const suppression = await checkSuppression(supabase, { phone: r.phone });
      const { error } = await supabase.from("sms_messages").insert({
        to_number: r.phone,
        body,
        message_kind: "owner_inbound_notification",
        status: suppression.suppressed ? "cancelled" : "pending",
        suppressed: suppression.suppressed || undefined,
        suppressed_reason: suppression.suppressed ? suppression.reason : undefined,
        send_at: nowIso,
      });
      if (!error && !suppression.suppressed) smsQueued += 1;
    } catch (e) {
      console.error("owner sms enqueue failed", e);
    }

    // Email (best-effort). Never throws.
    if (emailOn) {
      const target = (r.email as string | null) || defaultEmail;
      if (target) {
        try {
          const es = await checkSuppression(supabase, { email: target });
          if (!es.suppressed) {
            const html = `<pre style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${
              body.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] as string))
            }</pre>`;
            const res = await sendEmail({ to: target, subject, html, fromNameOverride: "BluLadder Alerts" });
            if (res.ok) emailSent += 1;
          }
        } catch (e) {
          console.error("owner email send failed", e);
        }
      }
    }
  }

  await supabase.from("callrail_inbound_events").update({
    owner_notified_at: nowIso,
  }).eq("id", input.eventId);

  return { notified: true, recipients: rs.length, smsQueued, emailSent };
}

/**
 * True when the inbound row is a genuine customer message that Ben should
 * see. Excludes: STOP/START/compliance, delivery receipts, empty bodies,
 * internal system events, and known BluLadder-owned sender numbers.
 */
export function isGenuineInboundCustomerMessage(input: {
  content: string;
  complianceIntent: "stop" | "start" | null;
  richIntentKind: string;   // classifyInboundIntent().kind
  fromPhone: string | null;
  ownedSenderNumbers: string[]; // e.g. BluLadder-owned E.164 numbers
  eventType?: string | null;    // callrail event_type
}): { ok: boolean; reason?: string } {
  if (!input.fromPhone) return { ok: false, reason: "no_from_phone" };
  if (input.complianceIntent) return { ok: false, reason: `compliance_${input.complianceIntent}` };
  const et = (input.eventType ?? "inbound_sms").toLowerCase();
  if (et.includes("status") || et.includes("delivery") || et.includes("receipt")) {
    return { ok: false, reason: "delivery_receipt" };
  }
  if (input.richIntentKind === "system" || input.richIntentKind === "automated") {
    return { ok: false, reason: "internal_system_event" };
  }
  if (input.ownedSenderNumbers.includes(input.fromPhone)) {
    return { ok: false, reason: "from_owned_number" };
  }
  const body = (input.content ?? "").trim();
  if (body.length === 0) return { ok: false, reason: "empty_body" };
  return { ok: true };
}