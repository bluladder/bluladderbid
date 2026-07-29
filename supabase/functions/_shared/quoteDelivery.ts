// Durable quote-delivery helpers. Provider dispatch is only allowed after an
// authoritative database claim; a missing/uncertain finalization never causes
// an automatic replay.
// deno-lint-ignore-file no-explicit-any

import { sendEmail, type SendEmailResult } from "./emailConfig.ts";

type SB = any;

export type QuoteDeliveryState =
  | "provider_submission_pending"
  | "provider_accepted"
  | "failed_retryable"
  | "failed_terminal"
  | "uncertain";

export interface QuoteEmailResult {
  accepted: boolean;
  attemptId: string | null;
  state: QuoteDeliveryState | null;
  providerMessageId: string | null;
  replay: boolean;
  inProgress: boolean;
  failureReason: string | null;
}

export function classifyEmailResult(
  result: SendEmailResult,
): {
  state: Exclude<QuoteDeliveryState, "provider_submission_pending">;
  reason: string | null;
} {
  if (result.ok && result.providerMessageId) {
    return { state: "provider_accepted", reason: null };
  }
  if (result.ok && !result.providerMessageId) {
    return {
      state: "uncertain",
      reason: "provider_accepted_without_message_id",
    };
  }
  const failure = result.failure;
  if (!failure) {
    return { state: "uncertain", reason: "provider_result_missing" };
  }
  // A fetch exception can occur after the request left the process. It is not
  // proof that the provider did not accept the message.
  if (failure.category === "network_error") {
    return { state: "uncertain", reason: failure.message };
  }
  return {
    state: failure.retryable ? "failed_retryable" : "failed_terminal",
    reason: failure.message,
  };
}

export async function deliverQuoteEmail(
  supabase: SB,
  input: {
    quoteId: string;
    recipientEmail: string;
    sourceSessionId: string | null;
    subject: string;
    html: string;
    providerSend?: typeof sendEmail;
  },
): Promise<QuoteEmailResult> {
  const claimToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await supabase.rpc(
    "claim_quote_email_delivery",
    {
      p_quote_id: input.quoteId,
      p_recipient_email: input.recipientEmail,
      p_claim_token: claimToken,
      p_template: "save-quote",
      p_source_session_id: input.sourceSessionId,
    },
  );
  if (claimError || !claim?.ok || !claim?.id) {
    return {
      accepted: false,
      attemptId: null,
      state: null,
      providerMessageId: null,
      replay: false,
      inProgress: false,
      failureReason: claimError?.message ?? claim?.reason ??
        "delivery_claim_failed",
    };
  }
  if (!claim.may_dispatch) {
    return {
      accepted: claim.delivery_state === "provider_accepted" ||
        claim.status === "accepted" || claim.status === "sent" ||
        claim.status === "delivered",
      attemptId: claim.id,
      state: claim.delivery_state ?? null,
      providerMessageId: claim.provider_message_id ?? null,
      replay: claim.replay === true,
      inProgress: claim.in_progress === true,
      failureReason: claim.failure_reason ?? null,
    };
  }

  let provider: SendEmailResult;
  try {
    provider = await (input.providerSend ?? sendEmail)({
      to: input.recipientEmail,
      subject: input.subject,
      html: input.html,
      idempotencyKey: claim.semantic_key,
    });
  } catch {
    provider = {
      ok: false,
      providerMessageId: null,
      from: "",
      replyTo: "",
      to: input.recipientEmail,
      httpStatus: null,
      reachedProvider: false,
      failure: {
        category: "network_error",
        message: "The provider result is uncertain.",
        retryable: false,
        reachedProvider: false,
        httpStatus: null,
      },
    };
  }
  const classified = classifyEmailResult(provider);
  const { data: finalized, error: finalizeError } = await supabase.rpc(
    "finalize_quote_email_delivery",
    {
      p_attempt_id: claim.id,
      p_claim_token: claimToken,
      p_delivery_state: classified.state,
      p_provider_message_id: provider.providerMessageId,
      p_failure_category: provider.failure?.category ?? null,
      p_failure_reason: classified.reason,
      p_http_status: provider.httpStatus,
      p_metadata: { from: provider.from, reply_to: provider.replyTo },
    },
  );
  if (finalizeError || !finalized?.ok) {
    return {
      accepted: false,
      attemptId: claim.id,
      state: "uncertain",
      providerMessageId: provider.providerMessageId,
      replay: false,
      inProgress: false,
      failureReason: "delivery_finalization_uncertain",
    };
  }
  return {
    accepted: classified.state === "provider_accepted",
    attemptId: claim.id,
    state: classified.state,
    providerMessageId: provider.providerMessageId,
    replay: false,
    inProgress: false,
    failureReason: classified.reason,
  };
}
