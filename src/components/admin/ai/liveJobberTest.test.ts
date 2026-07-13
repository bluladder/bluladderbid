import { describe, it, expect } from "vitest";
import {
  APPROVED_TEST_EMAIL, APPROVED_TEST_PHONE, buildAuthKey, canAuthorize,
  deriveAuthStatus, evaluatePreconditions, isProtectedTestConversation,
  normalizePhone, parseAuthorizedResult, selectedSlotBelongs, shouldShowPanel,
  type ConvoLike, type TestIdentityLike,
} from "./liveJobberTest";

const CONV_ID = "11111111-1111-1111-1111-111111111111";

const protectedIdentity: TestIdentityLike = {
  email: APPROVED_TEST_EMAIL,
  phone: APPROVED_TEST_PHONE,
  active: true,
  protected: true,
  live_jobber_test_enabled: false,
};

function readyConvo(overrides: Partial<ConvoLike> = {}): ConvoLike {
  return {
    id: CONV_ID,
    prospect_email: "BLMillen@gmail.com",
    prospect_phone: "(469) 215-0144",
    conversation_state: "awaiting_booking_confirmation",
    service_area_status: "eligible",
    selected_slot_id: "slot_1",
    facts: {
      quote: { status: "firm", firm: true, total: 412, pricingVersion: 1, engineVersion: "1.0.0" },
      availability: { offeredSlotIds: ["slot_1", "slot_2", "slot_3"] },
      selectedSlotId: "slot_1",
    },
    ...overrides,
  };
}

describe("identity matching", () => {
  it("matches the protected identity by normalized email (case-insensitive)", () => {
    expect(isProtectedTestConversation(readyConvo(), protectedIdentity)).toBe(true);
  });

  it("matches by normalized phone even with different formatting", () => {
    const convo = readyConvo({ prospect_email: "someoneelse@example.com", prospect_phone: "+1 469-215-0144" });
    expect(isProtectedTestConversation(convo, protectedIdentity)).toBe(true);
  });

  it("does not match a non-test conversation", () => {
    const convo = readyConvo({ prospect_email: "random@example.com", prospect_phone: "+15550001111" });
    expect(isProtectedTestConversation(convo, protectedIdentity)).toBe(false);
  });

  it("never matches when the identity is not protected", () => {
    expect(isProtectedTestConversation(readyConvo(), { ...protectedIdentity, protected: false })).toBe(false);
  });

  it("normalizes phones consistently", () => {
    expect(normalizePhone("(469) 215-0144")).toBe("+14692150144");
    expect(normalizePhone("469-215-0144")).toBe("+14692150144");
    expect(normalizePhone("+14692150144")).toBe("+14692150144");
  });
});

describe("authKey scoping", () => {
  it("derives the exact authKey the chat booking tool uses", () => {
    expect(buildAuthKey(CONV_ID, "slot_1")).toBe(`chat|${CONV_ID}|slot_1`);
  });
});

describe("visibility", () => {
  it("shows the panel only for operations admins on the protected identity with a slot", () => {
    expect(shouldShowPanel({ isOperationsAdmin: true, convo: readyConvo(), identity: protectedIdentity })).toBe(true);
  });

  it("hides the panel for non-admins", () => {
    expect(shouldShowPanel({ isOperationsAdmin: false, convo: readyConvo(), identity: protectedIdentity })).toBe(false);
  });

  it("hides the panel for a non-test conversation", () => {
    const convo = readyConvo({ prospect_email: "random@example.com", prospect_phone: "+15550001111" });
    expect(shouldShowPanel({ isOperationsAdmin: true, convo, identity: protectedIdentity })).toBe(false);
  });

  it("hides the panel when there is no selected slot", () => {
    const convo = readyConvo({ selected_slot_id: null, facts: { ...readyConvo().facts!, selectedSlotId: null } });
    expect(shouldShowPanel({ isOperationsAdmin: true, convo, identity: protectedIdentity })).toBe(false);
  });
});

