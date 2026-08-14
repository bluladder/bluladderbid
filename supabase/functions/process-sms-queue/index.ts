// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkPhoneOptOut, getCustomerPause } from "../_shared/sms.ts";
import { requireAdminOrService } from "../_shared/auth.ts";
import { checkSuppression } from "../_shared/suppression.ts";
import {
  recoverPendingCampaignEvents,
  runAbandonmentSweep,
  runDeclinedQuoteEventRepairSweep,
  runFollowUpCompletionSweep,
  runPersistedQuoteAbandonmentSweep,
} from "../_shared/campaignSweep.ts";
import { sendEmail } from "../_shared/emailConfig.ts";
import { processDueCallRailRetries } from "../_shared/callrailEventProcessor.ts";
import {
  runMaintenanceOpportunitySweep,
  runPostServiceEducationSweep,
} from "../_shared/postServiceSweeps.ts";
import { quoteLifecycleAllowsCampaignDelivery } from "../_shared/quoteDecline.ts";
import { hasLifecycleBlockingBooking } from "../_shared/lifecycleBookingCheck.ts";
import {
  emailFailureOutcome,
  type QueueDeliveryOutcome,
  queuedProviderIdempotencyKey,
  queueOutcomePatch,
  smsFailureOutcome,
} from "../_shared/queueDelivery.ts";
import { dispatchSelectedSmsConnector } from "../_shared/smsOutbox.ts";
import { authorizeQueuedSmsConnector } from "../_shared/queuedSmsConnector.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Supa = any;
type QueueMessage = Record<string, any>;

// Exponential-ish backoff (in minutes) applied before each retry, indexed by
// the attempt number that just failed (1st failure -> 5 min, 2nd -> 30 min, ...).
const RETRY_BACKOFF_MINUTES = [5, 30, 120];

function nextRetryIso(attempts: number): string {
  const idx = Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1);
  const minutes = RETRY_BACKOFF_MINUTES[Math.max(0, idx)];
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/**
 * Build the update payload for a failed send. Permanent failures (bad
 * recipient / misconfiguration) are never retried; transient failures are
 * rescheduled with backoff until max_attempts is reached.
 */
interface QueueTransition {
  outcome: QueueDeliveryOutcome;
  patch: Record<string, unknown>;
}

function failureUpdate(
  prevAttempts: number,
  maxAttempts: number,
  errorMsg: string,
  permanent = false,
): QueueTransition {
  const attempts = (prevAttempts ?? 0) + 1;
  const limit = maxAttempts && maxAttempts > 0 ? maxAttempts : 3;
  if (permanent || attempts >= limit) {
    return {
      outcome: "terminal_failure",
      patch: { error: errorMsg, attempts },
    };
  }
  const retryAt = nextRetryIso(attempts);
  return {
    outcome: "retry_pending",
    patch: {
      error: errorMsg,
      attempts,
      send_at: retryAt,
      next_retry_at: retryAt,
    },
  };
}

function transition(
  outcome: QueueDeliveryOutcome,
  patch: Record<string, unknown> = {},
): QueueTransition {
  return { outcome, patch };
}

async function updateClaimedMessage(
  supabase: Supa,
  msg: QueueMessage,
  next: QueueTransition,
  expectedState = "pending_send",
): Promise<boolean> {
  const { data, error } = await supabase
    .from("sms_messages")
    .update(queueOutcomePatch(next.outcome, next.patch))
    .eq("id", msg.id)
    .eq("send_claim_token", msg.send_claim_token)
    .eq("outbox_state", expectedState)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

async function beginProviderSubmission(
  supabase: Supa,
  msg: QueueMessage,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "begin_queued_communication_submission",
    {
      p_sms_message_id: msg.id,
      p_claim_token: msg.send_claim_token,
    },
  );
  return !error && data?.ok === true && data?.may_dispatch === true;
}

