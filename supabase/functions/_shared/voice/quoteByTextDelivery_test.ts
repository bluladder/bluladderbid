// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceSaveQuoteBody,
  deliverVoiceQuoteByText as deliverVoiceQuoteByTextRaw,
  resolveQuoteRecipientEmail,
  servicesFromFacts,
} from "./quoteByTextDelivery.ts";
import { quoteInputsKey } from "../conversationState.ts";
import { type QuoteSessionFields, sessionInputsKey } from "../quoteSession.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "../publicBookingServiceArea.ts";

const ORGANIZATION_ID = PUBLIC_BOOKING_ORGANIZATION_ID;
const DELIVERY_SCOPE = {
  organizationId: ORGANIZATION_ID,
  quoteSessionId: "sess-live",
  conversationId: "conv-1",
};

function deliverVoiceQuoteByText(
  input: Parameters<typeof deliverVoiceQuoteByTextRaw>[0],
) {
  return deliverVoiceQuoteByTextRaw({ ...DELIVERY_SCOPE, ...input });
}

const facts = {
  services: ["window_cleaning"],
  address: "123 Main St, Frisco, TX 75034",
  serviceArea: { status: "eligible" },
  property: { squareFootage: 2500, stories: 2, windowCleaningType: "exterior" },
  quote: {
    status: "firm",
    firm: true,
    total: 389,
    lineItems: [{
      key: "window_cleaning",
      label: "Window Cleaning",
      amount: 389,
    }],
    engineVersion: "v3",
    pricingVersion: 7,
  },
  contact: { name: "Ben Millen", phone: "+14692150144", phoneConfirmed: true },
} as any;
// A firm quote is only "current" while its inputs signature still matches.
facts.quote.inputsKey = quoteInputsKey(facts);

function firmCanonicalFields(
  overrides: Partial<QuoteSessionFields> = {},
): QuoteSessionFields {
  const base: QuoteSessionFields = {
    services: ["windowCleaning"],
    squareFootage: 2500,
    stories: 2,
    windowCleaningSides: "inside_and_outside",
    condition: "maintenance",
    advancedWindowConditions: false,
    screenProfile: "standard_removable",
    enclosedPatioProfile: "none",
    phone: "+14692150144",
    email: "known@x.com",
    name: "Ben Millen",
    address: "123 Main St, Frisco, TX 75034",
    serviceAreaStatus: "eligible",
    ...overrides,
  };
  const inputsKey = sessionInputsKey(base);
  return {
    ...base,
    lastQuoteResult: {
      status: "firm",
      finalQuoteDisposition: "firm",
      inputsKey,
      serviceSubtotal: 389,
      estimatedTax: 32.09,
      estimatedTotal: 421.09,
      engineVersion: "canonical-engine",
      ruleVersion: 9,
      lineItems: [{
        key: "window_cleaning",
        label: "Canonical Window Cleaning",
        amount: 389,
      }],
    },
    voiceJourney: {
      quoteContext: {
        inputsKey,
        finalQuoteDisposition: "firm",
        estimatedTotal: 421.09,
      },
    },
  };
}

