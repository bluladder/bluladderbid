import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceSaveQuoteBody,
  deliverVoiceQuoteByText,
} from "./quoteByTextDelivery.ts";

const facts = {
  services: ["window_cleaning"],
  address: "123 Main St, Frisco, TX",
  property: { squareFootage: 2500, stories: 2, windowCleaningType: "exterior" },
  quote: { status: "firm", firm: true, total: 389 },
  contact: { name: "Ben Millen", phone: "+14692150144", phoneConfirmed: true },
} as any;

function sbWithEmail(email: string | null) {
  return {
    from: () => ({
      select: () => ({
        not: () => ({
          ilike: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: email ? [{ email }] : [], error: null }),
            }),
          }),
        }),
      }),
    }),
  } as any;
}

Deno.test("save-quote payload never triggers an email and carries the total", () => {
  const body = buildVoiceSaveQuoteBody({
    facts,
    email: "a@b.com",
    phoneE164: "+14692150144",
    sessionId: "sess-1",
  }) as any;
  assertEquals(body.action, "save");
  assertEquals(body.total, 389);
  assertEquals(body.additionalServices.windowCleaning, true);
  assertEquals(body.sourceSessionId, "sess-1");
  assertEquals(body.services.length, 1);
});

Deno.test("delivers via save-quote then send-sms and reports sent", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sbWithEmail("known@x.com"),
    facts,
    sessionId: null,
    callFunction: (name) => {
      calls.push(name);
      return Promise.resolve(
        name === "save-quote"
          ? { status: 200, json: { quoteId: "q1" } }
          : { status: 200, json: { transactionalSent: true } },
      );
    },
  });
  assertEquals(res.ok, true);
  assertEquals(res.quoteId, "q1");
  assertEquals(calls, ["save-quote", "send-sms"]);
});

Deno.test("suppressed or failed SMS is never reported as sent", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sbWithEmail("known@x.com"),
    facts,
    callFunction: (name) =>
      Promise.resolve(
        name === "save-quote"
          ? { status: 200, json: { quoteId: "q1" } }
          : {
            status: 200,
            json: { transactionalSent: false, transactionalError: "opted_out" },
          },
      ),
  });
  assertEquals(res.ok, false);
  assertEquals(res.reason, "sms_not_sent");
});

Deno.test("no resolvable email means no send attempt at all", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sbWithEmail(null),
    facts,
    callFunction: (name) => {
      calls.push(name);
      return Promise.resolve({ status: 200, json: {} });
    },
  });
  assertEquals(res.ok, false);
  assertEquals(res.reason, "email_unavailable");
  assertEquals(calls, []);
});

Deno.test("a non-firm zero total never reaches save-quote", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sbWithEmail("known@x.com"),
    facts: { ...facts, quote: { total: 0 } } as any,
    callFunction: () => Promise.resolve({ status: 200, json: {} }),
  });
  assertEquals(res.reason, "missing_quote_total");
});
