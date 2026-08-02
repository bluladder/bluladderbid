import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCanonicalVoiceBookingPayload,
  type CanonicalVoiceBookingCommandInput,
  canonicalVoiceBookingResultMatches,
  prepareVoiceBooking,
  resolveVoiceBookingMode,
  type TrustedVoiceCallContext,
  validateCanonicalVoiceBookingPayload,
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

Deno.test("voice mode resolves live only for the explicit live value", () => {
  assertEquals(resolveVoiceBookingMode(undefined), "disabled");
  // Live voice booking is intentionally enabled for the allowlisted lane.
  assertEquals(resolveVoiceBookingMode("live"), "live");
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

const canonicalCommand: CanonicalVoiceBookingCommandInput = {
  voiceSessionToken: "voice-session-verified-1",
  organizationId: "b1addf00-0000-4000-8000-000000000001",
  conversationId: "conversation-verified-1",
  customerId: "customer-verified-1",
  propertyId: "property-verified-1",
  customer: {
    firstName: "Benjamin",
    lastName: "Millen",
    email: "ben@example.com",
    phone: "+14695550144",
  },
  serviceAddress: "5612 Binbranch Ln, McKinney, TX 75071",
  quoteIdentity: {
    quoteSessionId: "quote-session-1",
    quoteId: "quote-1",
    inputsKey: "quote-fingerprint-1",
    pricingVersion: 7,
    engineVersion: "pricing-v7",
    durationVersion: "duration-v3",
    taxPolicyVersion: "tax-v2",
  },
  bookingInputsKey: "booking-inputs-1",
  quote: {
    status: "firm",
    bookableServiceKeys: ["gutter_cleaning"],
    estimatedDurationMinutes: 60,
    durationSource: "deterministic_duration_engine",
    durationVersion: "duration-v3",
    jobberLineItems: [{
      name: "Gutter Cleaning",
      description: "Canonical gutter service",
      unitPrice: 260,
    }],
    serviceSubtotal: 260,
    priceAdjustments: [{
      key: "bundle",
      label: "Bundle discount",
      kind: "discount",
      amount: 20,
    }],
    discount: {
      code: "SAVE10",
      type: "fixed",
      value: 10,
      amount: 10,
    },
    taxableSubtotal: 230,
    estimatedTax: 19.55,
    total: 230,
    estimatedTotal: 249.55,
    taxRate: 0.085,
    taxLabel: "Estimated sales tax",
    promotion: null,
  },
  selectedServiceIds: ["gutterCleaning"],
  homeDetails: { squareFootage: 2500, stories: 1 },
  additionalServices: { gutterCleaning: true },
  offer: {
    offerVersion: "offer-1",
    offerExpiresAt: "2099-01-01T01:00:00.000Z",
    slotId: "slot-1",
    scheduledStart: "2099-01-01T00:00:00.000Z",
    scheduledEnd: "2099-01-01T01:00:00.000Z",
    timezone: "America/Chicago",
    durationMinutes: 60,
    technicianId: "technician-1",
    isTeamJob: false,
    teamTechnicianIds: [],
  },
};

Deno.test("canonical voice handoff carries verified identity, services, tax, discount, duration and offer", async () => {
  const result = await buildCanonicalVoiceBookingPayload(canonicalCommand, 0);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const payload = result.payload;
  assertEquals(payload.customer, {
    firstName: "Benjamin",
    lastName: "Millen",
    email: "ben@example.com",
    phone: "+14695550144",
    address: "5612 Binbranch Ln, McKinney, TX 75071",
  });
  assertEquals(payload.services, [{
    name: "Gutter Cleaning",
    description: "Canonical gutter service",
    price: 260,
  }]);
  assertEquals(payload.subtotal, 260);
  assertEquals(payload.taxableSubtotal, 230);
  assertEquals(payload.estimatedTax, 19.55);
  assertEquals(payload.preTaxTotal, 230);
  assertEquals(payload.total, 249.55);
  assertEquals(payload.discountAmount, 10);
  assertEquals(payload.durationMinutes, 60);
  assertEquals(payload.voiceContract.quoteFingerprint, "quote-fingerprint-1");
  assertEquals(payload.voiceContract.offerVersion, "offer-1");
  assertNotEquals(
    payload.voiceContract.voiceSessionFingerprint,
    canonicalCommand.voiceSessionToken,
  );
  assertEquals(await validateCanonicalVoiceBookingPayload(payload), true);
});

Deno.test("canonical command normalizes verified contact before hashing", async () => {
  const result = await buildCanonicalVoiceBookingPayload({
    ...canonicalCommand,
    customer: {
      firstName: "  Benjamin  ",
      lastName: "  Van   Millen ",
      email: " BEN@EXAMPLE.COM ",
      phone: "(469) 555-0144",
    },
  }, 0);
  if (!result.ok) throw new Error("formatted verified contact must build");
  assertEquals(result.payload.customer, {
    firstName: "Benjamin",
    lastName: "Van Millen",
    email: "ben@example.com",
    phone: "+14695550144",
    address: "5612 Binbranch Ln, McKinney, TX 75071",
  });
  assertEquals(
    await validateCanonicalVoiceBookingPayload(result.payload),
    true,
  );
});

Deno.test("canonical command is deterministic and tampering invalidates it", async () => {
  const first = await buildCanonicalVoiceBookingPayload(canonicalCommand, 0);
  const second = await buildCanonicalVoiceBookingPayload(canonicalCommand, 0);
  if (!first.ok || !second.ok) throw new Error("fixture must build");
  assertEquals(first.payload.idempotencyKey, second.payload.idempotencyKey);
  assertEquals(
    first.payload.voiceContract.commandHash,
    second.payload.voiceContract.commandHash,
  );
  const tampered = structuredClone(first.payload);
  tampered.total += 1;
  assertEquals(await validateCanonicalVoiceBookingPayload(tampered), false);
});

Deno.test("canonical command rejects missing split names and non-authoritative duration", async () => {
  assertEquals(
    await buildCanonicalVoiceBookingPayload({
      ...canonicalCommand,
      customer: { ...canonicalCommand.customer, lastName: "" },
    }, 0),
    { ok: false, code: "identity_incomplete" },
  );
  assertEquals(
    await buildCanonicalVoiceBookingPayload({
      ...canonicalCommand,
      offer: { ...canonicalCommand.offer, durationMinutes: 90 },
    }, 0),
    { ok: false, code: "slot_duration_mismatch" },
  );
});

Deno.test("promotion context remains explicit and part of the command hash", async () => {
  const withPromotion = {
    ...canonicalCommand,
    quote: {
      ...canonicalCommand.quote,
      promotion: {
        id: "window-99",
        version: 3,
        flatPrice: 99,
        maxWindows: 20,
        windowCount: 12,
        prepInstructions: "Remove screens before arrival.",
      },
    },
  };
  const promoted = await buildCanonicalVoiceBookingPayload(withPromotion, 0);
  const ordinary = await buildCanonicalVoiceBookingPayload(canonicalCommand, 0);
  if (!promoted.ok || !ordinary.ok) throw new Error("fixtures must build");
  assertEquals(promoted.payload.promotion, {
    id: "window-99",
    windowCount: 12,
  });
  assertNotEquals(
    promoted.payload.voiceContract.commandHash,
    ordinary.payload.voiceContract.commandHash,
  );
});

Deno.test("spoken success requires every provider and local lineage echo", async () => {
  const built = await buildCanonicalVoiceBookingPayload(canonicalCommand, 0);
  if (!built.ok) throw new Error("fixture must build");
  const contract = built.payload.voiceContract;
  const success = {
    success: true,
    providerStatus: "accepted",
    localStatus: "persisted",
    jobberJobId: "job-1",
    jobberVisitId: "visit-1",
    bookingId: "booking-1",
    organizationId: contract.organizationId,
    customerId: contract.customerId,
    propertyId: contract.propertyId,
    quoteFingerprint: contract.quoteFingerprint,
    bookingInputsKey: contract.bookingInputsKey,
    offerVersion: contract.offerVersion,
    slotId: contract.slotId,
    scheduledStart: contract.scheduledStart,
    scheduledEnd: contract.scheduledEnd,
    durationMinutes: contract.durationMinutes,
    idempotencyKey: contract.idempotencyKey,
    commandHash: contract.commandHash,
    subtotal: built.payload.subtotal,
    estimatedTax: built.payload.estimatedTax,
    total: built.payload.total,
  };
  assertEquals(canonicalVoiceBookingResultMatches(contract, success), true);
  for (
    const field of [
      "jobberJobId",
      "jobberVisitId",
      "bookingId",
      "organizationId",
      "customerId",
      "propertyId",
      "quoteFingerprint",
      "bookingInputsKey",
      "offerVersion",
      "slotId",
      "scheduledStart",
      "scheduledEnd",
      "durationMinutes",
      "idempotencyKey",
      "commandHash",
      "subtotal",
      "estimatedTax",
      "total",
    ]
  ) {
    const malformed = { ...success, [field]: null };
    assertEquals(
      canonicalVoiceBookingResultMatches(contract, malformed),
      false,
      `result unexpectedly accepted without ${field}`,
    );
  }
  assertEquals(
    canonicalVoiceBookingResultMatches(contract, {
      ...success,
      localStatus: "failed",
    }),
    false,
  );
  assertEquals(
    canonicalVoiceBookingResultMatches(contract, {
      jobberVisitId: "visit-1",
      bookingId: "booking-1",
    }),
    false,
  );
});
