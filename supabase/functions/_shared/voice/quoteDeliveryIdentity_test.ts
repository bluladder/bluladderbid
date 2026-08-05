import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildVoiceGeneratedQuoteDeliveryIdentity,
  buildVoiceGeneratedQuoteFingerprint,
  isVoiceGeneratedQuoteDeliveryKey,
} from "./quoteDeliveryIdentity.ts";

const quote = {
  inputsKey: "canonical-inputs-v3",
  engineVersion: "engine-7",
  pricingVersion: 12,
  taxPolicyVersion: "tax-2",
  durationVersion: "duration-4",
  total: 216.5,
  serviceSubtotal: 200,
  estimatedTax: 16.5,
  estimatedDurationMinutes: 180,
  promotionId: "promo-2026",
  discountCode: "VOICE10",
  lineItems: [{ key: "window_cleaning", amount: 200 }],
};

Deno.test("generated quote delivery identity binds every authority dimension without PII", async () => {
  const fingerprint = await buildVoiceGeneratedQuoteFingerprint(quote);
  const first = await buildVoiceGeneratedQuoteDeliveryIdentity({
    organizationId: "org-a",
    conversationId: "conversation-a",
    quoteSessionId: "session-a",
    quoteFingerprint: fingerprint,
    recipientE164: "+14692579263",
  });
  const replay = await buildVoiceGeneratedQuoteDeliveryIdentity({
    organizationId: "org-a",
    conversationId: "conversation-a",
    quoteSessionId: "session-a",
    quoteFingerprint: fingerprint,
    recipientE164: "+14692579263",
  });
  assertEquals(replay, first);
  assert(isVoiceGeneratedQuoteDeliveryKey(first.key));
  assertStringIncludes(first.key, "voice_generated_quote:sms:");
  assert(!first.key.includes("4692579263"));
  assert(!first.recipientHash.includes("4692579263"));
});

Deno.test("changed quote or lineage cannot reuse generated delivery authority", async () => {
  const fingerprint = await buildVoiceGeneratedQuoteFingerprint(quote);
  const changedFingerprint = await buildVoiceGeneratedQuoteFingerprint({
    ...quote,
    total: 227.33,
  });
  assertNotEquals(changedFingerprint, fingerprint);
  assertNotEquals(
    await buildVoiceGeneratedQuoteFingerprint({
      ...quote,
      promotionId: "promo-2026-b",
    }),
    fingerprint,
  );
  assertEquals(
    await buildVoiceGeneratedQuoteFingerprint({
      ...quote,
      lineItems: [{ amount: 200, key: "window_cleaning" }],
    }),
    fingerprint,
  );

  const base = {
    organizationId: "org-a",
    conversationId: "conversation-a",
    quoteSessionId: "session-a",
    quoteFingerprint: fingerprint,
    recipientE164: "+14692579263",
  };
  const original = await buildVoiceGeneratedQuoteDeliveryIdentity(base);
  for (
    const changed of [
      { ...base, organizationId: "org-b" },
      { ...base, conversationId: "conversation-b" },
      { ...base, quoteSessionId: "session-b" },
      { ...base, quoteFingerprint: changedFingerprint },
      { ...base, recipientE164: "+12145550199" },
    ]
  ) {
    const next = await buildVoiceGeneratedQuoteDeliveryIdentity(changed);
    assertNotEquals(next.key, original.key);
  }
});

Deno.test("only exact generated quote SMS keys are trusted", () => {
  assertEquals(isVoiceGeneratedQuoteDeliveryKey(null), false);
  assertEquals(
    isVoiceGeneratedQuoteDeliveryKey("voice_generated_quote:sms:*"),
    false,
  );
  assertEquals(
    isVoiceGeneratedQuoteDeliveryKey(
      "voice_generated_quote:email:12345678-1234-5123-8123-123456789abc",
    ),
    false,
  );
  assertEquals(
    isVoiceGeneratedQuoteDeliveryKey(
      "voice_generated_quote:sms:12345678-1234-4123-8123-123456789abc",
    ),
    false,
  );
});