/** Minimal stub of the exact-id reads the delivery path performs. */
function sb(opts: {
  session?: Record<string, unknown> | null;
  conversation?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  quote?: Record<string, unknown> | null;
  phoneRows?: Array<Record<string, unknown>> | null;
  reads?: string[];
  updateError?: boolean;
} = {}) {
  const reads = opts.reads ?? [];
  const defaultFields = firmCanonicalFields();
  const defaultSession = {
    id: "sess-live",
    organization_id: ORGANIZATION_ID,
    email_normalized: "known@x.com",
    customer_id: "customer-1",
    property_id: "property-1",
    quote_id: null,
    fields: defaultFields,
    field_status: {
      name: "verified",
      email: "verified",
      phone: "verified",
      address: "verified",
      serviceAreaStatus: "verified",
    },
  };
  const sessionData = opts.session === null
    ? null
    : { ...defaultSession, ...(opts.session ?? {}) };
  const conversationData = opts.conversation === null ? null : {
    id: "conv-1",
    organization_id: ORGANIZATION_ID,
    quote_session_id: "sess-live",
    customer_id: "customer-1",
    property_id: "property-1",
    ...(opts.conversation ?? {}),
  };
  const table = (name: string) => ({
    select: () => {
      const query: any = {
        eq: () => query,
        is: () => query,
        limit: () => {
          reads.push(`${name}:by_phone`);
          return Promise.resolve({ data: opts.phoneRows ?? [], error: null });
        },
        maybeSingle: () => {
          reads.push(name);
          if (name === "quote_sessions") {
            return Promise.resolve({ data: sessionData, error: null });
          }
          if (name === "chat_conversations") {
            return Promise.resolve({ data: conversationData, error: null });
          }
          if (name === "customers") {
            return Promise.resolve({
              data: opts.customer ?? null,
              error: null,
            });
          }
          if (name === "quotes") {
            return Promise.resolve({
              data: opts.quote === undefined
                ? {
                  id: "q1",
                  organization_id: ORGANIZATION_ID,
                  customer_id: "customer-1",
                  property_id: null,
                }
                : opts.quote,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
    update: () => {
      const mutation: any = {
        eq: () => mutation,
        is: () => mutation,
        select: () => mutation,
        maybeSingle: () =>
          Promise.resolve(
            opts.updateError
              ? { data: null, error: new Error("write failed") }
              : { data: { id: "linked" }, error: null },
          ),
      };
      return mutation;
    },
  });
  return { from: (name: string) => table(name) } as any;
}

const ok = (name: string) =>
  Promise.resolve(
    name === "save-quote" ? { status: 200, json: { quoteId: "q1" } } : {
      status: 200,
      json: { transactionalSent: true, deliveryStatus: "accepted" },
    },
  );

Deno.test("save-quote payload carries canonical line items and a stable scope", () => {
  const body = buildVoiceSaveQuoteBody({
    facts,
    email: "a@b.com",
    phoneE164: "+14692150144",
    sourceSessionId: "sess-1",
  }) as any;
  assertEquals(body.action, "save");
  assertEquals(body.total, 389);
  assertEquals(body.additionalServices.windowCleaning, true);
  assertEquals(body.sourceSessionId, "sess-1");
  assertEquals(body.organizationId, undefined);
  assertEquals(body.services, [{ name: "Window Cleaning", amount: 389 }]);
  assertEquals(body.engineVersion, "v3");
  assertEquals(body.ruleVersion, 7);
});

Deno.test("save-quote payload uses canonical session inputs, promotion, and tax-inclusive total", () => {
  const body = buildVoiceSaveQuoteBody({
    facts,
    email: "a@b.com",
    phoneE164: "+14692150144",
    sourceSessionId: "sess-1",
    sessionFields: {
      services: ["windowCleaning"],
      squareFootage: 2500,
      stories: 2,
      windowCleaningSides: "inside_and_outside",
      condition: "maintenance",
      advancedWindowConditions: true,
      hardWaterStains: true,
      hardWaterAffectedWindowEquivalents: 4,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
      promotionId: "promo-99",
      windowCount: 10,
      lastQuoteResult: {
        total: 389,
        serviceSubtotal: 389,
        estimatedTax: 32.09,
        estimatedTotal: 421.09,
        engineVersion: "canonical-engine",
        ruleVersion: 9,
        lineItems: [{
          key: "window_cleaning",
          label: "Canonical Window Cleaning",
          amount: 389,
        }],
      },
    },
  });
  const homeDetails = body.homeDetails as Record<string, unknown>;
  assertEquals(body.total, 421.09);
  assertEquals(body.subtotal, 389);
  assertEquals(homeDetails.windowCleaningType, "both");
  assertEquals(homeDetails.hardWaterAffectedWindowEquivalents, 4);
  assertEquals(body.promotion, { id: "promo-99", windowCount: 10 });
  assertEquals(body.services, [{
    name: "Canonical Window Cleaning",
    amount: 389,
  }]);
  assertEquals(body.engineVersion, "canonical-engine");
  assertEquals(body.ruleVersion, 9);
});

Deno.test("line items fall back to service slugs only when absent", () => {
  assertEquals(servicesFromFacts({ ...facts, quote: { total: 1 } } as any), [
    { name: "window_cleaning" },
  ]);
});

Deno.test("delivers via save-quote then send-sms and reports sent", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) => {
      calls.push(name);
      return ok(name);
    },
  });
  assertEquals(res.ok, true);
  assertEquals(res.quoteId, "q1");
  assertEquals(calls, ["save-quote", "send-sms"]);
});

Deno.test("an unaccepted SMS is never reported as sent", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) =>
      Promise.resolve(
        name === "save-quote" ? { status: 200, json: { quoteId: "q1" } } : {
          status: 200,
          json: { transactionalSent: false, deliveryStatus: "suppressed" },
        },
      ),
  });
  assertEquals(res.ok, false);
  assertEquals(res.reason, "sms_not_sent");
});

