import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceSaveQuoteBody,
  deliverVoiceQuoteByText,
  resolveQuoteRecipientEmail,
} from "./quoteByTextDelivery.ts";

const facts = {
  services: ["window_cleaning"],
  address: "123 Main St, Frisco, TX",
  property: { squareFootage: 2500, stories: 2, windowCleaningType: "exterior" },
  quote: { status: "firm", firm: true, total: 389 },
  contact: { name: "Ben Millen", phone: "+14692150144", phoneConfirmed: true },
} as any;

function sbWithRows(rows: Array<{ email: string; phone: string }>) {
  return {
    from: () => ({
      select: () => ({
        not: () => ({
          ilike: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }),
  } as any;
}

function sbWithEmail(email: string | null) {
  return sbWithRows(email ? [{ email, phone: "4692150144" }] : []);
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

Deno.test("ambiguous phone to email never guesses a customer", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sbWithRows([
      { email: "blmillen@gmail.com", phone: "4692150144" },
      { email: "ben@bluladder.com", phone: "4692150144" },
    ]),
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

Deno.test("resolves a single on-file email and ignores partial-digit matches", async () => {
  const res = await resolveQuoteRecipientEmail(
    sbWithRows([
      { email: "known@x.com", phone: "(469) 215-0144" },
      { email: "other@x.com", phone: "+1246921501441" },
    ]),
    facts,
    "+14692150144",
  );
  assertEquals(res, "known@x.com");
});

Deno.test("a caller-spoken email always wins over on-file lookup", async () => {
  const res = await resolveQuoteRecipientEmail(
    sbWithRows([{ email: "onfile@x.com", phone: "4692150144" }]),
    { ...facts, contact: { ...facts.contact, email: "Spoken@X.com " } } as any,
    "+14692150144",
  );
  assertEquals(res, "spoken@x.com");
});

Deno.test("a repeated ask in one call reuses the same quote session scope", async () => {
  const sessionIds: unknown[] = [];
  const call = () =>
    deliverVoiceQuoteByText({
      supabase: sbWithEmail("known@x.com"),
      facts,
      sessionId: "sess-live",
      callFunction: (name, body: any) => {
        if (name === "save-quote") sessionIds.push(body.sourceSessionId);
        return Promise.resolve(
          name === "save-quote"
            ? { status: 200, json: { quoteId: "q1" } }
            : { status: 200, json: { transactionalSent: true } },
        );
      },
    });
  await call();
  await call();
  // Identical sourceSessionId => save-quote updates one quote row, and the
  // resulting SMS outbound key (quote_delivery:sms:q1:digits) is unchanged, so
  // the outbox claim replays instead of dispatching twice.
  assertEquals(sessionIds, ["sess-live", "sess-live"]);
});

Deno.test("orchestrator only supplies a live deliver closure on the allowlisted lane", async () => {
  const src = await Deno.readTextFile(
    new URL("../aiOrchestrator.ts", import.meta.url),
  );
  const rail = src.slice(src.indexOf("classifyQuoteByTextRequest(userMessage)"));
  assertEquals(
    /resolveVoiceBookingLane\(facts\.contact\?\.phone/.test(rail),
    true,
  );
  assertEquals(/deliver: deliveryLane === "live"/.test(rail), true);
  assertEquals(/: null,/.test(rail), true);
});
