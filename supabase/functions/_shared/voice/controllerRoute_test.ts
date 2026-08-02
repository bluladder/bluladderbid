// deno-lint-ignore-file no-explicit-any require-await
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { QuoteSession } from "../quoteSession.ts";
import { executeControllerRoute } from "./controllerRoute.ts";

const ORG = "00000000-0000-4000-8000-000000000072";
const session: QuoteSession = {
  id: "00000000-0000-4000-8000-000000000073",
  organizationId: ORG,
  channel: "voice",
  conversationIds: ["00000000-0000-4000-8000-000000000074"],
  fields: {},
  fieldStatus: {},
  requiredRemaining: ["services"],
  quoteStatus: "none",
  bookingReady: false,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function input() {
  return {
    supabase: {},
    conversationId: session.conversationIds[0],
    organizationId: ORG,
    organizationAuthority: {
      status: "resolved" as const,
      organizationId: ORG,
      source: "resource" as const,
      evidence: ["provider:vapi_assistant"],
      sensitiveActionsAllowed: true,
    },
    callId: "vapi_call:synthetic-72",
    messages: [{ role: "user" as const, content: "I need window cleaning" }],
  };
}

Deno.test("controller route journals the exact persisted/projection-backed turn", async () => {
  const order: string[] = [];
  let journalArgs: any = null;
  const result = await executeControllerRoute(input(), {
    runController: async () => {
      order.push("controller");
      return {
        sessionId: session.id,
        sessionPatch: { fields: { services: ["windowCleaning"] } },
        pre: {
          kind: "fsm" as const,
          action: {
            kind: "ask" as const,
            field: "stories" as const,
            prompt: "Stories?",
          },
          spoken: "How many stories is the home?",
        },
      };
    },
    persist: async () => {
      order.push("persist");
      return { status: "persisted" as const };
    },
    project: async () => {
      order.push("project");
      return { status: "projected" as const, attempts: 1 };
    },
    readSession: async () => {
      order.push("read");
      return session;
    },
    prepareIdentity: async () => {
      order.push("prepare");
      return {
        status: "not_ready" as const,
        blocker: "name_unconfirmed" as const,
      };
    },
    journal: async (_supabase, args) => {
      order.push("journal");
      journalArgs = args;
      return { written: 2, duplicates: 0, failed: 0 };
    },
  });
  assertEquals(order, [
    "controller",
    "persist",
    "project",
    "read",
    "prepare",
    "journal",
  ]);
  assertEquals(result.spoken, "How many stories is the home?");
  assertEquals(journalArgs.organizationId, ORG);
  assertEquals(journalArgs.turns, [
    { role: "user", content: "I need window cleaning" },
    { role: "assistant", content: "How many stories is the home?" },
  ]);
  assertEquals(typeof journalArgs.turnIdentity, "string");
  assertEquals(typeof journalArgs.retentionExpiresAt, "string");
});

Deno.test("controller route speaks recoverable truth after projection failure", async () => {
  const result = await executeControllerRoute(input(), {
    runController: async () => ({
      sessionId: session.id,
      sessionPatch: { fields: { address: "synthetic" } },
      pre: {
        kind: "fsm" as const,
        action: { kind: "offer_scheduling" as const },
        spoken: "Would you like appointment times?",
      },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => ({
      status: "error" as const,
      reason: "conversation_projection_failed",
      attempts: 1,
    }),
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.event, "workflow_controller_projection_blocked");
  assertStringIncludes(result.spoken, "saved that answer in the quote form");
  assertStringIncludes(result.spoken, "not checked availability");
});

Deno.test("controller route journaling failure never crashes or changes the spoken turn", async () => {
  const result = await executeControllerRoute(input(), {
    runController: async () => ({
      sessionId: session.id,
      sessionPatch: {},
      pre: { kind: "ask_intent" as const, spoken: "How can I help?" },
    }),
    persist: async () => ({ status: "noop" as const }),
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => session,
    prepareIdentity: async () => ({
      status: "not_ready" as const,
      blocker: "name_unconfirmed" as const,
    }),
    journal: async () => ({
      written: 0,
      duplicates: 0,
      failed: 2,
      reason: "journal_write_failed" as const,
    }),
  });
  assertEquals(result.spoken, "How can I help?");
  assertEquals(result.journal.failed, 2);
});

Deno.test("controller parses normalized text but journals the original provider utterance", async () => {
  let controllerUtterance = "";
  let journalArgs: any = null;
  const result = await executeControllerRoute({
    ...input(),
    messages: [{
      role: "user",
      content: "two five hundred (2500 square feet)",
    }],
    journalMessages: [{ role: "user", content: "two five hundred" }],
  }, {
    runController: async (args) => {
      controllerUtterance = args.utterance;
      return {
        sessionId: session.id,
        sessionPatch: {},
        pre: { kind: "ask_intent" as const, spoken: "Thank you." },
      };
    },
    persist: async () => ({ status: "noop" as const }),
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => session,
    prepareIdentity: async () => ({
      status: "not_ready" as const,
      blocker: "name_unconfirmed" as const,
    }),
    journal: async (_supabase, args) => {
      journalArgs = args;
      return { written: 2, duplicates: 0, failed: 0 };
    },
  });
  assertEquals(result.spoken, "Thank you.");
  assertEquals(controllerUtterance, "two five hundred (2500 square feet)");
  assertEquals(journalArgs.turns[0].content, "two five hundred");
});

Deno.test("quote delivery reports a post-send projection failure without retrying", async () => {
  const firmSession: QuoteSession = {
    ...session,
    fields: {
      services: ["windowCleaning"],
      name: "Synthetic Caller",
      email: "synthetic.issue72@example.com",
      phone: "+14695550172",
      callerIdConfirmationStatus: "contact_confirmed",
      address: "5612 Binbranch Lane, McKinney, TX 75071",
      serviceAreaStatus: "eligible",
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 216.5,
        estimatedTotal: 216.5,
      },
    },
    fieldStatus: {
      name: "verified",
      email: "verified",
      phone: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "firm",
  };
  let projections = 0;
  let deliveries = 0;
  const routeInput = {
    ...input(),
    messages: [{
      role: "user" as const,
      content: "Please text me the actual quote",
    }],
    callFunction: () =>
      Promise.resolve({ status: 200, json: { accepted: true } }),
  };
  const result = await executeControllerRoute(routeInput, {
    runController: async () => ({
      sessionId: firmSession.id,
      sessionPatch: {},
      pre: { kind: "ask_intent" as const, spoken: "Certainly." },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => {
      projections += 1;
      return projections === 1
        ? { status: "projected" as const, attempts: 1 }
        : {
          status: "error" as const,
          reason: "conversation_projection_failed",
          attempts: 1,
        };
    },
    readSession: async () => firmSession,
    prepareIdentity: async () => ({
      status: "not_ready" as const,
      blocker: "address_unconfirmed" as const,
    }),
    deliverQuote: async () => {
      deliveries += 1;
      return { ok: true, status: "provider_accepted" as const };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(deliveries, 1);
  assertEquals(result.event, "voice_quote_by_text_projection_blocked");
  assertStringIncludes(result.spoken, "should verify it before any retry");
});

Deno.test("provider acceptance without a reloadable delivery record is not called sent", async () => {
  const firmSession: QuoteSession = {
    ...session,
    fields: {
      services: ["windowCleaning"],
      name: "Synthetic Caller",
      email: "synthetic.issue72@example.com",
      phone: "+14695550172",
      callerIdConfirmationStatus: "contact_confirmed",
      address: "5612 Binbranch Lane, McKinney, TX 75071",
      serviceAreaStatus: "eligible",
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 216.5,
        estimatedTotal: 216.5,
      },
    },
    fieldStatus: {
      name: "verified",
      email: "verified",
      phone: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "firm",
  };
  let reads = 0;
  const result = await executeControllerRoute({
    ...input(),
    messages: [{ role: "user" as const, content: "Text me the quote" }],
    callFunction: () => Promise.resolve({ status: 200, json: {} }),
  }, {
    runController: async () => ({
      sessionId: firmSession.id,
      sessionPatch: {},
      pre: { kind: "ask_intent" as const, spoken: "Certainly." },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => {
      reads += 1;
      return reads === 4 ? null : firmSession;
    },
    prepareIdentity: async () => ({
      status: "not_ready" as const,
      blocker: "address_unconfirmed" as const,
    }),
    deliverQuote: async () => ({
      ok: true,
      status: "provider_accepted" as const,
    }),
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.event, "voice_quote_by_text_status_persistence_blocked");
  assertStringIncludes(result.spoken, "provider accepted");
  assertStringIncludes(result.spoken, "don't retry");
});
