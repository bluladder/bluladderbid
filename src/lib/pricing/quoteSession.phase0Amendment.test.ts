import { describe, expect, it } from "vitest";
import {
  mergeFields,
  nextQuestion,
  sessionInputsKey,
  type QuoteSession,
} from "../../../supabase/functions/_shared/quoteSession";

const empty = (): QuoteSession => ({
  id: "phase0-test",
  channel: "web",
  conversationIds: [],
  fields: {},
  fieldStatus: {},
  requiredRemaining: [],
  quoteStatus: "none",
  bookingReady: false,
});

describe("Phase 0 amendment — quote-session contract consumption", () => {
  it("derives no-screen provenance instead of accepting an independent write", () => {
    let session = mergeFields(empty(), { screenProfile: "no_screens" }, { markDefaulted: ["screenProfile"] });
    expect(session.fields.screenProfileProvenance).toBe("defaulted");

    session = mergeFields(session, { screenProfileProvenance: "verified" });
    expect(session.fields.screenProfileProvenance).toBe("defaulted");

    session = mergeFields(session, { screenProfile: "standard_removable" }, { markVerified: ["screenProfile"] });
    expect(session.fields.screenProfileProvenance).toBe("verified");
  });

  it("stores canonical answer provenance and lets explicit answers override defaults", () => {
    let session = mergeFields(empty(), { condition: "maintenance" }, { markDefaulted: ["condition"] });
    expect(session.fields.answerProvenance?.condition).toBe("approved_business_default");
    session = mergeFields(session, { condition: "heavy" });
    expect(session.fields.answerProvenance?.condition).toBe("explicitly_selected");
    session = mergeFields(session, { squareFootage: 2400 }, { markCustomerEstimate: ["squareFootage"] });
    expect(session.fields.answerProvenance?.squareFootage).toBe("customer_estimate");
  });

  it("includes screen-profile provenance in canonical quote cache identity", () => {
    const fields = {
      services: ["windowCleaning"],
      screenProfile: "no_screens" as const,
    };
    expect(sessionInputsKey({ ...fields, screenProfileProvenance: "captured" }))
      .not.toBe(
        sessionInputsKey({ ...fields, screenProfileProvenance: "defaulted" }),
      );
  });

  it("selects the missing exact drain count for an opted-in gutter add-on", () => {
    const session: QuoteSession = {
      ...empty(),
      fields: {
        services: ["gutterCleaning"],
        squareFootage: 2000,
        stories: 1,
        gutterAddons: { undergroundDrains: { enabled: true } },
      },
    };
    expect(nextQuestion(session)).toMatchObject({
      readyToPrice: false,
      nextField: "gutterUndergroundDrainCount",
    });
  });

  it("selects the pricing method only after a patio add-on is chosen", () => {
    const session: QuoteSession = {
      ...empty(),
      fields: {
        services: ["houseWash"],
        squareFootage: 2000,
        stories: 1,
        enclosedPatioProfile: "none",
        houseWashPatios: { frontSelected: true },
      },
    };
    expect(nextQuestion(session)).toMatchObject({
      readyToPrice: false,
      nextField: "houseWashPatioPricingMethod",
    });
  });
});