Deno.test("local linkage failure blocks SMS before provider delivery", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sb({
      session: { email_normalized: "known@x.com" },
      updateError: true,
    }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) => {
      calls.push(name);
      return ok(name);
    },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, "failed_terminal");
  assertEquals(res.detail, "saved_quote_lineage_unconfirmed");
  assertEquals(calls, ["save-quote"]);
});

Deno.test("saved quote customer mismatch blocks SMS before provider delivery", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sb({
      quote: {
        id: "q1",
        organization_id: ORGANIZATION_ID,
        customer_id: "customer-other",
        property_id: null,
      },
    }),
    facts,
    callFunction: (name) => {
      calls.push(name);
      return ok(name);
    },
  });
  assertEquals(res.detail, "saved_quote_lineage_unconfirmed");
  assertEquals(calls, ["save-quote"]);
});

Deno.test("conversation property mismatch blocks SMS before provider delivery", async () => {
  const calls: string[] = [];
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ conversation: { property_id: "property-other" } }),
    facts,
    callFunction: (name) => {
      calls.push(name);
      return ok(name);
    },
  });
  assertEquals(res.detail, "saved_quote_lineage_unconfirmed");
  assertEquals(calls, ["save-quote"]);
});

Deno.test("queued outbox evidence remains queued and is not called sent", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) =>
      Promise.resolve(
        name === "save-quote" ? { status: 200, json: { quoteId: "q1" } } : {
          status: 200,
          json: {
            transactionalSent: false,
            deliveryStatus: "queued",
            transactionalAttemptId: "sms-1",
          },
        },
      ),
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, "queued");
  assertEquals(res.attemptId, "sms-1");
});

Deno.test("transport exceptions after a possible write are reported uncertain", async () => {
  const saveUncertain = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: () => Promise.reject(new Error("timeout")),
  });
  assertEquals(saveUncertain.status, "uncertain");
  assertEquals(saveUncertain.detail, "save_quote_transport_uncertain");

  const smsUncertain = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) =>
      name === "save-quote"
        ? Promise.resolve({ status: 200, json: { quoteId: "q1" } })
        : Promise.reject(new Error("timeout")),
  });
  assertEquals(smsUncertain.status, "uncertain");
  assertEquals(smsUncertain.quoteId, "q1");
  assertEquals(smsUncertain.detail, "send_sms_transport_uncertain");
});

Deno.test("malformed successful transport responses fail closed as uncertain", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: () => Promise.resolve({ status: 200, json: {} }),
  });
  assertEquals(res.status, "uncertain");
  assertEquals(res.reason, "save_quote_failed");
});

Deno.test("explicit 5xx responses remain retry-pending, not terminal", async () => {
  const saveRetry = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: () =>
      Promise.resolve({ status: 503, json: { status: "unavailable" } }),
  });
  assertEquals(saveRetry.status, "retry_pending");

  const smsRetry = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) =>
      Promise.resolve(
        name === "save-quote"
          ? { status: 200, json: { quoteId: "q1" } }
          : { status: 503, json: {} },
      ),
  });
  assertEquals(smsRetry.status, "retry_pending");
});

Deno.test("canonical session firmness overrides divergent legacy facts", async () => {
  const canonical = firmCanonicalFields();
  const legacyNonFirm = {
    ...facts,
    quote: { status: "estimated", firm: false, total: 1 },
  } as typeof facts;
  const result = await deliverVoiceQuoteByText({
    supabase: sb({
      session: { email_normalized: "known@x.com", fields: canonical },
    }),
    facts: legacyNonFirm,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: ok,
  });
  assertEquals(result.status, "provider_accepted");
});

