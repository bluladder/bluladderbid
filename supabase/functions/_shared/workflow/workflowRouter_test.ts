import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyWorkflow } from "./workflowRouter.ts";
import type { QuoteSession } from "../quoteSession.ts";

const emptySession: QuoteSession = {
  id: "x", channel: "voice", conversationIds: [], fields: {}, fieldStatus: {},
  requiredRemaining: [], quoteStatus: "none", bookingReady: false,
};

Deno.test("price/quote keywords → new_quote", () => {
  assertEquals(classifyWorkflow("how much for window cleaning", emptySession), "new_quote");
});
Deno.test("cancel keywords → cancel", () => {
  assertEquals(classifyWorkflow("I need to cancel my appointment", emptySession), "cancel");
});
Deno.test("schedule without quote → schedule_service", () => {
  assertEquals(classifyWorkflow("when can you come out", emptySession), "schedule_service");
});
Deno.test("schedule with active quote also routes to schedule_service", () => {
  const s: QuoteSession = { ...emptySession, quoteStatus: "estimated" };
  assertEquals(classifyWorkflow("when can you book me", s), "schedule_service");
});
Deno.test("hours question → general_inquiry", () => {
  assertEquals(classifyWorkflow("what are your hours", emptySession), "general_inquiry");
});
Deno.test("sticky quote intent is not reclassified from a later short answer", () => {
  const session: QuoteSession = {
    ...emptySession,
    fields: { voiceJourney: { intent: "new_quote" } },
  };
  assertEquals(classifyWorkflow("hi", session), "new_quote");
  assertEquals(classifyWorkflow("yes", session), "new_quote");
});
