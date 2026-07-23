// ============================================================================
// callrailEventProcessor — the ONE canonical processing pipeline for a
// persisted `callrail_inbound_events` receipt. Used by:
//   1. the initial authenticated webhook after durable receipt insert
//   2. the automatic retry sweep driven by process-sms-queue
//   3. admin-triggered replay
//
// The processor NEVER inserts the provider receipt again. It NEVER mints a
// new classifier, AI path, or campaign path — every side effect flows
// through the same canonical helpers the initial webhook uses.
//
// Idempotency is layered:
//   • inbound sms_messages row keyed by provider_message_id
//   • campaign events keyed on idempotencyKey derived from provider_message_id
//   • BOOK-IT and AI outbound rows check for an existing send tagged with
//     `related_provider_message_id` in the body-agnostic `error` field is
//     avoided; we tag `provider_message_id` on our own outbound message when
//     CallRail returns one, and use a lookup on message_kind + to_number +
//     receipt window to prevent double-sends across retries.
// ============================================================================
// deno-lint-ignore-file no-explicit-any
import { normalizePhone, classifyInbound, getCallRailConfig, sendCallRailSms } from "./sms.ts";
import { classifyInboundIntent, renderBookingAutoReply } from "./bookingIntent.ts";
import { emitCampaignEvent } from "./campaignEmitter.ts";
import { getAppUrl } from "./appUrl.ts";
import { routeInboundSmsToOrchestrator, SMS_REPLY_MAX_CHARS } from "./smsOrchestrator.ts";
import {
  markAttempt, markProcessed,
  classifyError, isTransient, nextAttemptAt, MAX_ATTEMPTS,
} from "./callrailReceipts.ts";
import { resolveInboundContext } from "./conversationContext.ts";
import {
  isGenuineInboundCustomerMessage,
  notifyOwnerOfInboundReply,
} from "./ownerNotifications.ts";
import { getPhoneByPurpose } from "./phoneConfig.ts";
import { generateDraftReply, shouldAutoDraft } from "./draftReply.ts";
import { evaluateAiSafetyGate, logGateDecision } from "./aiSafetyGate.ts";
import { sendAutonomousCallRailSms } from "./autonomousSendGate.ts";
import { readIdentityAnchor } from "./identityAnchor.ts";

type Supa = any;

export interface ProcessResult {
  ok: boolean;
  action: string;
  category?: string;
  attemptsAfter?: number;
}

/**
 * Process a receipt that has already been durably persisted. Callers MUST
 * hand us a row whose status has been claimed (set to 'processing') so two
 * workers cannot pick up the same event. On completion the row is marked
 * processed or moved to retry_pending / failed.
 */
