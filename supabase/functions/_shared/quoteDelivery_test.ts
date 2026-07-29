import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyEmailResult, deliverQuoteEmail } from "./quoteDelivery.ts";
import type { SendEmailResult } from "./emailConfig.ts";

const base = {
  from: "BluLadder <test@example.com>",
  replyTo: "help@example.com",
  to: "customer@example.com",
  httpStatus: null,
  reachedProvider: false,
} as const;

Deno.test("accepted provider response requires a provider id", () => {
  assertEquals(
    classifyEmailResult({
      ...base,
      ok: true,
      providerMessageId: "email-1",
      httpStatus: 200,
      reachedProvider: true,
      failure: null,
    }),
    { state: "provider_accepted", reason: null },
  );
  assertEquals(
    classifyEmailResult({
      ...base,
      ok: true,
      providerMessageId: null,
      httpStatus: 200,
      reachedProvider: true,
      failure: null,
    }),
    { state: "uncertain", reason: "provider_accepted_without_message_id" },
  );
});

Deno.test("network exception is uncertain rather than retryable", () => {
  const result: SendEmailResult = {
    ...base,
    ok: false,
    providerMessageId: null,
    failure: {
      category: "network_error",
      message: "network",
      retryable: true,
      reachedProvider: false,
      httpStatus: null,
    },
  };
  assertEquals(classifyEmailResult(result), {
    state: "uncertain",
    reason: "network",
  });
});

Deno.test("known provider rejection separates retryable and terminal", () => {
  for (
    const [retryable, state] of [
      [true, "failed_retryable"],
      [false, "failed_terminal"],
    ] as const
  ) {
    assertEquals(
      classifyEmailResult({
        ...base,
        ok: false,
        providerMessageId: null,
        reachedProvider: true,
        httpStatus: retryable ? 429 : 422,
        failure: {
          category: retryable ? "rate_limited" : "invalid_recipient",
          message: "rejected",
          retryable,
          reachedProvider: true,
          httpStatus: retryable ? 429 : 422,
        },
      }),
      { state, reason: "rejected" },
    );
  }
});

Deno.test("concurrent follower never dispatches to provider", async () => {
  let providerCalls = 0;
  const supabase = {
    rpc(name: string) {
      if (name === "claim_quote_email_delivery") {
        return Promise.resolve({
          data: {
            ok: true,
            id: "attempt-1",
            may_dispatch: false,
            in_progress: true,
            delivery_state: "provider_submission_pending",
          },
          error: null,
        });
      }
      throw new Error("finalize must not run");
    },
  };
  const result = await deliverQuoteEmail(supabase, {
    quoteId: "quote-1",
    recipientEmail: "customer@example.com",
    sourceSessionId: "session-1",
    subject: "subject",
    html: "html",
    providerSend: async () => {
      providerCalls++;
      throw new Error("must not dispatch");
    },
  });
  assertEquals(providerCalls, 0);
  assertEquals(result.inProgress, true);
  assertEquals(result.accepted, false);
});

Deno.test("provider acceptance with failed finalization becomes uncertain", async () => {
  const calls: string[] = [];
  const supabase = {
    rpc(name: string) {
      calls.push(name);
      if (name === "claim_quote_email_delivery") {
        return Promise.resolve({
          data: {
            ok: true,
            id: "attempt-1",
            may_dispatch: true,
            semantic_key: "quote_email:key",
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: "database unavailable" },
      });
    },
  };
  const result = await deliverQuoteEmail(supabase, {
    quoteId: "quote-1",
    recipientEmail: "customer@example.com",
    sourceSessionId: "session-1",
    subject: "subject",
    html: "html",
    providerSend: async () => ({
      ...base,
      ok: true,
      providerMessageId: "provider-1",
      reachedProvider: true,
      httpStatus: 200,
      failure: null,
    }),
  });
  assertEquals(calls, [
    "claim_quote_email_delivery",
    "finalize_quote_email_delivery",
  ]);
  assertEquals(result.accepted, false);
  assertEquals(result.state, "uncertain");
  assertEquals(result.providerMessageId, "provider-1");
});

Deno.test("provider throw finalizes uncertain instead of escaping or retrying", async () => {
  let finalizedState: string | null = null;
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_quote_email_delivery") {
        return Promise.resolve({
          data: {
            ok: true,
            id: "attempt-throw",
            may_dispatch: true,
            semantic_key: "quote_email:key",
          },
          error: null,
        });
      }
      finalizedState = String(args.p_delivery_state);
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
  const result = await deliverQuoteEmail(supabase, {
    quoteId: "quote-1",
    recipientEmail: "customer@example.com",
    sourceSessionId: null,
    subject: "subject",
    html: "html",
    providerSend: () => {
      throw new Error("crash");
    },
  });
  assertEquals(finalizedState, "uncertain");
  assertEquals(result.accepted, false);
  assertEquals(result.state, "uncertain");
});