Deno.test("legacy firmness cannot bypass canonical manual review", async () => {
  const canonical = firmCanonicalFields();
  canonical.lastQuoteResult = {
    ...canonical.lastQuoteResult,
    finalQuoteDisposition: "manual_review",
  };
  if (canonical.voiceJourney?.quoteContext) {
    canonical.voiceJourney.quoteContext.finalQuoteDisposition = "manual_review";
  }
  const calls: string[] = [];
  const result = await deliverVoiceQuoteByText({
    supabase: sb({
      session: { email_normalized: "known@x.com", fields: canonical },
    }),
    facts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: (name) => {
      calls.push(name);
      return ok(name);
    },
  });
  assertEquals(result.reason, "quote_not_firm");
  assertEquals(calls, []);
});

Deno.test("no resolvable email means no send attempt at all", async () => {
  const calls: string[] = [];
  const withoutEmail = firmCanonicalFields();
  delete withoutEmail.email;
  const res = await deliverVoiceQuoteByText({
    supabase: sb({
      session: {
        email_normalized: null,
        fields: withoutEmail,
        field_status: { email: "unanswered" },
      },
    }),
    facts,
    conversationId: "conv-1",
    callFunction: (name) => {
      calls.push(name);
      return ok(name);
    },
  });
  assertEquals(res.reason, "email_unavailable");
  assertEquals(calls, []);
});

Deno.test("a non-firm quote never reaches save-quote", async () => {
  const nonFirm = firmCanonicalFields();
  nonFirm.lastQuoteResult = {
    ...nonFirm.lastQuoteResult,
    finalQuoteDisposition: "manual_review",
  };
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { fields: nonFirm } }),
    facts: { ...facts, quote: { total: 300 } } as any,
    conversationId: "conv-1",
    callFunction: () => ok("save-quote"),
  });
  assertEquals(res.reason, "quote_not_firm");
});

Deno.test("an unverified service address blocks persistence", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sb({
      session: {
        field_status: {
          email: "verified",
          address: "captured",
          serviceAreaStatus: "verified",
        },
      },
    }),
    facts: {
      ...facts,
      serviceArea: { status: "manual_review_required" },
    } as any,
    conversationId: "conv-1",
    callFunction: () => ok("save-quote"),
  });
  assertEquals(res.reason, "missing_address");
});

Deno.test("an unconfirmed phone never receives a quote text", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts: { ...facts, contact: { name: "Ben", phone: "+14692150144" } } as any,
    conversationId: "conv-1",
    callFunction: () => ok("save-quote"),
  });
  assertEquals(res.reason, "phone_not_confirmed");
});

const promoFacts = (() => {
  const f = { ...facts, promotionId: "promo-99" } as any;
  f.quote = { ...f.quote, inputsKey: quoteInputsKey(f) };
  return f;
})();

Deno.test("a promotional price fails closed instead of persisting a wrong total", async () => {
  const res = await deliverVoiceQuoteByText({
    supabase: sb({ session: { email_normalized: "known@x.com" } }),
    facts: promoFacts,
    quoteSessionId: "sess-live",
    conversationId: "conv-1",
    callFunction: () => ok("save-quote"),
  });
  assertEquals(res.reason, "promotion_unmappable");
});

Deno.test("email resolution never searches by phone number", async () => {
  const reads: string[] = [];
  const res = await resolveQuoteRecipientEmail(
    sb({
      session: null,
      conversation: { prospect_email: "prospect@x.com" },
      reads,
    }),
    facts,
    { quoteSessionId: "sess-1", conversationId: "conv-1" },
  );
  assertEquals(res, "prospect@x.com");
  assertEquals(reads, ["quote_sessions", "chat_conversations"]);
});

Deno.test("resolution order: session email beats conversation and customer", async () => {
  const res = await resolveQuoteRecipientEmail(
    sb({
      session: { email_normalized: "Session@X.com" },
      conversation: { prospect_email: "prospect@x.com" },
    }),
    facts,
    { quoteSessionId: "sess-1", conversationId: "conv-1" },
  );
  assertEquals(res, "session@x.com");
});

Deno.test("a linked customer row is the last resort", async () => {
  const res = await resolveQuoteRecipientEmail(
    sb({
      session: { email_normalized: null, customer_id: "cust-1" },
      conversation: {},
      customer: { email: "OnFile@X.com" },
    }),
    facts,
    { quoteSessionId: "sess-1", conversationId: "conv-1" },
  );
  assertEquals(res, "onfile@x.com");
});

