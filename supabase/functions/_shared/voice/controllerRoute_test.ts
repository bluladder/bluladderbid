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
    turnId: "turn-synthetic-72",
    turnPosition: 2,
    contentHash: "content-hash-synthetic-72",
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
            field: "squareFootage" as const,
            prompt: "About how many square feet is the home?",
          },
          spoken: "About how many square feet is the home?",
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
  assertEquals(order, ["controller", "persist", "project", "read", "journal"]);
  assertEquals(result.spoken, "About how many square feet is the home?");
  assertEquals(journalArgs.organizationId, ORG);
  assertEquals(journalArgs.turnId, "turn-synthetic-72");
  assertEquals(journalArgs.turnPosition, 2);
  assertEquals(journalArgs.contentHash, "content-hash-synthetic-72");
  assertEquals(journalArgs.turns, [
    { role: "user", content: "I need window cleaning" },
    { role: "assistant", content: "About how many square feet is the home?" },
  ]);
  assertEquals(typeof journalArgs.turnIdentity, "string");
  assertEquals(typeof journalArgs.retentionExpiresAt, "string");
});

Deno.test("phase9 projection reuses its exact scoped session without a duplicate read", async () => {
  let reads = 0;
  const result = await executeControllerRoute(input(), {
    runController: async () => ({
      sessionId: session.id,
      sessionPatch: { fields: { services: ["windowCleaning"] } },
      pre: { kind: "ask_intent" as const, spoken: "How can I help?" },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => ({
      status: "projected" as const,
      attempts: 1,
      session,
    }),
    readSession: async () => {
      reads += 1;
      return session;
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(reads, 0);
  assertEquals(result.stateCommitted, true);
  assertEquals(result.sessionId, session.id);
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
      voiceJourney: { requestedNextStep: "text_quote" },
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
  let durableSession = firmSession;
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
    persist: async (_supabase, _sessionId, patch) => {
      if (patch.fields) {
        durableSession = {
          ...durableSession,
          fields: patch.fields as QuoteSession["fields"],
        };
      }
      return { status: "persisted" as const };
    },
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
    readSession: async () => durableSession,
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
  assertStringIncludes(result.spoken, "verify it before any manual resend");
});

Deno.test("provider acceptance relies on the delivery operation's durable evidence", async () => {
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
      voiceJourney: { requestedNextStep: "text_quote" },
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
  let durableSession = firmSession;
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
    persist: async (_supabase, _sessionId, patch) => {
      if (patch.fields) {
        durableSession = {
          ...durableSession,
          fields: patch.fields as QuoteSession["fields"],
        };
      }
      return { status: "persisted" as const };
    },
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => durableSession,
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
  assertEquals(result.event, "voice_quote_by_text_provider_accepted");
  assertStringIncludes(result.spoken, "accepted for delivery");
});

Deno.test("phase6 pending generated quote resumes after a contact confirmation answer", async () => {
  const readySession: QuoteSession = {
    ...session,
    fields: {
      services: ["windowCleaning"],
      name: "Synthetic Caller",
      email: "synthetic.phase6@example.invalid",
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
      voiceJourney: { requestedNextStep: "text_quote" },
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
  let deliveries = 0;
  const result = await executeControllerRoute({
    ...input(),
    messages: [{ role: "user" as const, content: "Yes, that is correct" }],
    callFunction: () => Promise.resolve({ status: 200, json: {} }),
  }, {
    runController: async () => ({
      sessionId: readySession.id,
      sessionPatch: {},
      pre: { kind: "ask_intent" as const, spoken: "Thank you." },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => readySession,
    deliverQuote: async () => {
      deliveries += 1;
      return {
        ok: true,
        status: "provider_accepted" as const,
        attemptId: "attempt-phase6",
      };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(deliveries, 1);
  assertEquals(result.event, "voice_quote_by_text_provider_accepted");
  assertStringIncludes(result.spoken, "accepted for delivery");
});

Deno.test("duplicate intake write continues when the proposed answer is already present", async () => {
  const saved: QuoteSession = {
    ...session,
    fields: { services: ["windowCleaning"] },
    lastStep: "asked:stories",
  };
  const result = await executeControllerRoute(input(), {
    runController: async () => ({
      sessionId: session.id,
      sessionPatch: { fields: { services: ["windowCleaning"] } },
      pre: {
        kind: "fsm" as const,
        action: {
          kind: "ask" as const,
          field: "stories" as const,
          prompt: "How many stories is the home?",
        },
        spoken: "How many stories is the home?",
      },
    }),
    persist: async () => ({ status: "conflict" as const, reason: "changed" }),
    readSession: async () => saved,
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    prepareIdentity: async () => ({
      status: "not_ready" as const,
      blocker: "name_unconfirmed" as const,
    }),
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.stateCommitted, true);
  assertEquals(result.event, "workflow_controller");
  assertEquals(result.spoken, "How many stories is the home?");
});

Deno.test("conflicting intake write asks the exact current question without generic failure text", async () => {
  const latest: QuoteSession = {
    ...session,
    fields: {
      services: ["windowCleaning"],
      ladderWork: true,
    },
    lastStep: "asked:ladderAffectedWindowEquivalents",
  };
  const result = await executeControllerRoute(input(), {
    runController: async () => ({
      sessionId: session.id,
      sessionPatch: { fields: { services: ["houseWash"] } },
      pre: {
        kind: "fsm" as const,
        action: {
          kind: "ask" as const,
          field: "squareFootage" as const,
          prompt: "How many square feet is the home?",
        },
        spoken: "How many square feet is the home?",
      },
    }),
    persist: async () => ({ status: "conflict" as const, reason: "changed" }),
    readSession: async () => latest,
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.stateCommitted, false);
  assertEquals(result.event, "workflow_controller_persistence_blocked");
  assertEquals(
    result.spoken,
    "How many windows need unusual ladder access?",
  );
});

Deno.test("phase3 route ask_intent does not prepare identity before pricing", async () => {
  const order: string[] = [];
  let journalArgs: any = null;
  let controllerCalls = 0;
  let projectCalls = 0;
  let readCalls = 0;
  let prepareCalls = 0;
  const identityReadyUnpriced: QuoteSession = {
    ...session,
    fields: {
      name: "Synthetic Caller",
      phone: "+14695550172",
      email: "synthetic.route@example.invalid",
      address: "123 Synthetic Lane, Frisco, TX 75034",
      callerIdConfirmationStatus: "contact_confirmed",
      serviceAreaStatus: "eligible",
      voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    },
    fieldStatus: {
      name: "verified",
      phone: "verified",
      email: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "none",
  };
  const result = await executeControllerRoute(input(), {
    runController: async () => {
      controllerCalls += 1;
      order.push("controller");
      return {
        sessionId: identityReadyUnpriced.id,
        sessionPatch: {},
        pre: { kind: "ask_intent" as const, spoken: "How can I help?" },
      };
    },
    persist: async () => {
      order.push("persist");
      return { status: "noop" as const };
    },
    project: async () => {
      projectCalls += 1;
      order.push("project");
      return { status: "projected" as const, attempts: 1 };
    },
    readSession: async () => {
      readCalls += 1;
      order.push("read");
      return identityReadyUnpriced;
    },
    prepareIdentity: async () => {
      prepareCalls += 1;
      order.push("prepare");
      return {
        status: "ready" as const,
        customerId: "cust_phase3",
        propertyId: "prop_phase3",
        customerCreated: false,
        propertyCreated: false,
      };
    },
    journal: async (_supabase, args) => {
      order.push("journal");
      journalArgs = args;
      return { written: 2, duplicates: 0, failed: 0 };
    },
  });
  assertEquals(controllerCalls, 1);
  assertEquals(projectCalls, 1);
  assertEquals(readCalls, 1);
  assertEquals(prepareCalls, 0);
  assertEquals(order, ["controller", "persist", "project", "read", "journal"]);
  assertEquals(result.stateCommitted, true);
  assertEquals(result.spoken, "How can I help?");
  assertEquals(journalArgs.turns, [
    { role: "user", content: "I need window cleaning" },
    { role: "assistant", content: "How can I help?" },
  ]);
});

Deno.test("phase3 route pre-price fsm ask does not prepare identity before pricing", async () => {
  let controllerCalls = 0;
  let projectCalls = 0;
  let prepareCalls = 0;
  const identityReadyUnpriced: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      name: "Synthetic Caller",
      phone: "+14695550172",
      email: "synthetic.route@example.invalid",
      address: "123 Synthetic Lane, Frisco, TX 75034",
      callerIdConfirmationStatus: "contact_confirmed",
      serviceAreaStatus: "eligible",
      voiceJourney: { intent: "new_quote", policyVersion: "voice-express-v1" },
    },
    fieldStatus: {
      services: "captured",
      name: "verified",
      phone: "verified",
      email: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "none",
  };
  const result = await executeControllerRoute(input(), {
    runController: async () => {
      controllerCalls += 1;
      return {
        sessionId: identityReadyUnpriced.id,
        sessionPatch: { fields: { services: ["window_cleaning"] } },
        pre: {
          kind: "fsm" as const,
          action: {
            kind: "ask" as const,
            field: "squareFootage" as const,
            prompt: "About how many square feet is the home?",
          },
          spoken: "About how many square feet is the home?",
        },
      };
    },
    persist: async () => ({ status: "persisted" as const }),
    project: async () => {
      projectCalls += 1;
      return { status: "projected" as const, attempts: 1 };
    },
    readSession: async () => identityReadyUnpriced,
    prepareIdentity: async () => {
      prepareCalls += 1;
      return {
        status: "ready" as const,
        customerId: "cust_phase3",
        propertyId: "prop_phase3",
        customerCreated: false,
        propertyCreated: false,
      };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(controllerCalls, 1);
  assertEquals(projectCalls, 1);
  assertEquals(prepareCalls, 0);
  assertEquals(result.spoken, "About how many square feet is the home?");
  assertEquals(result.event, "workflow_controller");
});

Deno.test("phase3 route stale firm requestedNextStep does not prepare identity during speak_price", async () => {
  let controllerCalls = 0;
  let projectCalls = 0;
  let prepareCalls = 0;
  const staleFirm: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      squareFootage: 2000,
      windowCleaningSides: "outside_only",
      name: "Synthetic Caller",
      phone: "+14695550172",
      address: "123 Synthetic Lane, Frisco, TX 75034",
      serviceAreaStatus: "eligible",
      callerIdConfirmationStatus: "contact_confirmed",
      voiceJourney: {
        intent: "new_quote",
        policyVersion: "voice-express-v1",
        requestedNextStep: "schedule",
      },
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 216.5,
        estimatedTotal: 216.5,
      },
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      windowCleaningSides: "captured",
      name: "verified",
      phone: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "firm",
  };
  const exactPriceSpeech =
    "For all exterior windows, your estimate is $216.50. This estimate assumes standard conditions. If we find anything unusual that would affect the price, we'll discuss it with you before starting. Otherwise, we'll honor the quoted price. Would you like the quote texted, or would you like to continue toward scheduling?";
  const result = await executeControllerRoute(input(), {
    runController: async () => {
      controllerCalls += 1;
      return {
        sessionId: staleFirm.id,
        sessionPatch: {},
        pre: {
          kind: "fsm" as const,
          action: { kind: "speak_price" as const },
          spoken: exactPriceSpeech,
        },
      };
    },
    persist: async () => ({ status: "noop" as const }),
    project: async () => {
      projectCalls += 1;
      return { status: "projected" as const, attempts: 1 };
    },
    readSession: async () => staleFirm,
    prepareIdentity: async () => {
      prepareCalls += 1;
      return {
        status: "ready" as const,
        customerId: "cust_phase3",
        propertyId: "prop_phase3",
        customerCreated: false,
        propertyCreated: false,
      };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(controllerCalls, 1);
  assertEquals(projectCalls, 1);
  assertEquals(prepareCalls, 0);
  assertEquals(result.spoken, exactPriceSpeech);
  assertEquals(result.event, "workflow_controller");
});

Deno.test("phase3 route explicit post-price continuation is eligible for identity preparation", async () => {
  let projectCalls = 0;
  let prepareCalls = 0;
  const postPrice: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      name: "Synthetic Caller",
      phone: "+14695550172",
      address: "123 Synthetic Lane, Frisco, TX 75034",
      serviceAreaStatus: "eligible",
      voiceJourney: {
        intent: "new_quote",
        policyVersion: "voice-express-v1",
        requestedNextStep: "schedule",
      },
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 216.5,
        estimatedTotal: 216.5,
      },
    },
    fieldStatus: {
      name: "verified",
      phone: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "firm",
  };
  const result = await executeControllerRoute(input(), {
    runController: async () => ({
      sessionId: postPrice.id,
      sessionPatch: {
        fields: {
          voiceJourney: {
            intent: "new_quote",
            policyVersion: "voice-express-v1",
            requestedNextStep: "schedule",
          },
        },
      },
      pre: {
        kind: "fsm" as const,
        action: { kind: "offer_scheduling" as const },
        spoken: "Great, I can help with scheduling next.",
      },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => {
      projectCalls += 1;
      return { status: "projected" as const, attempts: 1 };
    },
    readSession: async () => postPrice,
    prepareIdentity: async () => {
      prepareCalls += 1;
      return {
        status: "ready" as const,
        customerId: "cust_phase3",
        propertyId: "prop_phase3",
        customerCreated: false,
        propertyCreated: false,
      };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(prepareCalls, 1);
  assertEquals(projectCalls, 2);
  assertEquals(result.spoken, "Great, I can help with scheduling next.");
  assertEquals(result.event, "workflow_controller");
});

Deno.test("phase3 route firm operational note does not trigger identity or delivery", async () => {
  let prepareCalls = 0;
  let deliverCalls = 0;
  let projectCalls = 0;
  const firmWithNote: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      windowCleaningSides: "outside_only",
      squareFootage: 2000,
      voiceJourney: { requestedNextStep: "none" },
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 216.5,
        estimatedTotal: 216.5,
      },
    },
    quoteStatus: "firm",
  };
  const beforeSerialized = JSON.stringify(firmWithNote.fields);
  const exactSpeech = "I noted that for the crew.";
  const result = await executeControllerRoute({
    ...input(),
    messages: [{
      role: "user" as const,
      content:
        "Please text before arrival; front window is outside near the ladder, and the dog and gate are tricky.",
    }],
    callFunction: () => Promise.resolve({ status: 200, json: {} }),
  }, {
    runController: async () => ({
      sessionId: firmWithNote.id,
      sessionPatch: {
        fields: {
          ...firmWithNote.fields,
          voiceJourney: {
            ...(firmWithNote.fields.voiceJourney ?? {}),
            volunteeredNotes: [
              "Please text before arrival; front window is outside near the ladder, and the dog and gate are tricky.",
            ],
          },
        },
      },
      pre: { kind: "ask_intent" as const, spoken: exactSpeech },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => {
      projectCalls += 1;
      return { status: "projected" as const, attempts: 1 };
    },
    readSession: async () => firmWithNote,
    prepareIdentity: async () => {
      prepareCalls += 1;
      return {
        status: "ready" as const,
        customerId: "cust_phase3",
        propertyId: "prop_phase3",
        customerCreated: false,
        propertyCreated: false,
      };
    },
    deliverQuote: async () => {
      deliverCalls += 1;
      return { ok: true, status: "provider_accepted" as const };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.spoken, exactSpeech);
  assertEquals(result.event, "workflow_controller");
  assertEquals(projectCalls, 1);
  assertEquals(prepareCalls, 0);
  assertEquals(deliverCalls, 0);
  assertEquals(firmWithNote.quoteStatus, "firm");
  assertEquals(JSON.stringify(firmWithNote.fields), beforeSerialized);
});

Deno.test("phase6 controller reports revoked delivery authority without a success claim", async () => {
  let providerCalls = 0;
  let deliveryCalls = 0;
  const firmSession: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      name: "Synthetic Caller",
      phone: "+14695550172",
      callerIdConfirmationStatus: "contact_confirmed",
      address: "123 Synthetic Lane, Frisco, TX 75034",
      serviceAreaStatus: "eligible",
      voiceJourney: { requestedNextStep: "text_quote" },
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 216.5,
        estimatedTotal: 216.5,
      },
    },
    fieldStatus: {
      name: "verified",
      phone: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
    quoteStatus: "firm",
  };
  const result = await executeControllerRoute({
    ...input(),
    messages: [{ role: "user" as const, content: "Please text me the quote" }],
    callFunction: () => {
      providerCalls += 1;
      return Promise.resolve({ status: 200, json: { accepted: true } });
    },
  }, {
    runController: async () => ({
      sessionId: firmSession.id,
      sessionPatch: {},
      pre: {
        kind: "fsm" as const,
        action: {
          kind: "ask" as const,
          field: "contact_name" as const,
          prompt: "Name?",
        },
        spoken: "Name?",
      },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => firmSession,
    prepareIdentity: async () => ({
      status: "not_ready" as const,
      blocker: "name_unconfirmed" as const,
    }),
    deliverQuote: async () => {
      deliveryCalls += 1;
      return {
        ok: false,
        status: "failed_terminal" as const,
        reason: "stale_quote_context" as const,
      };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.event, "voice_quote_by_text_failed");
  assertStringIncludes(result.spoken, "didn't go through");
  assertEquals(/accepted|delivered/i.test(result.spoken), false);
  assertEquals(deliveryCalls, 1);
  assertEquals(providerCalls, 0);
});

Deno.test("phase3 route speaks corrected price without contact, identity, or delivery work", async () => {
  let prepareCalls = 0;
  let deliveryCalls = 0;
  let providerCalls = 0;
  const correctedFirm: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      squareFootage: 2500,
      windowCleaningSides: "outside_only",
      voiceJourney: {
        intent: "new_quote",
        requestedNextStep: "none",
      },
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 200,
        estimatedTotal: 216.5,
      },
    },
    quoteStatus: "firm",
  };
  const exactSpeech =
    "For all exterior windows, your estimate is $216.50. This estimate assumes standard conditions. If we find anything unusual that would affect the price, we'll discuss it with you before starting. Otherwise, we'll honor the quoted price. Would you like the quote texted, or would you like to continue toward scheduling?";
  const result = await executeControllerRoute({
    ...input(),
    messages: [{
      role: "user" as const,
      content: "Actually it is 2500 square feet",
    }],
    callFunction: () => {
      providerCalls += 1;
      return Promise.resolve({ status: 200, json: {} });
    },
  }, {
    runController: async () => ({
      sessionId: correctedFirm.id,
      sessionPatch: {
        fields: correctedFirm.fields,
        quote_status: "firm",
      },
      pre: {
        kind: "fsm" as const,
        action: { kind: "speak_price" as const },
        spoken: exactSpeech,
      },
    }),
    persist: async () => ({ status: "persisted" as const }),
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => correctedFirm,
    prepareIdentity: async () => {
      prepareCalls += 1;
      return {
        status: "not_ready" as const,
        blocker: "name_unconfirmed" as const,
      };
    },
    deliverQuote: async () => {
      deliveryCalls += 1;
      return { ok: true, status: "provider_accepted" as const };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.spoken, exactSpeech);
  assertEquals(result.event, "workflow_controller");
  assertEquals(prepareCalls, 0);
  assertEquals(deliveryCalls, 0);
  assertEquals(providerCalls, 0);
  assertEquals(correctedFirm.fields.name, undefined);
  assertEquals(correctedFirm.fields.phone, undefined);
  assertEquals(correctedFirm.fields.email, undefined);
  assertEquals(correctedFirm.fields.address, undefined);
});

Deno.test("phase3 route text refusal persists no branch and calls no provider", async () => {
  let durable: QuoteSession = {
    ...session,
    fields: {
      services: ["window_cleaning"],
      voiceJourney: {
        intent: "new_quote",
        requestedNextStep: "text_quote",
      },
      lastQuoteResult: {
        status: "firm",
        finalQuoteDisposition: "firm",
        total: 200,
        estimatedTotal: 216.5,
      },
    },
    quoteStatus: "firm",
  };
  let prepareCalls = 0;
  let deliveryCalls = 0;
  let providerCalls = 0;
  const result = await executeControllerRoute({
    ...input(),
    messages: [{ role: "user" as const, content: "No, don't text it" }],
    callFunction: () => {
      providerCalls += 1;
      return Promise.resolve({ status: 200, json: {} });
    },
  }, {
    runController: async () => {
      const fields = {
        ...durable.fields,
        voiceJourney: {
          ...(durable.fields.voiceJourney ?? {}),
          requestedNextStep: "none" as const,
        },
      };
      return {
        sessionId: durable.id,
        sessionPatch: { fields },
        pre: {
          kind: "fsm" as const,
          action: {
            kind: "answer_side_question" as const,
            topic: "post_price_choice",
          },
          spoken:
            "I won't send a quote text. Would you like the quote texted, or would you like to continue toward scheduling?",
        },
      };
    },
    persist: async (_supabase, _sessionId, patch) => {
      if (patch.fields) {
        durable = {
          ...durable,
          fields: patch.fields as QuoteSession["fields"],
        };
      }
      return { status: "persisted" as const };
    },
    project: async () => ({ status: "projected" as const, attempts: 1 }),
    readSession: async () => durable,
    prepareIdentity: async () => {
      prepareCalls += 1;
      return {
        status: "not_ready" as const,
        blocker: "name_unconfirmed" as const,
      };
    },
    deliverQuote: async () => {
      deliveryCalls += 1;
      return { ok: true, status: "provider_accepted" as const };
    },
    journal: async () => ({ written: 2, duplicates: 0, failed: 0 }),
  });
  assertEquals(result.event, "workflow_controller");
  assertEquals(durable.fields.voiceJourney?.requestedNextStep, "none");
  assertEquals(prepareCalls, 0);
  assertEquals(deliveryCalls, 0);
  assertEquals(providerCalls, 0);
});