export async function processPersistedCallRailEvent(
  supabase: Supa,
  eventId: string,
): Promise<ProcessResult> {
  const { data: row, error } = await supabase
    .from("callrail_inbound_events")
    .select("id, provider_message_id, from_phone, to_phone, payload_safe, received_at, attempts, sms_message_id, processed_at")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !row) {
    return { ok: false, action: "not_found" };
  }

  const payload = (row.payload_safe ?? {}) as Record<string, unknown>;
  const providerMessageId: string = row.provider_message_id;
  const phone: string | null =
    (typeof payload.normalized_phone === "string" ? payload.normalized_phone : null)
    ?? normalizePhone(row.from_phone)
    ?? row.from_phone;
  if (!phone) {
    await markAttempt(supabase, row.id, {
      status: "failed", last_error_category: "invalid_payload",
      last_error_detail: "no phone", next_attempt_at: null,
    });
    return { ok: false, action: "no_phone" };
  }

  const content: string = typeof payload.content === "string" ? payload.content
    : typeof payload.message === "string" ? payload.message
    : typeof payload.body === "string" ? payload.body
    : typeof payload.text === "string" ? payload.text
    : typeof payload.sms_body === "string" ? payload.sms_body : "";
  const nowIso = new Date().toISOString();

  const richIntent = classifyInboundIntent(content);
  const intent = classifyInbound(content);
  const complianceIntent: "stop" | "start" | null =
    richIntent.kind === "stop" ? "stop"
    : richIntent.kind === "start" ? "start"
    : null;

  // ---- Idempotent inbound sms_messages row -------------------------------
  // Keyed on provider_message_id so retry/replay never inserts a duplicate.
  let inboundSmsId: string | null = (row.sms_message_id as string | null) ?? null;
  if (!inboundSmsId) {
    const { data: existing } = await supabase
      .from("sms_messages")
      .select("id")
      .eq("provider_message_id", providerMessageId)
      .eq("message_kind", "inbound")
      .maybeSingle();
    if (existing?.id) {
      inboundSmsId = existing.id as string;
    } else {
      const { data: inserted } = await supabase.from("sms_messages").insert({
        to_number: phone,
        body: content || "(empty)",
        message_kind: "inbound",
        status: "inbound",
        sent_at: nowIso,
        provider_message_id: providerMessageId,
      }).select("id").maybeSingle();
      inboundSmsId = (inserted?.id as string | undefined) ?? null;
    }
  }

  const runProcessing = async (): Promise<{ action: string }> => {
    // ---- Conversation context (idempotent thread upsert) ----------------
    // Runs BEFORE side-effects so the row & thread are visible even if
    // downstream steps throw. If resolution fails we still let the
    // pipeline continue — owner notification just won't fire.
    let resolved: Awaited<ReturnType<typeof resolveInboundContext>> | null = null;
    try {
      resolved = await resolveInboundContext(supabase, { fromPhone: phone, receivedAt: row.received_at });
      // Backlink the provider event row to the thread + resolved customer.
      await supabase.from("callrail_inbound_events").update({
        conversation_id: resolved.conversationId,
        customer_id: resolved.customerId,
      }).eq("id", row.id);
    } catch (e) {
      console.error("resolveInboundContext failed:", e);
    }

    // ---- Owner notification (genuine inbound only, idempotent) ----------
    if (resolved) {
      try {
        const ownedNumbers: string[] = [];
        try {
          const [pub, ai, esc] = await Promise.all([
            getPhoneByPurpose(supabase, "primary_public"),
            getPhoneByPurpose(supabase, "app_ai"),
            getPhoneByPurpose(supabase, "escalation_sender"),
          ]);
          for (const p of [pub?.e164, ai?.e164, esc?.e164]) {
            if (p && !ownedNumbers.includes(p)) ownedNumbers.push(p);
          }
        } catch { /* fall through with empty list */ }

        const gate = isGenuineInboundCustomerMessage({
          content,
          complianceIntent,
          richIntentKind: richIntent.kind,
          fromPhone: phone,
          ownedSenderNumbers: ownedNumbers,
          eventType: null,
        });
        if (gate.ok) {
          await notifyOwnerOfInboundReply(supabase, {
            eventId: row.id,
            providerMessageId,
            fromPhone: phone,
            messagePreview: content,
            context: resolved,
          });
        } else {
          await supabase.from("callrail_inbound_events").update({
            owner_notification_skipped_reason: gate.reason ?? "not_genuine_inbound",
          }).eq("id", row.id);
        }

        // ---- AI-assisted draft reply (Phase 1: never sends) --------------
        // Safety gates FAIL CLOSED. Any read failure of a switch, pause
        // flag, staff takeover, or suppression state blocks the autonomous
        // draft — the conversation is already persisted and staff will see
        // it in the admin queue via the owner notification path above.
        try {
          const safety = await evaluateAiSafetyGate(supabase, {
            action: "auto_reply",
            conversationId: resolved.conversationId,
            phone,
          });
          logGateDecision("callrailEventProcessor.autoDraft", safety, {
            provider_message_id: providerMessageId,
            conversation_id: resolved.conversationId,
          });

          const draftGate = shouldAutoDraft({
            content,
            isGenuine: gate.ok,
            staffTakeover: !!safety.checks.staffTakeoverAt,
            resolutionConfidence: resolved.resolutionConfidence ?? null,
            aiSmsEnabled: safety.checks.aiSmsEnabled === true,
            autoreplyPaused: safety.checks.conversationPaused !== false ? true : false,
          });
          if (
            safety.allow &&
            draftGate.ok &&
            resolved.conversationId &&
            inboundSmsId
          ) {
            await generateDraftReply(supabase, {
              conversationId: resolved.conversationId,
              inboundMessageId: inboundSmsId,
              reason: "auto_inbound",
            });
          }
        } catch (e) {
          // Any unexpected throw ⇒ fail closed. Do not draft.
          console.error(JSON.stringify({
            at: "callrailEventProcessor.autoDraft",
            allow: false,
            reason: "unexpected_exception",
            detail: String(e).slice(0, 200),
            provider_message_id: providerMessageId,
          }));
        }
      } catch (e) {
        console.error("owner notification failed:", e);
      }
    }

    // customer_replied — keyed on provider_message_id
    try {
      await emitCampaignEvent({
        eventName: "customer_replied",
        idempotencyKey: `customer_replied:${providerMessageId}`,
        phone,
        source: "callrail",
        subject: "Inbound SMS reply",
        recoverySupabase: supabase,
        metadata: { intent, provider_message_id: providerMessageId },
      });
    } catch (e) {
      console.error("customer_replied emit failed:", e);
    }

    // Escalation
    if (complianceIntent === null && richIntent.kind === "escalation") {
      try {
        await emitCampaignEvent({
          eventName: "manual_staff_takeover",
          idempotencyKey: `manual_staff_takeover:${providerMessageId}`,
          phone,
          source: "callrail",
          subject: `Inbound reply escalation: ${richIntent.category}`,
          recoverySupabase: supabase,
          metadata: {
            reason: richIntent.category,
            provider_message_id: providerMessageId,
            inbound_preview: (content || "").slice(0, 200),
          },
        });
      } catch (e) {
        console.error("manual_staff_takeover emit failed:", e);
      }
    }

    // BOOK-IT — one auto-reply per receipt.
    if (complianceIntent === null && richIntent.kind === "booking") {
      const bookItSentinelKind = "auto_reply_booking_intent";
      // Query for prior auto-reply already emitted for this receipt.
      const { data: alreadySent } = await supabase
        .from("sms_messages")
        .select("id")
        .eq("to_number", phone)
        .eq("message_kind", bookItSentinelKind)
        .gte("created_at", row.received_at)
        .limit(1)
        .maybeSingle();
      if (!alreadySent) {
        try {
          const appUrl = getAppUrl();
          let quoteLink = `${appUrl}/quote`;
          let firstName: string | null = null;
          const { data: customer } = await supabase
            .from("customers").select("id, first_name").eq("phone", phone).maybeSingle();
          if (customer) {
            firstName = customer.first_name ?? null;
            const { data: quote } = await supabase
              .from("quotes").select("id, updated_at").eq("customer_id", customer.id)
              .order("updated_at", { ascending: false }).limit(1).maybeSingle();
            if (quote?.id) {
              const { mintResumeUrl } = await import("./resumeLink.ts");
              quoteLink = await mintResumeUrl(supabase, quote.id, { reason: "callrail_book_it_reply" });
            }
          }
          const callrail = getCallRailConfig();
          if (callrail) {
            const reply = renderBookingAutoReply({ firstName, quoteLink });
            // Gated autonomous send. BOOK-IT is a canned auto-reply pointing
            // the customer at the resume link — classified `informational`
            // because it makes no customer-specific commitment and requires
            // no identity anchor.
            await sendAutonomousCallRailSms(supabase, {
              conversationId: resolved?.conversationId ?? null,
              phone,
              actionClass: "informational",
              body: reply,
              callRail: callrail,
              messageKind: bookItSentinelKind,
              where: "callrailEventProcessor.bookItAutoReply",
              extraLog: { provider_message_id: providerMessageId },
            });
          }
        } catch (e) {
          console.error("BOOK-IT auto-reply failed:", e);
        }
      }
    }

    if (complianceIntent === "stop") {
      await supabase.from("sms_opt_outs").upsert({
        phone, opted_out: true, source: "customer_reply",
        reason: "Replied STOP", last_inbound_body: content, opted_out_at: nowIso,
      }, { onConflict: "phone" });
      await supabase.from("sms_messages")
        .update({ status: "cancelled", error: "Recipient opted out (STOP)" })
        .eq("to_number", phone).eq("status", "pending");
      return { action: "opted_out" };
    }
    if (complianceIntent === "start") {
      await supabase.from("sms_opt_outs").upsert({
        phone, opted_out: false, source: "customer_reply",
        reason: "Replied START", last_inbound_body: content, opted_in_at: nowIso,
      }, { onConflict: "phone" });
      return { action: "opted_in" };
    }

    // AI conversational routing — skip if we already replied for this receipt.
    const aiKind = "ai_conversation";
    const bookedAlready = complianceIntent === null && richIntent.kind === "booking";
    const { data: aiAlready } = await supabase
      .from("sms_messages")
      .select("id")
      .eq("to_number", phone)
      .eq("message_kind", aiKind)
      .gte("created_at", row.received_at)
      .limit(1)
      .maybeSingle();
    if (aiAlready) return { action: "ai_already_sent" };

    try {
      const callrail = getCallRailConfig();
      const result = await routeInboundSmsToOrchestrator({
        supabase, phoneE164: phone, userMessage: content, providerMessageId,
      });
      if (callrail && result.reply && !bookedAlready) {
        // Central send-boundary gate. Reads identity_anchor and classifies
        // the outbound action so ambiguous threads can only send the ONE
        // permitted email-disambiguation ask; any customer-specific
        // scheduling / booking-advancing reply is blocked.
        const identity = await readIdentityAnchor(
          supabase,
          result.conversationId || null,
        );
        const actionClass = identity.identity_status === "ambiguous"
          ? "identity_resolution"
          : "informational";
        const messageKind = actionClass === "identity_resolution"
          ? "ai_identity_resolution"
          : aiKind;
        const outcome = await sendAutonomousCallRailSms(supabase, {
          conversationId: result.conversationId || null,
          phone,
          actionClass,
          body: result.reply.slice(0, SMS_REPLY_MAX_CHARS),
          callRail: callrail,
          messageKind,
          dedupeIdentityResolution: true,
          where: "callrailEventProcessor.aiReply",
          extraLog: {
            provider_message_id: providerMessageId,
            conversation_id: result.conversationId,
          },
        });
        if (!outcome.decision.allow) {
          return { action: `ai_blocked:${outcome.decision.reason}` };
        }
        return { action: outcome.sent ? "ai_replied" : "ai_reply_failed" };
      }
      return { action: bookedAlready ? "book_it_handled" : "logged" };
    } catch (e) {
      console.error("SMS orchestrator route failed:", e);
      throw e;
    }
  };

  try {
    const result = await runProcessing();
    await markProcessed(supabase, row.id, { smsMessageId: inboundSmsId });
    return { ok: true, action: result.action };
  } catch (procErr) {
    const { category, detail } = classifyError(procErr);
    const attemptsAfter = ((row.attempts as number | undefined) ?? 0) + 1;
    const canRetry = isTransient(category) && attemptsAfter < MAX_ATTEMPTS;
    await markAttempt(supabase, row.id, {
      status: canRetry ? "retry_pending" : "failed",
      last_error_category: category,
      last_error_detail: detail,
      next_attempt_at: canRetry ? nextAttemptAt(attemptsAfter) : null,
      sms_message_id: inboundSmsId,
    });
    return { ok: false, action: canRetry ? "retry_pending" : "failed", category, attemptsAfter };
  }
}

/**
 * Automatic retry sweep. Atomically claims up to `limit` due retry_pending
 * rows (via the `claim_due_callrail_retries` SQL function using row-locking
 * SKIP LOCKED semantics), then processes each through the canonical
 * processor. Safe to run from an already-scheduled cron; no new scheduler.
 */
export async function processDueCallRailRetries(
  supabase: Supa,
  limit = 25,
): Promise<{ claimed: number; processed: number; failed: number; retried: number }> {
  const bound = Math.max(1, Math.min(limit, 100));
  let claimed: Array<{ id: string }> = [];
  try {
    const { data } = await supabase.rpc("claim_due_callrail_retries", { _limit: bound });
    claimed = (data ?? []) as Array<{ id: string }>;
  } catch (e) {
    console.error("claim_due_callrail_retries rpc failed:", e);
    return { claimed: 0, processed: 0, failed: 0, retried: 0 };
  }
  let processed = 0, failed = 0, retried = 0;
  for (const c of claimed) {
    const r = await processPersistedCallRailEvent(supabase, c.id);
    if (r.ok) processed++;
    else if (r.action === "retry_pending") retried++;
    else failed++;
  }
  return { claimed: claimed.length, processed, failed, retried };
}