Deno.test("a caller-spoken email always wins over stored identity", async () => {
  const reads: string[] = [];
  const res = await resolveQuoteRecipientEmail(
    sb({ session: { email_normalized: "onfile@x.com" }, reads }),
    { ...facts, contact: { ...facts.contact, email: "Spoken@X.com " } } as any,
    { quoteSessionId: "sess-1", conversationId: "conv-1" },
  );
  assertEquals(res, "spoken@x.com");
  assertEquals(reads, []);
});

Deno.test("a repeated ask in one call reuses the same idempotency scope", async () => {
  const scopes: unknown[] = [];
  const call = () =>
    deliverVoiceQuoteByText({
      supabase: sb({ session: { email_normalized: "known@x.com" } }),
      facts,
      quoteSessionId: "sess-live",
      conversationId: "conv-1",
      callFunction: (name, body: any) => {
        if (name === "save-quote") scopes.push(body.sourceSessionId);
        return ok(name);
      },
    });
  await call();
  await call();
  assertEquals(scopes, ["sess-live", "sess-live"]);
});

Deno.test("without a canonical quote session delivery fails before provider calls", async () => {
  const scopes: unknown[] = [];
  await deliverVoiceQuoteByText({
    supabase: sb({ conversation: { prospect_email: "known@x.com" } }),
    facts,
    quoteSessionId: null,
    conversationId: "conv-1",
    callFunction: (name, body: any) => {
      if (name === "save-quote") scopes.push(body.sourceSessionId);
      return ok(name);
    },
  });
  assertEquals(scopes, []);
});

Deno.test("live delivery stays behind the existing voice lane gate", async () => {
  const src = await Deno.readTextFile(
    new URL("../aiOrchestrator.ts", import.meta.url),
  );
  const rail = src.slice(src.indexOf("const quoteByTextAsked"));
  const railEnd = rail.slice(0, rail.indexOf("buildSystemPrompt"));
  // A non-live lane passes deliver:null, which plans the truthful
  // "can't text it from this call" answer instead of a silent no-op.
  assertEquals(
    /resolveVoiceBookingLane\(facts\.contact\?\.phone/.test(railEnd),
    true,
  );
  assertEquals(/deliveryLane === "live"/.test(railEnd), true);
  assertEquals(/: null,/.test(railEnd), true);
  assertEquals(/quoteIsFirm: isQuoteFirm\(facts\)/.test(railEnd), true);
  // The pending answer is consumed deterministically before any delivery retry.
  assertEquals(
    /resolveQuoteByTextContinuation\(\{/.test(railEnd),
    true,
  );
  assertEquals(/missingField: plan\.missingField/.test(railEnd), true);
});

Deno.test("email resolves from exactly one on-file email for the confirmed phone", async () => {
  const reads: string[] = [];
  const email = await resolveQuoteRecipientEmail(
    sb({
      phoneRows: [{ email: "Ben@BluLadder.com" }, {
        email: "ben@bluladder.com",
      }],
      reads,
    }),
    { contact: { phone: "+14692150144", phoneConfirmed: true } } as any,
    {},
  );
  assertEquals(email, "ben@bluladder.com");
  assertEquals(reads.includes("customers:by_phone"), true);
});

Deno.test("ambiguous phone-to-email mapping resolves to null", async () => {
  const res = await resolveQuoteRecipientEmail(
    sb({
      phoneRows: [{ email: "ben@bluladder.com" }, {
        email: "someone@else.com",
      }],
    }),
    { contact: { phone: "+14692150144", phoneConfirmed: true } } as any,
    {},
  );
  assertEquals(res, null);
});

Deno.test("unconfirmed phone never triggers the on-file phone lookup", async () => {
  const reads: string[] = [];
  const email = await resolveQuoteRecipientEmail(
    sb({ phoneRows: [{ email: "ben@bluladder.com" }], reads }),
    { contact: { phone: "+14692150144", phoneConfirmed: false } } as any,
    {},
  );
  assertEquals(email, null);
  assertEquals(reads.includes("customers:by_phone"), false);
});
