// Runtime-neutral tests. Run via vitest (already in the project) — the file is
// deliberately framework-free and imports no runtime-specific modules.
import { describe, it, expect } from "vitest";
import {
  RESIDENTIAL_INTAKE_MANIFEST,
  RESIDENTIAL_INTAKE_BY_ID,
  RESIDENTIAL_INTAKE_PRIORITY,
  fieldsForEngineMissing,
  nextResidentialQuestion,
} from "./residentialQuoteManifest";

describe("residentialQuoteManifest", () => {
  it("puts contact-first fields ahead of pricing fields", () => {
    const nameIdx = RESIDENTIAL_INTAKE_PRIORITY.indexOf("contact_name");
    const phoneIdx = RESIDENTIAL_INTAKE_PRIORITY.indexOf("contact_phone");
    const sqftIdx = RESIDENTIAL_INTAKE_PRIORITY.indexOf("squareFootage");
    expect(nameIdx).toBeLessThan(phoneIdx);
    expect(phoneIdx).toBeLessThan(sqftIdx);
  });

  it("email comes after pricing but before address", () => {
    const sqftIdx = RESIDENTIAL_INTAKE_PRIORITY.indexOf("squareFootage");
    const emailIdx = RESIDENTIAL_INTAKE_PRIORITY.indexOf("contact_email");
    const addrIdx = RESIDENTIAL_INTAKE_PRIORITY.indexOf("address");
    expect(sqftIdx).toBeLessThan(emailIdx);
    expect(emailIdx).toBeLessThan(addrIdx);
  });

  it("square footage prompt uses the canonical wording the owner requires", () => {
    expect(RESIDENTIAL_INTAKE_BY_ID.squareFootage.prompt).toBe(
      "How many square feet is your home?",
    );
  });

  it("every manifest entry states a business purpose", () => {
    for (const spec of RESIDENTIAL_INTAKE_MANIFEST) {
      expect(spec.purpose.length).toBeGreaterThan(10);
      expect(spec.prompt.endsWith("?")).toBe(true);
    }
  });

  it("fieldsForEngineMissing translates known tokens and ignores unknown", () => {
    expect(fieldsForEngineMissing(["squareFootage", "stories", "bogus"])).toEqual([
      "squareFootage",
      "stories",
    ]);
    expect(fieldsForEngineMissing([])).toEqual([]);
  });

  it("nextResidentialQuestion asks name first when nothing captured", () => {
    const q = nextResidentialQuestion({ captured: [], engineMissing: ["squareFootage"] });
    expect(q?.id).toBe("contact_name");
  });

  it("nextResidentialQuestion asks phone once name is captured", () => {
    const q = nextResidentialQuestion({
      captured: ["contact_name"],
      engineMissing: ["squareFootage", "stories"],
    });
    expect(q?.id).toBe("contact_phone");
  });

  it("nextResidentialQuestion never asks a previously captured field", () => {
    const q = nextResidentialQuestion({
      captured: ["contact_name", "contact_phone", "squareFootage"],
      engineMissing: ["squareFootage", "stories"],
    });
    expect(q?.id).toBe("stories");
  });

  it("nextResidentialQuestion respects engine-authority: only asks pricing fields the engine flagged", () => {
    // Engine says squareFootage is sufficient (no stories missing). We do NOT
    // ask stories, even though it exists in the manifest.
    const q = nextResidentialQuestion({
      captured: ["contact_name", "contact_phone"],
      engineMissing: ["squareFootage"],
    });
    expect(q?.id).toBe("squareFootage");

    const done = nextResidentialQuestion({
      captured: ["contact_name", "contact_phone", "squareFootage"],
      engineMissing: [],
    });
    expect(done).toBeNull();
  });

  it("city is NOT required for a residential price (owner rule)", () => {
    // City is in the manifest for later serviceability but never surfaces as a
    // pricing gate. It only appears when explicitly injected via additionallyRequired.
    const q = nextResidentialQuestion({
      captured: ["contact_name", "contact_phone", "squareFootage", "stories"],
      engineMissing: [],
    });
    expect(q).toBeNull();
  });

  it("additionallyRequired injects booking-stage fields after price is spoken", () => {
    const q = nextResidentialQuestion({
      captured: ["contact_name", "contact_phone", "squareFootage", "stories"],
      engineMissing: [],
      additionallyRequired: ["contact_email", "address"],
    });
    expect(q?.id).toBe("contact_email");
  });
});