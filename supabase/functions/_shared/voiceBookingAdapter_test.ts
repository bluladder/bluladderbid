import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  prepareVoiceBooking,
  resolveVoiceBookingMode,
  type TrustedVoiceCallContext,
  type VoiceBookingEvidence,
} from "./voiceBookingAdapter.ts";

const context: TrustedVoiceCallContext = {
  provider: "vapi",
  providerCallId: "call-1",
  conversationId: "conversation-1",
  authenticatedProviderEvent: true,
  providerResourceTrusted: true,
  organizationResolution: { status: "resolved", organizationId: "org-dfw" },
};
const evidence: VoiceBookingEvidence = {
  explicitConfirmation: true,
  serviceAddress: "123 Main St, Dallas, TX 75201",
  serviceAreaStatus: "eligible",
  quoteSignature: "quote-v1",
  offerVersion: "offer-v1",
  offerExpiresAt: "2099-01-01T00:00:00.000Z",
  slotId: "slot-1",
};

Deno.test("voice mode has no live configuration value", () => {
  assertEquals(resolveVoiceBookingMode(undefined), "disabled");
  assertEquals(resolveVoiceBookingMode("live"), "disabled");
  assertEquals(resolveVoiceBookingMode("true"), "disabled");
  assertEquals(resolveVoiceBookingMode("dry_run"), "dry_run");
});

Deno.test("trusted eligible evidence produces deterministic no-write receipt", async () => {
  const first = await prepareVoiceBooking("dry_run", context, evidence);
  const second = await prepareVoiceBooking("dry_run", context, evidence);
  assertEquals(first, second);
  if (first.status === "dry_run_ready") {
    assertEquals(first.noProviderWrite, true);
  }
});

Deno.test("caller-controlled trust or organization cannot bypass adapter", async () => {
  assertEquals(
    await prepareVoiceBooking("dry_run", {
      ...context,
      authenticatedProviderEvent: false,
    }, evidence),
    { status: "blocked", code: "untrusted_call" },
  );
  assertEquals(
    await prepareVoiceBooking("dry_run", {
      ...context,
      organizationResolution: { status: "conflict" },
    }, evidence),
    { status: "blocked", code: "organization_conflict" },
  );
});

Deno.test("Oregon, unknown address, expired offer, and ambiguous confirmation fail closed", async () => {
  for (
    const [patch, code] of [
      [{ serviceAreaStatus: "ineligible" }, "unsupported_territory"],
      [{ serviceAreaStatus: "ambiguous" }, "address_unverified"],
      [{ offerExpiresAt: "2020-01-01T00:00:00.000Z" }, "offer_expired"],
      [{ offerExpiresAt: "not-a-date" }, "offer_expired"],
      [{ explicitConfirmation: false }, "confirmation_missing"],
    ] as const
  ) {
    const result = await prepareVoiceBooking("dry_run", context, {
      ...evidence,
      ...patch,
    });
    assertEquals(result, { status: "blocked", code });
  }
});

Deno.test("corrections change the command hash instead of duplicating the prior draft", async () => {
  const original = await prepareVoiceBooking("dry_run", context, evidence);
  const corrected = await prepareVoiceBooking("dry_run", context, {
    ...evidence,
    serviceAddress: "124 Main St, Dallas, TX 75201",
  });
  if (
    original.status === "dry_run_ready" && corrected.status === "dry_run_ready"
  ) {
    assertNotEquals(original.commandHash, corrected.commandHash);
    assertNotEquals(original.receiptId, corrected.receiptId);
  }
});