describe("preconditions & authorize gating", () => {
  it("passes every precondition for a fully-ready conversation", () => {
    const pre = evaluatePreconditions({
      isOperationsAdmin: true, convo: readyConvo(), identity: protectedIdentity,
      globalSuppressionOn: false, authStatus: "not_authorized",
    });
    expect(pre.every((p) => p.ok)).toBe(true);
    expect(canAuthorize(pre, "not_authorized")).toBe(true);
  });

  it("blocks authorize when the address is not eligible", () => {
    const pre = evaluatePreconditions({
      isOperationsAdmin: true, convo: readyConvo({ service_area_status: "manual_review_required" }),
      identity: protectedIdentity, globalSuppressionOn: false, authStatus: "not_authorized",
    });
    expect(canAuthorize(pre, "not_authorized")).toBe(false);
  });

  it("blocks authorize when the quote is not firm", () => {
    const convo = readyConvo();
    convo.facts!.quote = { status: "estimated", firm: false };
    const pre = evaluatePreconditions({
      isOperationsAdmin: true, convo, identity: protectedIdentity,
      globalSuppressionOn: false, authStatus: "not_authorized",
    });
    expect(canAuthorize(pre, "not_authorized")).toBe(false);
  });

  it("blocks authorize when global suppression is ON", () => {
    const pre = evaluatePreconditions({
      isOperationsAdmin: true, convo: readyConvo(), identity: protectedIdentity,
      globalSuppressionOn: true, authStatus: "not_authorized",
    });
    expect(canAuthorize(pre, "not_authorized")).toBe(false);
  });

  it("blocks authorize when permanent suppression identity is inactive", () => {
    const pre = evaluatePreconditions({
      isOperationsAdmin: true, convo: readyConvo(), identity: { ...protectedIdentity, active: false },
      globalSuppressionOn: false, authStatus: "not_authorized",
    });
    expect(canAuthorize(pre, "not_authorized")).toBe(false);
  });

  it("blocks a second authorize when one already exists (no unresolved test booking)", () => {
    const pre = evaluatePreconditions({
      isOperationsAdmin: true, convo: readyConvo(), identity: protectedIdentity,
      globalSuppressionOn: false, authStatus: "authorized",
    });
    expect(canAuthorize(pre, "authorized")).toBe(false);
  });

  it("requires the selected slot to belong to the current offer", () => {
    const convo = readyConvo({ selected_slot_id: "slot_9" });
    expect(selectedSlotBelongs(convo)).toBe(false);
  });
});

describe("auth status derivation", () => {
  const base = () => ({ ...protectedIdentity, live_jobber_test_enabled: true });
  const inFuture = new Date(Date.now() + 10 * 60_000).toISOString();
  const inPast = new Date(Date.now() - 10 * 60_000).toISOString();

  it("not_authorized when disabled", () => {
    expect(deriveAuthStatus({ ...protectedIdentity, live_jobber_test_enabled: false })).toBe("not_authorized");
  });

  it("authorized when enabled and unexpired and unconsumed", () => {
    expect(deriveAuthStatus({ ...base(), authorization_expires_at: inFuture })).toBe("authorized");
  });

  it("expired when past the expiry", () => {
    expect(deriveAuthStatus({ ...base(), authorization_expires_at: inPast })).toBe("expired");
  });

  it("consumed after a confirmed result", () => {
    expect(deriveAuthStatus({
      ...base(), authorization_expires_at: inFuture,
      authorization_consumed_at: new Date().toISOString(),
      authorized_result: { status: "confirmed", jobberVisitId: "V123" },
    })).toBe("consumed");
  });
});

describe("result parsing", () => {
  it("parses a stored authorized result", () => {
    expect(parseAuthorizedResult({ status: "confirmed", jobberVisitId: "V1", confirmedTime: "Mon 9am" }))
      .toEqual({ status: "confirmed", jobberVisitId: "V1", confirmedTime: "Mon 9am" });
  });

  it("returns null for empty results", () => {
    expect(parseAuthorizedResult(null)).toBeNull();
  });
});