// Processes due, pending SMS (campaign follow-ups + any retries). Invoked by cron.
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron/service-to-service or admin only. Prevents anonymous callers from
  // flushing the SMS/email queue (sending queued messages early / at cost).
  const authz = await requireAdminOrService(req);
  if (!authz.ok) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Global launch controls: delivery kill-switch. When on, don't claim or
  // send any queued campaign messages. Rows stay 'pending' and will send
  // once the pause is lifted. Non-campaign transactional writes bypass this
  // processor entirely, so operational SMS/email is unaffected.
  const { data: launchControls, error: launchControlsError } = await supabase
    .from("campaign_launch_controls")
    .select("delivery_paused")
    .eq("id", 1)
    .maybeSingle();
  if (launchControlsError || !launchControls) {
    return new Response(
      JSON.stringify({ error: "Campaign delivery controls are unavailable" }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  if (launchControls?.delivery_paused) {
    return new Response(
      JSON.stringify({
        paused: true,
        sent: 0,
        failed: 0,
        message: "Campaign delivery globally paused",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Atomically claim a batch of due messages. The RPC marks each row as
  // 'processing' under a row lock (SKIP LOCKED) so overlapping runs — now that
  // the queue fires every minute — can never grab or send the same message
  // twice. It also recovers rows stuck in 'processing' from a crashed run.
  const { data: due, error } = await supabase.rpc("claim_due_sms", {
    p_limit: 50,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let failed = 0;

  for (const msg of due || []) {
    // ===== SYSTEM-TEST SUPPRESSION (checked immediately before delivery) =====
    // Never send to an approved test identity while it lacks an allowlisted
    // transactional purpose. Rows on the queue carry a message_kind: only
    // transactional booking-linked retries qualify as an allowlisted purpose.
    // Campaign, manual, and quote-marketing rows pass no purpose and remain
    // suppressed for protected test identities.
    const kind = (msg.message_kind as string) ?? "";
    const queuePurpose = kind === "transactional" && msg.booking_id
      ? "booking_confirmed" as const
      : undefined;
    const suppression = await checkSuppression(
      supabase,
      {
        phone: (msg.to_number as string) ?? null,
        email: (msg.to_email as string) ?? null,
      },
      queuePurpose ? { purpose: queuePurpose } : undefined,
    );
    if (suppression.lookupFailed) {
      await updateClaimedMessage(
        supabase,
        msg,
        failureUpdate(
          msg.attempts,
          msg.max_attempts,
          "Suppression state unavailable",
        ),
      );
      failed++;
      continue;
    }
    if (suppression.suppressed) {
      await updateClaimedMessage(
        supabase,
        msg,
        transition("cancelled", {
          suppressed: true,
          suppressed_reason: suppression.reason,
          error: `Suppressed (${suppression.reason})`,
        }),
      );
      continue;
    }

    // ===== CAMPAIGN DELIVERY SAFETY (rechecked immediately before send) =====
    // For campaign/marketing messages, re-verify that the campaign is still
    // active, the enrollment is still active, and consent still permits this
    // message type. Any stop condition that fired after queueing cancels the
    // send here. Transactional messages have no enrollment and skip this gate.
    if (msg.enrollment_id) {
      const { data: enr } = await supabase
        .from("campaign_enrollments")
        .select(
          "id, status, event_name, customer_id, campaign_id, paused_until, email, phone, campaign_event:campaign_events(metadata), campaign:sms_campaigns(active, required_consent)",
        )
        .eq("id", msg.enrollment_id)
        .maybeSingle();
      const camp = (enr?.campaign as
        | { active?: boolean; required_consent?: string }
        | null) ?? null;
      // Auto-resume: a paused enrollment whose paused_until has elapsed is
      // reactivated in place (unless a permanent stop condition fired since —
      // those flip status to "stopped", never "paused", and are handled by
      // the fall-through below). If paused_until is still in the future, we
      // simply defer this message and process it later.
      if (enr && enr.status === "paused") {
        const until = enr.paused_until
          ? new Date(enr.paused_until as string).getTime()
          : 0;
        const now = Date.now();
        if (until && until > now) {
          const iso = new Date(until).toISOString();
          await updateClaimedMessage(
            supabase,
            msg,
            transition("retry_pending", {
              send_at: iso,
              next_retry_at: iso,
              error: "Deferred: enrollment paused (active AI conversation)",
            }),
          );
          continue;
        }
        // Ripe — auto-resume before delivering.
        await supabase.from("campaign_enrollments").update({
          status: "active",
          paused_until: null,
        }).eq("id", enr.id).eq("status", "paused");
      } else if (!enr || enr.status !== "active") {
        await updateClaimedMessage(
          supabase,
          msg,
          transition("cancelled", {
            error: `Enrollment not active (${enr?.status ?? "missing"})`,
          }),
        );
        continue;
      }

      // Authoritative quote terminal state is rechecked immediately before
      // delivery. This protects the crash window before quote_declined is
      // reconciled and also cancels stale decline messages if a concurrent
      // durable booking ultimately wins.
      const campaignEvent = enr.campaign_event as {
        metadata?: Record<string, unknown>;
      } | null;
      const eventQuoteId = typeof campaignEvent?.metadata?.quote_id === "string"
        ? campaignEvent.metadata.quote_id
        : null;
      const sourceQuoteId = typeof msg.quote_id === "string" && msg.quote_id
        ? msg.quote_id
        : eventQuoteId;
      if (sourceQuoteId) {
        const { data: currentQuote, error: currentQuoteError } = await supabase
          .from("quotes")
          .select("status, converted_booking_id")
          .eq("id", sourceQuoteId)
          .maybeSingle();
        if (currentQuoteError || !currentQuote) {
          await updateClaimedMessage(
            supabase,
            msg,
            failureUpdate(
              msg.attempts,
              msg.max_attempts,
              "Authoritative quote state unavailable",
            ),
          );
          failed++;
          continue;
        }
        const eventName = String(enr.event_name ?? "");
        if (!quoteLifecycleAllowsCampaignDelivery(currentQuote, eventName)) {
          await updateClaimedMessage(
            supabase,
            msg,
            transition("cancelled", {
              error: `Quote lifecycle advanced to ${currentQuote.status}`,
            }),
          );
          continue;
        }

        // A conversion-reconciliation failure can leave quote.status active
        // after the exact booking row is already durable. Recheck that lineage
        // immediately before provider dispatch and fail closed if unreadable.
        try {
          const hasBooking = await hasLifecycleBlockingBooking(supabase, {
            customerId: (enr.customer_id as string | null) ??
              (msg.customer_id as string | null) ?? null,
            quoteId: sourceQuoteId,
            anchorIso: null,
          });
          if (hasBooking && eventName !== "booking_completed") {
            await updateClaimedMessage(
              supabase,
              msg,
              transition("cancelled", {
                error: "Exact quote booking lineage is already durable",
              }),
            );
            continue;
          }
        } catch (_e) {
          await updateClaimedMessage(
            supabase,
            msg,
            failureUpdate(
              msg.attempts,
              msg.max_attempts,
              "Authoritative booking lineage unavailable",
            ),
          );
          failed++;
          continue;
        }
      }

      if (!camp || camp.active === false) {
        await updateClaimedMessage(
          supabase,
          msg,
          transition("cancelled", {
            error: "Campaign deactivated",
          }),
        );
        continue;
      }
      const required = camp.required_consent ?? "transactional";
      if (required !== "transactional") {
        const { data: allowed } = await supabase.rpc("consent_allows", {
          p_channel: msg.channel === "email" ? "email" : "sms",
          p_required: required,
          p_email: (msg.to_email as string) ?? enr.email ?? null,
          p_phone: (msg.to_number as string) ?? enr.phone ?? null,
        });
        if (!allowed) {
          await updateClaimedMessage(
            supabase,
            msg,
            transition("cancelled", {
              error: `Consent no longer satisfies ${required}`,
            }),
          );
          continue;
        }
      }
    }

    // ---- Email channel ----
    if (msg.channel === "email") {
      if (!msg.to_email) {
        await updateClaimedMessage(
          supabase,
          msg,
          failureUpdate(
            msg.attempts,
            msg.max_attempts,
            "No recipient email",
            true,
          ),
        );
        failed++;
        continue;
      }
      // Skip leads whose email channel was paused after the message was queued.
      const pauseEmail = await getCustomerPause(supabase, {
        id: msg.customer_id,
        email: msg.to_email,
      });
      if (!pauseEmail.readable) {
        await updateClaimedMessage(
          supabase,
          msg,
          failureUpdate(
            msg.attempts,
            msg.max_attempts,
            "Customer email pause state unavailable",
          ),
        );
        failed++;
        continue;
      }
      if (pauseEmail.email_paused) {
        await updateClaimedMessage(
          supabase,
          msg,
          transition("cancelled", {
            error: "Email paused for this lead",
          }),
        );
        continue;
      }
      const safeHtml = String(msg.body ?? "")
        .split("\n")
        .map((line) =>
          line
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
        )
        .join("<br />");
      if (!await beginProviderSubmission(supabase, msg)) {
        failed++;
        continue;
      }
      const er = await sendEmail({
        to: msg.to_email as string,
        subject: (msg.subject as string) || "BluLadder",
        html:
          `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">${safeHtml}</div>`,
        idempotencyKey: queuedProviderIdempotencyKey(msg),
      });
      if (er.ok) {
        const acceptedAt = new Date().toISOString();
        const acceptedOutcome = er.providerMessageId ? "accepted" : "uncertain";
        const recorded = await updateClaimedMessage(
          supabase,
          msg,
          transition(acceptedOutcome, {
            sent_at: acceptedAt,
            callrail_message_id: er.providerMessageId ?? null,
            provider: "resend",
            provider_message_id: er.providerMessageId ?? null,
            provider_status: "accepted",
            provider_response_kind: "email",
            provider_accepted_at: acceptedAt,
            attempts: (msg.attempts ?? 0) + 1,
            send_error_code: acceptedOutcome === "uncertain"
              ? "email_acceptance_missing_provider_id"
              : null,
          }),
          "sending",
        );
        if (recorded && acceptedOutcome === "accepted") sent++;
        else failed++;
      } else {
        const attempts = (msg.attempts ?? 0) + 1;
        const maxAttempts = msg.max_attempts && msg.max_attempts > 0
          ? msg.max_attempts
          : 3;
        const outcome = emailFailureOutcome({
          category: er.failure?.category,
          httpStatus: er.failure?.httpStatus,
          retryable: er.failure?.retryable ?? false,
          attempts,
          maxAttempts,
        });
        const retryAt = outcome === "retry_pending"
          ? nextRetryIso(attempts)
          : null;
        await updateClaimedMessage(
          supabase,
          msg,
          transition(outcome, {
            error: er.failure?.message ?? "send failed",
            attempts,
            send_at: retryAt ?? msg.send_at,
            next_retry_at: retryAt,
            send_error_code: outcome === "uncertain"
              ? "email_provider_result_uncertain"
              : er.failure?.category ?? "email_send_failed",
            send_error_at: new Date().toISOString(),
          }),
          "sending",
        );
        failed++;
      }
      continue;
    }

    // Skip recipients who have opted out since the message was queued.
    const optOut = await checkPhoneOptOut(
      supabase,
      msg.to_number as string,
    );
    if (!optOut.readable) {
      await updateClaimedMessage(
        supabase,
        msg,
        failureUpdate(
          msg.attempts,
          msg.max_attempts,
          "SMS opt-out state unavailable",
        ),
      );
      failed++;
      continue;
    }
    if (optOut.optedOut) {
      await updateClaimedMessage(
        supabase,
        msg,
        transition("cancelled", {
          error: "Recipient has opted out of texts",
        }),
      );
      continue;
    }
    // Skip leads whose text channel was paused after the message was queued.
    const pauseSms = await getCustomerPause(supabase, {
      id: msg.customer_id,
      phone: msg.to_number,
    });
    if (!pauseSms.readable) {
      await updateClaimedMessage(
        supabase,
        msg,
        failureUpdate(
          msg.attempts,
          msg.max_attempts,
          "Customer SMS pause state unavailable",
        ),
      );
      failed++;
      continue;
    }
    if (pauseSms.sms_paused) {
      await updateClaimedMessage(
        supabase,
        msg,
        transition("cancelled", {
          error: "Texting paused for this lead",
        }),
      );
      continue;
    }
    const connector = await authorizeQueuedSmsConnector(supabase, msg);
    if (connector.status !== "authorized") {
      await updateClaimedMessage(
        supabase,
        msg,
        failureUpdate(
          msg.attempts,
          msg.max_attempts,
          `SMS connector blocked (${connector.reason})`,
          true,
        ),
      );
      failed++;
      continue;
    }
    if (!await beginProviderSubmission(supabase, msg)) {
      failed++;
      continue;
    }
    const result = await dispatchSelectedSmsConnector(connector.connector, {
      toNumber: msg.to_number as string,
      body: msg.body as string,
    });
    if (result.outboxState === "provider_accepted") {
      const acceptedAt = new Date().toISOString();
      const acceptedOutcome = result.providerMessageId ||
          result.providerConversationId
        ? "accepted"
        : "uncertain";
      const recorded = await updateClaimedMessage(
        supabase,
        msg,
        transition(acceptedOutcome, {
          sent_at: acceptedAt,
          callrail_message_id: result.provider === "callrail"
            ? result.providerMessageId
            : null,
          provider: result.provider,
          provider_conversation_id: result.providerConversationId,
          provider_message_id: result.providerMessageId,
          provider_status: result.providerStatus ?? "accepted",
          provider_response_kind: result.providerResponseKind ?? null,
          provider_accepted_at: acceptedAt,
          attempts: (msg.attempts ?? 0) + 1,
          send_error_code: acceptedOutcome === "uncertain"
            ? "sms_acceptance_missing_provider_identity"
            : null,
        }),
        "sending",
      );
      if (recorded && acceptedOutcome === "accepted") sent++;
      else failed++;
    } else if (result.outboxState === "delivery_unknown") {
      await updateClaimedMessage(
        supabase,
        msg,
        transition("uncertain", {
          error: result.error ?? "provider result uncertain",
          attempts: (msg.attempts ?? 0) + 1,
          provider: result.provider,
          provider_message_id: result.providerMessageId,
          provider_conversation_id: result.providerConversationId,
          provider_status: result.providerStatus,
          provider_response_kind: result.providerResponseKind,
          send_error_code: "sms_provider_result_uncertain",
          send_error_at: new Date().toISOString(),
        }),
        "sending",
      );
      failed++;
    } else {
      const attempts = (msg.attempts ?? 0) + 1;
      const maxAttempts = msg.max_attempts && msg.max_attempts > 0
        ? msg.max_attempts
        : 3;
      const outcome = result.permanentFailure
        ? "terminal_failure"
        : smsFailureOutcome({
          providerResponseKind: result.providerResponseKind,
          providerStatus: result.providerHttpStatus,
          attempts,
          maxAttempts,
        });
      const retryAt = outcome === "retry_pending"
        ? nextRetryIso(attempts)
        : null;
      await updateClaimedMessage(
        supabase,
        msg,
        transition(outcome, {
          error: result.error ?? "send failed",
          attempts,
          send_at: retryAt ?? msg.send_at,
          next_retry_at: retryAt,
          provider: result.provider,
          provider_message_id: result.providerMessageId,
          provider_conversation_id: result.providerConversationId,
          provider_status: result.providerStatus,
          provider_response_kind: result.providerResponseKind ?? null,
          send_error_code: outcome === "uncertain"
            ? "sms_provider_result_uncertain"
            : "sms_send_failed",
          send_error_at: new Date().toISOString(),
        }),
        "sending",
      );
      failed++;
    }
  }

  // ===== CAMPAIGN LIFECYCLE (runs AFTER normal queue work so sends are never
  // delayed). Both steps are bounded and continue across subsequent ticks.
  // Logically separated in _shared/campaignSweep.ts; NO new cron/queue. =====
  let abandonment: unknown = null;
  let recovery: unknown = null;
  let declinedQuoteRepair: unknown = null;
  let persistedAbandonment: unknown = null;
  let followUpCompletion: unknown = null;
  let callrailRetries: unknown = null;
  let postServiceEducation: unknown = null;
  let maintenanceOpportunity: unknown = null;
  try {
    declinedQuoteRepair = await runDeclinedQuoteEventRepairSweep(supabase);
  } catch (e) {
    console.error(
      "runDeclinedQuoteEventRepairSweep error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    recovery = await recoverPendingCampaignEvents(supabase);
  } catch (e) {
    console.error(
      "recoverPendingCampaignEvents error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    abandonment = await runAbandonmentSweep(supabase);
  } catch (e) {
    console.error(
      "runAbandonmentSweep error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    persistedAbandonment = await runPersistedQuoteAbandonmentSweep(supabase);
  } catch (e) {
    console.error(
      "runPersistedQuoteAbandonmentSweep error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    followUpCompletion = await runFollowUpCompletionSweep(supabase);
  } catch (e) {
    console.error(
      "runFollowUpCompletionSweep error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    // Automatic CallRail durable-receipt retry sweep. Reuses this cron; a
    // bounded batch of due retry_pending rows is claimed atomically via
    // SELECT ... FOR UPDATE SKIP LOCKED so two workers cannot pick up the
    // same event.
    callrailRetries = await processDueCallRailRetries(supabase, 25);
  } catch (e) {
    console.error(
      "processDueCallRailRetries error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    // Slice C: post-service education + maintenance rebooking sweeps.
    // Both emit campaign events only; no live delivery unless a matching
    // campaign is active. Bounded and safe to run alongside other sweeps.
    postServiceEducation = await runPostServiceEducationSweep(supabase);
  } catch (e) {
    console.error(
      "runPostServiceEducationSweep error:",
      e instanceof Error ? e.message : e,
    );
  }
  try {
    maintenanceOpportunity = await runMaintenanceOpportunitySweep(supabase);
  } catch (e) {
    console.error(
      "runMaintenanceOpportunitySweep error:",
      e instanceof Error ? e.message : e,
    );
  }

  return new Response(
    JSON.stringify({
      processed: (due || []).length,
      sent,
      failed,
      abandonment,
      persistedAbandonment,
      declinedQuoteRepair,
      recovery,
      followUpCompletion,
      callrailRetries,
      postServiceEducation,
      maintenanceOpportunity,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
