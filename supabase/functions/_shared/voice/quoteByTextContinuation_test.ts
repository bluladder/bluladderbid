// Behavioral tests for the quote-by-text cross-turn continuation.
//
// These simulate the orchestrator's ordering exactly: cancellation first, then
// deterministic capture of this turn's answer, then (only if unblocked) the
// canonical save-quote → send-sms delivery. Every case asserts the number of
// upstream calls, so a regression that loops on the same blocker — or that
// calls save-quote before validating the address — fails here.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyQuoteByTextCancellation,
  parseSpokenAddressCandidate,
  parseSpokenName,
  planQuoteByTextCancellation,
  planQuoteByTextResponse,
  resolveQuoteByTextContinuation,
} from "./quoteByText.ts";

interface Facts {
  email?: string | null;
  name?: string | null;
  address?: string | null;
  addressEligible?: boolean;
  phone?: string | null;
  phoneConfirmed?: boolean;
  missingField: "phone" | "name" | "address" | "email" | null;
}

interface Calls {
  validate: string[];
  save: number;
  sms: number;
}

/** Mirror of the orchestrator rail ordering, with counted upstream calls. */
async function simulateTurn(
  facts: Facts,
  userMessage: string,
  opts: { addressStatus?: string; deliverOk?: boolean } = {},
) {
  const calls: Calls = { validate: [], save: 0, sms: 0 };
  const pending = facts.missingField !== null;

  if (pending && classifyQuoteByTextCancellation(userMessage)) {
    return { calls, plan: planQuoteByTextCancellation(), facts };
  }

  const next: Facts = { ...facts };
  if (pending) {
    const continuation = await resolveQuoteByTextContinuation({
      missingField: facts.missingField,
      userMessage,
      phoneConfirmed: facts.phoneConfirmed === true,
      validateAddress: (address: string) => {
        calls.validate.push(address);
        const status = opts.addressStatus ?? "eligible";
        return Promise.resolve({
          status,
          formattedAddress: `${address} (verified)`,
        });
      },
    });
    if (continuation.kind === "contact") {
      if (continuation.email) next.email = continuation.email;
      if (continuation.name) next.name = continuation.name;
    } else if (continuation.kind === "validated_address") {
      next.address = (continuation.result as { formattedAddress: string })
        .formattedAddress;
      next.addressEligible = continuation.eligible;
    }
    const blocked = continuation.kind === "reask"
      ? continuation.plan
      : continuation.kind === "validated_address" && !continuation.eligible
      ? continuation.plan
      : null;
    if (blocked) return { calls, plan: blocked, facts: next };
  }

  const plan = await planQuoteByTextResponse({
    quoteIsFirm: true,
    total: 612,
    name: next.name ?? null,
    phone: next.phone ?? null,
    phoneIsFullE164: /^\+1\d{10}$/.test(next.phone ?? ""),
    phoneConfirmed: next.phoneConfirmed === true,
    address: next.address ?? null,
    addressEligible: next.addressEligible === true,
    deliver: () => {
      // Canonical order inside the delivery bridge: save-quote then send-sms.
      calls.save += 1;
      if (!next.email) {
        return Promise.resolve({ ok: false, reason: "email_unavailable" });
      }
      calls.sms += 1;
      return Promise.resolve({ ok: opts.deliverOk !== false });
    },
  });
  return { calls, plan, facts: next };
}

const READY: Facts = {
  name: "Ben",
  address: "123 Main St, Frisco TX 75034",
  addressEligible: true,
  phone: "+14692150144",
  phoneConfirmed: true,
  missingField: "email",
};

Deno.test("literal email continuation runs one save-quote then one send-sms", async () => {
  const r = await simulateTurn(READY, "ben@bluladder.com");
  assertEquals(r.facts.email, "ben@bluladder.com");
  assertEquals(r.calls.save, 1);
  assertEquals(r.calls.sms, 1);
  assertEquals(r.plan.sent, true);
});

Deno.test("ASR spoken email continuation runs one save-quote then one send-sms", async () => {
  const r = await simulateTurn(READY, "it's ben at bluladder dot com");
  assertEquals(r.facts.email, "ben@bluladder.com");
  assertEquals(r.calls.save, 1);
  assertEquals(r.calls.sms, 1);
  assertEquals(r.plan.sent, true);
});

Deno.test("malformed email re-asks with zero upstream calls", async () => {
  const r = await simulateTurn(READY, "uh, hold on, let me think");
  assertEquals(r.calls, { validate: [], save: 0, sms: 0 });
  assertEquals(r.plan.sent, false);
  assertEquals(r.plan.missingField, "email");
});

