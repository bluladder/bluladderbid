import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyQuoteByTextCancellation,
  classifyQuoteByTextRequest,
  planQuoteByTextCancellation,
  planQuoteByTextResponse,
} from "./quoteByText.ts";

const base = {
  quoteIsFirm: true,
  total: 389,
  name: "Ben",
  phone: "+14692150144",
  phoneIsFullE164: true,
  address: "123 Main St, Frisco, TX",
  addressEligible: true,
};

Deno.test("a missing service address is asked for, not assumed", async () => {
  const plan = await planQuoteByTextResponse({
    ...base,
    address: null,
    addressEligible: false,
    deliver: () => Promise.resolve({ ok: true }),
  });
  assertEquals(plan.sent, false);
  assertEquals(plan.missingField, "address");
  assert(/haven't sent that text yet/i.test(plan.reply));
});

Deno.test("an email_unavailable delivery asks for the email", async () => {
  const plan = await planQuoteByTextResponse({
    ...base,
    deliver: () => Promise.resolve({ ok: false, reason: "email_unavailable" }),
  });
  assertEquals(plan.outcome, "not_sent_missing_email");
  assertEquals(plan.missingField, "email");
  assert(/email/i.test(plan.reply));
});

Deno.test("a missing_address delivery reason asks for the address", async () => {
  const plan = await planQuoteByTextResponse({
    ...base,
    deliver: () => Promise.resolve({ ok: false, reason: "missing_address" }),
  });
  assertEquals(plan.missingField, "address");
});

Deno.test("an unexplained failure is still reported truthfully", async () => {
  const plan = await planQuoteByTextResponse({
    ...base,
    deliver: () => Promise.resolve({ ok: false, reason: "sms_not_sent" }),
  });
  assertEquals(plan.outcome, "not_sent_delivery_failed");
  assertEquals(plan.missingField, null);
  assert(/didn'?t go through/i.test(plan.reply));
});

Deno.test("cancellation is detected and never confused with a new request", () => {
  assert(classifyQuoteByTextCancellation("never mind"));
  assert(classifyQuoteByTextCancellation("don't text it, thanks"));
  assert(classifyQuoteByTextCancellation("no thanks"));
  assert(!classifyQuoteByTextCancellation("my email is ben@x.com"));
  assert(!classifyQuoteByTextCancellation("123 Main Street Frisco"));
  assert(classifyQuoteByTextRequest("text me the quote"));
});

Deno.test("a cancelled request truthfully states nothing was sent", () => {
  const plan = planQuoteByTextCancellation();
  assertEquals(plan.sent, false);
  assertEquals(plan.outcome, "cancelled");
  assertEquals(plan.missingField, null);
  assert(/have not sent any text/i.test(plan.reply));
});

Deno.test("the orchestrator resumes a pending request without a repeat ask", async () => {
  const src = await Deno.readTextFile(
    new URL("../aiOrchestrator.ts", import.meta.url),
  );
  assert(/facts\.quoteByText\?\.pending === true/.test(src));
  assert(/if \(quoteByTextAsked \|\| quoteByTextPending\)/.test(src));
  assert(/classifyQuoteByTextCancellation\(userMessage\)/.test(src));
  assert(/pending: plan\.missingField !== null/.test(src));
});
