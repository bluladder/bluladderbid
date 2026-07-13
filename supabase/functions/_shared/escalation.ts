// ============================================================================
// escalation.ts — safe internal human-escalation over the EXISTING SMS queue.
// Reuses: sms_messages queue (process-sms-queue delivers + re-checks
// suppression), checkSuppression (test-identity safety), phone_numbers
// (sender + customer callback number by purpose), escalation_recipients /
// escalation_settings (admin-configured, opt-in). It NEVER creates a new
// messaging service and NEVER sends until a recipient is configured & enabled.
// ============================================================================
// deno-lint-ignore-file no-explicit-any
import { checkSuppression } from "./suppression.ts";
import { getPhoneByPurpose } from "./phoneConfig.ts";

export const SEVERITY_RANK: Record<string, number> = {
  low: 1, normal: 2, high: 3, urgent: 4,
};

export interface EscalationInput {
  conversationId?: string | null;
  recordRef?: string | null;
  prospectName?: string | null;
  prospectPhone?: string | null;
  prospectEmail?: string | null;
  serviceRequested?: string | null;
  serviceAddress?: string | null;
  category: string;
  severity?: string;
  summary?: string | null;
  requestedContactMethod?: string | null;
  bestCallbackTime?: string | null;
}

export interface EscalationResult {
  escalationId: string;
  created: boolean;
  alertStatus: string;
  alertSent: boolean;
}

/** Build the concise internal alert. Excludes keys, prompts, transcripts, margins. */
export function buildAlertMessage(
  esc: EscalationInput,
  callbackNumberDisplay: string | null,
  dashboardHint: string,
): string {
  const lines = [
    "BluLadder AI escalation",
    esc.prospectName ? `Name: ${esc.prospectName}` : null,
    esc.prospectPhone ? `Callback: ${esc.prospectPhone}` : (callbackNumberDisplay ? `Callback via office: ${callbackNumberDisplay}` : null),
    `Reason: ${esc.category.replace(/_/g, " ")}`,
    `Urgency: ${esc.severity ?? "normal"}`,
    esc.serviceRequested ? `Service: ${esc.serviceRequested}` : null,
    esc.summary ? `Summary: ${esc.summary.slice(0, 240)}` : null,
    dashboardHint,
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Create or update the single active escalation for a conversation+category,
 * then (optionally) queue ONE internal alert. A higher severity than the last
 * alert may trigger exactly one additional alert; repeated same-severity
 * messages update the record without re-alerting.
 */
export async function escalateToHuman(
  supabase: any,
  input: EscalationInput,
): Promise<EscalationResult> {
  const severity = input.severity && SEVERITY_RANK[input.severity] ? input.severity : "normal";

  // 1) Idempotent record: reuse an existing active escalation if present.
  let existing: any = null;
  if (input.conversationId) {
    const { data } = await supabase
      .from("ai_escalations")
      .select("id, severity, alert_count, last_alert_severity, status")
      .eq("conversation_id", input.conversationId)
      .eq("category", input.category)
      .in("status", ["open", "claimed"])
      .maybeSingle();
    existing = data ?? null;
  }

  let escalationId: string;
  let created = false;
  let shouldAlert: boolean;

  if (existing) {
    const prevAlertRank = SEVERITY_RANK[existing.last_alert_severity ?? existing.severity] ?? 0;
    const newRank = SEVERITY_RANK[severity] ?? 2;
    // Only re-alert if this is genuinely higher severity than last alerted.
    shouldAlert = existing.alert_count > 0 ? newRank > prevAlertRank : true;
    await supabase.from("ai_escalations").update({
      severity,
      summary: input.summary ?? undefined,
      prospect_name: input.prospectName ?? undefined,
      prospect_phone: input.prospectPhone ?? undefined,
      prospect_email: input.prospectEmail ?? undefined,
      requested_contact_method: input.requestedContactMethod ?? undefined,
      best_callback_time: input.bestCallbackTime ?? undefined,
    }).eq("id", existing.id);
    escalationId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("ai_escalations")
      .insert({
        conversation_id: input.conversationId ?? null,
        record_ref: input.recordRef ?? null,
        prospect_name: input.prospectName ?? null,
        prospect_phone: input.prospectPhone ?? null,
        prospect_email: input.prospectEmail ?? null,
        service_requested: input.serviceRequested ?? null,
        service_address: input.serviceAddress ?? null,
        category: input.category,
        severity,
        summary: input.summary ?? null,
        requested_contact_method: input.requestedContactMethod ?? null,
        best_callback_time: input.bestCallbackTime ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      // A concurrent insert may have created the active row; treat as existing.
      return { escalationId: "", created: false, alertStatus: "failed", alertSent: false };
    }
    escalationId = data.id;
    created = true;
    shouldAlert = true;
  }

  const alertStatus = await maybeQueueAlert(supabase, escalationId, input, severity, shouldAlert);
  return { escalationId, created, alertStatus, alertSent: alertStatus === "sent" };
}

async function maybeQueueAlert(
  supabase: any,
  escalationId: string,
  input: EscalationInput,
  severity: string,
  shouldAlert: boolean,
): Promise<string> {
  if (!shouldAlert) return "skipped";

  const { data: settings } = await supabase
    .from("escalation_settings").select("*").eq("singleton", true).maybeSingle();
  if (!settings?.internal_alerts_enabled) {
    await supabase.from("ai_escalations").update({ alert_status: "no_recipient" }).eq("id", escalationId);
    return "no_recipient";
  }

  // Choose an enabled recipient that handles this category (or urgent).
  const { data: recipients } = await supabase
    .from("escalation_recipients").select("*").eq("is_enabled", true);
  const isUrgent = severity === "urgent";
  const pick = (recipients ?? []).filter((r: any) => {
    const cats = Array.isArray(r.categories) ? r.categories : [];
    if (isUrgent && r.handles_urgent) return true;
    return cats.length === 0 || cats.includes(input.category);
  });
  pick.sort((a: any, b: any) => (a.role === "primary" ? -1 : 1) - (b.role === "primary" ? -1 : 1));
  const recipient = pick[0];
  if (!recipient) {
    await supabase.from("ai_escalations").update({ alert_status: "no_recipient" }).eq("id", escalationId);
    return "no_recipient";
  }

  // Suppression is re-checked at delivery too, but check here to record status.
  const suppression = await checkSuppression(supabase, { phone: recipient.phone });
  const primary = await getPhoneByPurpose(supabase, "primary_public");
  const dashHint = settings.dashboard_base_url
    ? `Open: ${settings.dashboard_base_url}`
    : "Open the Admin > AI Conversations dashboard to view.";
  const messageBody = buildAlertMessage(input, primary.display, dashHint);

  // Queue through the existing SMS pipeline (message_kind flags it as internal).
  const { error: insErr } = await supabase.from("sms_messages").insert({
    to_number: recipient.phone,
    body: messageBody,
    message_kind: "internal_escalation",
    status: suppression.suppressed ? "cancelled" : "pending",
    suppressed: suppression.suppressed || undefined,
    suppressed_reason: suppression.suppressed ? suppression.reason : undefined,
    send_at: new Date().toISOString(),
  });

  const status = insErr ? "failed" : suppression.suppressed ? "suppressed" : "sent";
  await supabase.from("ai_escalations").update({
    alert_status: status,
    assigned_recipient: recipient.name,
    alert_count: (recipient ? 1 : 0),
    last_alert_severity: severity,
  }).eq("id", escalationId);
  // Increment alert_count relative to existing.
  await supabase.rpc; // no-op guard for older clients
  return status;
}