Deno.test("two ambiguous emails re-ask with zero upstream calls", async () => {
  const r = await simulateTurn(
    READY,
    "ben at bluladder dot com or ben at gmail dot com",
  );
  assertEquals(r.calls, { validate: [], save: 0, sms: 0 });
  assertEquals(r.plan.missingField, "email");
  assertEquals(r.facts.email ?? null, null);
});

Deno.test("name continuation captures the name and resumes delivery", async () => {
  const r = await simulateTurn(
    { ...READY, name: null, email: "ben@bluladder.com", missingField: "name" },
    "my name is Ben Millen",
  );
  assertEquals(r.facts.name, "Ben Millen");
  assertEquals(r.calls.save, 1);
  assertEquals(r.calls.sms, 1);
  assertEquals(r.plan.sent, true);
});

Deno.test("non-name answer re-asks with zero upstream calls", async () => {
  const r = await simulateTurn(
    { ...READY, name: null, email: "ben@bluladder.com", missingField: "name" },
    "can you just text it already",
  );
  assertEquals(r.calls, { validate: [], save: 0, sms: 0 });
  assertEquals(r.plan.missingField, "name");
});

Deno.test("eligible address continuation validates first, then save→SMS", async () => {
  const r = await simulateTurn(
    {
      ...READY,
      email: "ben@bluladder.com",
      address: null,
      addressEligible: false,
      missingField: "address",
    },
    "it's 4501 Legacy Drive, Plano Texas 75024",
  );
  assertEquals(r.calls.validate, ["4501 Legacy Drive, Plano Texas 75024"]);
  assertEquals(r.calls.save, 1);
  assertEquals(r.calls.sms, 1);
  assertEquals(r.plan.sent, true);
});

for (
  const status of ["incomplete_address", "ineligible", "manual_review_required"]
) {
  Deno.test(`${status} address keeps pending with zero save/SMS`, async () => {
    const r = await simulateTurn(
      {
        ...READY,
        email: "ben@bluladder.com",
        address: null,
        addressEligible: false,
        missingField: "address",
      },
      "4501 Legacy Drive",
      { addressStatus: status },
    );
    assertEquals(r.calls.save, 0);
    assertEquals(r.calls.sms, 0);
    assertEquals(r.calls.validate.length, 1);
    assertEquals(r.plan.missingField, "address");
    assertEquals(r.plan.sent, false);
  });
}

Deno.test("unparseable address answer never calls validate_service_area", async () => {
  const r = await simulateTurn(
    {
      ...READY,
      email: "ben@bluladder.com",
      address: null,
      addressEligible: false,
      missingField: "address",
    },
    "somewhere in Frisco",
  );
  assertEquals(r.calls, { validate: [], save: 0, sms: 0 });
  assertEquals(r.plan.missingField, "address");
});

Deno.test("cancellation wins before any parsing or upstream call", async () => {
  const r = await simulateTurn(READY, "never mind, don't text it");
  assertEquals(r.calls, { validate: [], save: 0, sms: 0 });
  assertEquals(r.plan.outcome, "cancelled");
  assertEquals(r.facts.email ?? null, null);
});

Deno.test("full but unconfirmed phone stays pending with zero upstream calls", async () => {
  const r = await simulateTurn(
    {
      ...READY,
      email: "ben@bluladder.com",
      phoneConfirmed: false,
      missingField: "phone",
    },
    "it's four six nine two one five zero one four four",
  );
  assertEquals(r.calls, { validate: [], save: 0, sms: 0 });
  assertEquals(r.plan.missingField, "phone");
  assertEquals(r.plan.sent, false);
});

Deno.test("planQuoteByTextResponse treats unconfirmed phone as a phone question", async () => {
  let delivered = 0;
  const plan = await planQuoteByTextResponse({
    quoteIsFirm: true,
    total: 500,
    name: "Ben",
    phone: "+14692150144",
    phoneIsFullE164: true,
    phoneConfirmed: false,
    address: "123 Main St",
    addressEligible: true,
    deliver: () => {
      delivered += 1;
      return Promise.resolve({ ok: true });
    },
  });
  assertEquals(delivered, 0);
  assertEquals(plan.outcome, "not_sent_missing_phone");
  assertEquals(plan.missingField, "phone");
});

Deno.test("parsers reject the wrong shapes", () => {
  assertEquals(parseSpokenName("ben@bluladder.com"), null);
  assertEquals(parseSpokenName("123 Main Street"), null);
  assertEquals(parseSpokenName("yes"), null);
  assertEquals(parseSpokenName("Ben"), "Ben");
  assertEquals(parseSpokenAddressCandidate("Frisco"), null);
  assertEquals(parseSpokenAddressCandidate("ben@bluladder.com"), null);
  assertEquals(
    parseSpokenAddressCandidate("the address is 123 Main St Frisco TX 75034"),
    "123 Main St Frisco TX 75034",
  );
});
