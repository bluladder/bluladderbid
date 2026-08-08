// Deterministic parsing for answers to questions already selected by the
// canonical quote contract. It does not infer unasked fields or invent values.

import {
  mergeFields,
  type QuoteSession,
  type QuoteSessionFields,
} from "../quoteSession.ts";
import {
  CANONICAL_INTAKE_FIELDS,
  evaluateQuoteIntake,
} from "../salesEngine/quoteIntakeContract.ts";
import { parseSpokenEmail } from "./spokenEmail.ts";
import { parseSpokenName } from "./quoteByText.ts";
import { normalizeSpokenPhone } from "../workflow/callerIdConfirmation.ts";
import { PRICE_ASSURANCE } from "./voiceJourneyContract.ts";
import { classifyExplicitConfirmation } from "./voiceJourneyContract.ts";
import { parseSpokenQuantity } from "./spokenQuantity.ts";

export interface VoiceAnswerResult {
  accepted: boolean;
  session: QuoteSession;
  fieldId: string;
  reason?: string;
}

const FIELD_PROMPTS: Readonly<Record<string, string>> = {
  services:
    "Which service would you like priced today — window cleaning, house washing, gutter cleaning, roof cleaning, driveway cleaning, pressure washing, solar-panel cleaning, or screen repair?",
  squareFootage: "How many square feet is the home?",
  stories: "How many stories is the home — one, two, or three?",
  windowCleaningSides:
    "Would you like all the windows cleaned both inside and outside, or outside only?",
  condition:
    "Would you say the windows are regularly maintained, or heavily soiled with significant buildup?",
  roofType: "What type of roof is it?",
  roofSeverity:
    "How heavy is the roof buildup — light, moderate, extreme, or uncertain?",
  roofRiskFlags:
    "Is there any known roof damage, extreme pitch, fragile material, or unusual access?",
  advancedWindowConditionTypes:
    "Which applies: hard-water staining, small French panes, unusual ladder access, or more than one of those?",
  hardWaterAffectedWindowEquivalents:
    "How many windows have hard-water staining?",
  ladderAffectedWindowEquivalents:
    "How many windows need unusual ladder access?",
  drivewaySqft: "What is the driveway’s approximate square footage?",
  drivewaySurface:
    "What surface is the driveway — concrete, pavers, exposed aggregate, stone, asphalt, or something else?",
  pressureWashingSurface: "What surface are we cleaning?",
  pressureWashingAreas:
    "Which area should we clean, and about how many square feet is it?",
  solarPanelCount: "How many solar panels need cleaning?",
  solarAccessProfile:
    "Is this standard one- or two-story residential roof access, with no known damage or unusual access concerns?",
  screenRepairCount: "How many screens need repair?",
  screenRepairScopeType:
    "Are these standard removable screens with reusable frames, or another type?",
  promotionId: "Which configured promotion are you calling about?",
  windowCount: "How many windows are included in that request?",
  addedInteriorWindowSides:
    "How many additional interior window-sides should be cleaned?",
  omittedWindowSides: "How many window-sides should be omitted?",
  commercialLocations:
    "What is the first commercial property address or location you want included in the bid request?",
  preferredContactMethods:
    "Should the team follow up by phone, text, email, or more than one of those?",
  gutterUndergroundDrainCount:
    "How many underground drains or downspouts would you like us to clear?",
  gutterRepairNotes: "Briefly describe the other gutter repair needed.",
  gutterGuardsLinearFeet:
    "About how many linear feet of gutter guards are included?",
  houseWashPatioPricingMethod:
    "For the selected patio, should I use the standard patio option or exact square footage?",
  houseWashPatioSelections:
    "Which patio should be cleaned — front, back, or both?",
  houseWashStainType:
    "Is the staining organic buildup or rust and irrigation staining?",
  houseWashFrontPatioSqft:
    "What is the front patio’s approximate square footage?",
  houseWashBackPatioSqft:
    "What is the back patio’s approximate square footage?",
  contact_name: "May I get your first and last name for the quote?",
  contact_email:
    "What email should we use for the quote and booking confirmation?",
  contact_phone:
    "What is the best ten-digit mobile number in case we get disconnected?",
  address:
    "What is the complete service address, including the street, city, state, and five-digit ZIP code?",
  serviceAreaStatus:
    "Let me verify the service address before I check appointment times.",
};

export function promptForCanonicalField(fieldId: string): string {
  if (fieldId === "windowCleaningSides") {
    return FIELD_PROMPTS.windowCleaningSides;
  }
  const spec = CANONICAL_INTAKE_FIELDS.find((candidate) =>
    candidate.fieldId === fieldId && candidate.canonicalPrompt
  );
  return spec?.canonicalPrompt ?? FIELD_PROMPTS[fieldId] ??
    "I need one more confirmed detail before I can finish the quote.";
}

function valueAtPath(
  fields: QuoteSessionFields,
  storagePath: string,
): unknown {
  return storagePath.split(".").reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
    fields,
  );
}

const SERVICE_LABELS: Readonly<Record<string, string>> = {
  window_cleaning: "whole-home window cleaning",
  partial_window_cleaning: "partial-window cleaning",
  window_promo_99: "the configured window promotion",
  house_wash: "house washing",
  gutter_cleaning: "gutter cleaning",
  roof_cleaning: "roof cleaning",
  driveway_cleaning: "driveway cleaning",
  pressure_washing: "pressure washing",
  solar_panel_cleaning: "solar-panel cleaning",
  screen_repair: "screen repair",
  commercial_window_bid: "a commercial window-cleaning bid",
};

function customerSafeValue(fieldId: string, value: unknown): string {
  if (fieldId === "promotionId") return "the configured promotion";
  if (fieldId === "houseWashWindowBundle") {
    return value === true ? "included" : "";
  }
  if (fieldId === "services" && Array.isArray(value)) {
    return value.map((service) => String(service).replaceAll("_", " ")).join(
      " and ",
    );
  }
  if (fieldId === "windowCleaningSides" || fieldId === "enclosureWindowSides") {
    return value === "inside_and_outside"
      ? "inside and outside"
      : "outside only";
  }
  if (fieldId === "squareFootage" || fieldId.endsWith("Sqft")) {
    return `${value} square feet`;
  }
  if (fieldId === "stories") {
    return `${value} ${value === 1 ? "story" : "stories"}`;
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    return value.map(String).join(", ").replaceAll("_", " ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined && nested !== false)
      .map(([key, nested]) =>
        `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()} ${
          String(nested).replaceAll("_", " ")
        }`
      )
      .join(", ");
  }
  return String(value).replaceAll("_", " ");
}

function customerSafeFieldLabel(fieldId: string): string {
  if (fieldId === "promotionId") return "promotion";
  if (fieldId === "houseWashWindowBundle") {
    return "house-wash and window-cleaning bundle pricing";
  }
  return fieldId.replaceAll(/([A-Z])/g, " $1").toLowerCase();
}

export function canonicalPrePriceRecapFieldIds(
  fields: QuoteSessionFields,
): string[] {
  const services = evaluateQuoteIntake(
    fields as unknown as Record<string, unknown>,
  ).services;
  return CANONICAL_INTAKE_FIELDS
    .filter((spec) =>
      spec.recapRequired &&
      (spec.stage === "service_selection" || spec.stage === "pre_price") &&
      spec.category !== "not_applicable" &&
      spec.appliesToServices.some((service) => services.includes(service)) &&
      valueAtPath(fields, spec.storagePath) !== undefined &&
      valueAtPath(fields, spec.storagePath) !== null
    )
    .filter((spec) => {
      const value = valueAtPath(fields, spec.storagePath);
      if (typeof value === "boolean" && value === false) return false;
      if (spec.fieldId !== "houseWashWindowBundle") return true;
      return services.includes("window_cleaning") &&
        services.includes("house_wash");
    })
    .map((spec) => spec.fieldId)
    .filter((fieldId, index, all) => all.indexOf(fieldId) === index);
}

export function buildCanonicalPrePriceRecap(
  fields: QuoteSessionFields,
): string {
  const evaluation = evaluateQuoteIntake(
    fields as unknown as Record<string, unknown>,
  );
  const fieldIds = canonicalPrePriceRecapFieldIds(fields);
  const parts: string[] = [
    `services: ${
      evaluation.services.map((service) =>
        SERVICE_LABELS[service] ?? service.replaceAll("_", " ")
      ).join(" and ")
    }`,
  ];
  for (const fieldId of fieldIds) {
    if (fieldId === "services") continue;
    const spec = CANONICAL_INTAKE_FIELDS.find((candidate) =>
      candidate.fieldId === fieldId
    );
    if (!spec) continue;
    const value = valueAtPath(fields, spec.storagePath);
    if (
      value === undefined || value === null || value === "" || value === false
    ) continue;
    const safeValue = customerSafeValue(fieldId, value);
    if (!safeValue) continue;
    parts.push(
      `${customerSafeFieldLabel(fieldId)}: ${safeValue}`,
    );
  }
  return `Before I calculate the price, I have ${
    parts.join("; ")
  }. Is all of that correct?`;
}

function quantity(text: string): number | null {
  const value = parseSpokenQuantity(text, { min: 0, max: 100_000 });
  return value === undefined ? null : value;
}

function isPositive(value: number | null): value is number {
  return value !== null && value > 0;
}

function isPositiveInteger(
  value: number | null,
  max = Number.POSITIVE_INFINITY,
): value is number {
  return isPositive(value) && Number.isInteger(value) && value <= max;
}

function isPositiveHalfStep(value: number | null): value is number {
  return isPositive(value) && Number.isInteger(value * 2);
}

function yesNo(text: string): boolean | null {
  if (/\b(no|none|nope|not any|don'?t|do not)\b/i.test(text)) return false;
  if (
    /\b(yes|yeah|yep|correct|that'?s right|there (is|are)|we do|please)\b/i
      .test(text)
  ) return true;
  return null;
}

function parseServices(text: string): string[] {
  const services: string[] = [];
  const add = (service: string) => {
    if (!services.includes(service)) services.push(service);
  };
  if (/\bwindow(s)?\b/i.test(text)) add("windowCleaning");
  if (/\bhouse\s*(wash|washing)|soft\s*wash\b/i.test(text)) add("houseWash");
  if (/\bgutter(s)?\b/i.test(text)) add("gutterCleaning");
  if (/\broof\b/i.test(text)) add("roofCleaning");
  if (/\bdriveway\b/i.test(text)) add("drivewayCleaning");
  if (
    /\bpressure\s*wash|flatwork|front porch|back patio|pool deck|walkway/i.test(
      text,
    )
  ) add("pressureWashing");
  if (/\bsolar\s*panel/i.test(text)) add("solarPanelCleaning");
  if (/\bscreen\s*(repair|replacement)|repair.*screen/i.test(text)) {
    add("screenRepair");
  }
  return services;
}

function surface(text: string): string | null {
  if (/exposed\s*aggregate/i.test(text)) return "exposed_aggregate";
  for (
    const value of [
      "concrete",
      "pavers",
      "stone",
      "asphalt",
      "stamped",
      "brick",
      "tile",
    ]
  ) {
    if (new RegExp(`\\b${value}\\b`, "i").test(text)) return value;
  }
  if (/\b(other|not sure|unknown)\b/i.test(text)) return "unknown";
  return null;
}

function patchForField(
  fieldId: string,
  text: string,
  fields: QuoteSessionFields,
): Partial<QuoteSessionFields> | null {
  const number = quantity(text);
  switch (fieldId) {
    case "priceChangingAssumptionConfirmation": {
      if (classifyExplicitConfirmation(text) !== "confirmed") return null;
      const confirmedFieldIds = canonicalPrePriceRecapFieldIds(fields);
      return {
        confirmationSummary: {
          confirmed: true,
          confirmedFieldIds,
          confirmedAt: new Date().toISOString(),
        },
      };
    }
    case "services": {
      const services = parseServices(text);
      if (!services.length) return null;
      return {
        services,
        ...(services.includes("windowCleaning")
          ? {
            customerType:
              /\bcommercial|business|storefront|office\b/i.test(text)
                ? "commercial" as const
                : "residential" as const,
            windowCleaningScope:
              /\bcommercial|business|storefront|office\b/i.test(text)
                ? "commercial_custom" as const
                : /\b(some|specific|partial|only \d+|few windows)\b/i.test(text)
                ? "partial" as const
                : "whole_home" as const,
          }
          : {}),
      };
    }
    case "windowCleaningSides":
      if (
        /\b(inside|interior)\b.*\b(outside|exterior)\b|\bboth\b/i.test(text)
      ) return { windowCleaningSides: "inside_and_outside" };
      if (
        /\b(outside|exterior)\b/i.test(text) &&
        !/\b(inside|interior)\b/i.test(text)
      ) return { windowCleaningSides: "outside_only" };
      return null;
    case "squareFootage":
      return isPositive(number) && number <= 100_000
        ? { squareFootage: number }
        : null;
    case "stories": {
      const story = /\b(one|single|1)\b/i.test(text)
        ? 1
        : /\b(two|2)\b/i.test(text)
        ? 2
        : /\b(three|3)\b/i.test(text)
        ? 3
        : null;
      return story ? { stories: story } : null;
    }
    case "condition":
    case "windowCleaningCondition":
      if (/\b(heavy|heavily|significant|buildup|neglected)\b/i.test(text)) {
        return { condition: "heavy" };
      }
      if (/\b(maintenance|maintained|regular|routine|normal)\b/i.test(text)) {
        return { condition: "maintenance" };
      }
      return null;
    case "advancedWindowConditions": {
      const answer = yesNo(text);
      if (answer == null) return null;
      return {
        advancedWindowConditions: answer,
        ...(answer
          ? {
            hardWaterStains: /hard.water/i.test(text),
            frenchPanes: /french|divided|small panes/i.test(text),
            ladderWork: /ladder|unusual access/i.test(text),
          }
          : {}),
      };
    }
    case "hardWaterAffectedWindowEquivalents":
      return isPositiveHalfStep(number)
        ? { hardWaterAffectedWindowEquivalents: number }
        : null;
    case "ladderAffectedWindowEquivalents":
      return isPositiveHalfStep(number)
        ? { ladderAffectedWindowEquivalents: number }
        : null;
    case "addedInteriorWindowSides":
      return isPositiveHalfStep(number)
        ? { addedInteriorWindowSides: number }
        : null;
    case "omittedWindowSides":
      if (/\b(?:unknown|not sure|unsure)\b/i.test(text)) {
        return { omittedWindowSides: "unknown" };
      }
      return isPositiveHalfStep(number) ? { omittedWindowSides: number } : null;
    case "advancedWindowConditionTypes": {
      const hardWaterStains = /hard.water/i.test(text);
      const frenchPanes = /french|divided|small panes/i.test(text);
      const ladderWork = /ladder|unusual access/i.test(text);
      return hardWaterStains || frenchPanes || ladderWork
        ? { hardWaterStains, frenchPanes, ladderWork }
        : null;
    }
    case "screenProfile":
      if (/\bno screens?|without screens?\b/i.test(text)) {
        return { screenProfile: "no_screens" };
      }
      if (/\bmix|some solar/i.test(text)) {
        return { screenProfile: "mixed_standard_solar" };
      }
      if (/\bsolar\b/i.test(text)) return { screenProfile: "solar" };
      if (/\bfixed|non.?removable|not sure|unknown/i.test(text)) {
        return { screenProfile: "fixed_nonremovable_or_unknown" };
      }
      if (/\bstandard|removable|regular\b/i.test(text)) {
        return { screenProfile: "standard_removable" };
      }
      return null;
    case "solarScreenCoverage":
      if (/\b(all|every)\b/i.test(text)) return { solarScreenCoverage: "all" };
      if (/\b(some|part|only)\b/i.test(text)) {
        return { solarScreenCoverage: "some" };
      }
      return null;
    case "solarScreenAffectedWindowCount":
      return isPositiveInteger(number)
        ? { solarScreenAffectedWindowCount: number }
        : null;
    case "solarScreenServiceRequested": {
      const answer = yesNo(text);
      return answer === null ? null : { solarScreenServiceRequested: answer };
    }
    case "enclosedPatioProfile":
      if (/\b(no|none|don'?t|without)\b/i.test(text)) {
        return { enclosedPatioProfile: "none" };
      }
      if (/\b(mixed|not sure|uncertain)\b/i.test(text)) {
        return { enclosedPatioProfile: "mixed_or_uncertain" };
      }
      if (/\bwindow|sunroom|glass\b/i.test(text)) {
        return { enclosedPatioProfile: "window_enclosed" };
      }
      if (/\bscreen(ed)?\b/i.test(text)) {
        return { enclosedPatioProfile: "screened" };
      }
      return null;
    case "screenedEnclosureSoftWash": {
      const answer = yesNo(text);
      return answer === null ? null : { screenedEnclosureSoftWash: answer };
    }
    case "enclosureWindowCount":
      return isPositiveInteger(number)
        ? { enclosureWindowCount: number }
        : null;
    case "enclosureWindowSides":
      return patchForField("windowCleaningSides", text, fields)
          ?.windowCleaningSides
        ? {
          enclosureWindowSides:
            patchForField("windowCleaningSides", text, fields)!
              .windowCleaningSides,
        }
        : null;
    case "windowCount":
      return isPositiveHalfStep(number) ? { windowCount: number } : null;
    case "commercialLocations": {
      const address = text.trim().slice(0, 200);
      if (address.length < 4) return null;
      return {
        commercialLocations: [
          ...(fields.commercialLocations ?? []),
          { address },
        ],
        humanPricingRequired: true,
      };
    }
    case "preferredContactMethods": {
      const methods: Array<"phone" | "text" | "email"> = [
        /\bcall|phone\b/i.test(text) ? "phone" : null,
        /\btext|sms\b/i.test(text) ? "text" : null,
        /\bemail\b/i.test(text) ? "email" : null,
      ].filter((method): method is "phone" | "text" | "email" => !!method);
      return methods.length ? { preferredContactMethods: methods } : null;
    }
    case "houseWashStainType":
      if (/\b(?:rust|irrigation|orange)\b/i.test(text)) {
        return { houseWashStainType: "rust" };
      }
      if (/\b(?:organic|algae|mildew|mold|green|black)\b/i.test(text)) {
        return { houseWashStainType: "organic" };
      }
      return null;
    case "roofType": {
      if (/asphalt|shingle/i.test(text)) return { roofType: "asphalt_shingle" };
      for (
        const value of [
          "tile",
          "slate",
          "cedar",
          "metal",
          "flat_commercial",
          "flat",
        ]
      ) {
        if (new RegExp(`\\b${value.replace("_", " ")}\\b`, "i").test(text)) {
          return { roofType: value };
        }
      }
      if (/not sure|unknown/i.test(text)) return { roofType: "unknown" };
      return null;
    }
    case "roofSeverity": {
      const value = ["light", "moderate", "extreme", "uncertain"].find((v) =>
        new RegExp(`\\b${v}\\b`, "i").test(text)
      );
      return value ? { roofSeverity: value } : null;
    }
    case "roofRiskFlags": {
      const answer = yesNo(text);
      if (answer == null) return null;
      const knownDamage = /damage/i.test(text);
      const extremePitch = /steep|extreme pitch/i.test(text);
      const fragileMaterial = /fragile/i.test(text);
      const unusualAccess = /unusual access|difficult access/i.test(text);
      if (
        answer && !knownDamage && !extremePitch && !fragileMaterial &&
        !unusualAccess
      ) return null;
      return {
        roofRiskFlags: {
          knownDamage: answer && knownDamage,
          extremePitch: answer && extremePitch,
          fragileMaterial: answer && fragileMaterial,
          unusualAccess: answer && unusualAccess,
        },
      };
    }
    case "drivewaySqft":
      return isPositive(number) && number <= 100_000
        ? { drivewaySqft: number }
        : null;
    case "drivewaySurface": {
      const value = surface(text);
      return value ? { drivewaySurface: value } : null;
    }
    case "pressureWashingSurface": {
      const value = surface(text);
      return value ? { pressureWashSurface: value } : null;
    }
    case "pressureWashingAreas": {
      if (!isPositive(number) || number > 100_000) return null;
      const key = /front porch/i.test(text)
        ? "frontPorch"
        : /pool deck/i.test(text)
        ? "poolDeck"
        : /walkway/i.test(text)
        ? "walkways"
        : /back patio|patio/i.test(text)
        ? "backPatio"
        : null;
      if (!key) return null;
      const selectedSurface = surface(text) ?? fields.pressureWashSurface;
      if (!selectedSurface) return null;
      return {
        pressureWashingAreas: {
          ...(fields.pressureWashingAreas ?? {}),
          [key]: { enabled: true, sqft: number, surfaceType: selectedSurface },
        },
      };
    }
    case "solarPanelCount":
      return isPositiveInteger(number, 500)
        ? { solarPanelCount: number }
        : null;
    case "solarAccessProfile": {
      const answer = yesNo(text);
      if (answer == null) return null;
      const stories =
        fields.stories === 1 || fields.stories === 2 || fields.stories === 3
          ? fields.stories
          : /\b(one|1)\b/i.test(text)
          ? 1
          : /\b(two|2)\b/i.test(text)
          ? 2
          : /\b(three|3)\b/i.test(text)
          ? 3
          : null;
      if (!stories) return null;
      return {
        solarAccessProfile: {
          stories,
          accessType: answer ? "standard_residential" : "unusual_or_uncertain",
          knownDamage: /damage/i.test(text),
          extremePitch: /steep|extreme pitch/i.test(text),
          fragileMaterial: /fragile/i.test(text),
          unusualAccess: !answer || /unusual access/i.test(text),
        },
      };
    }
    case "screenRepairCount":
      return isPositiveInteger(number, 500)
        ? { screenRepairCount: number }
        : null;
    case "screenRepairScopeType":
      if (/\bstandard|removable|reusable frame\b/i.test(text)) {
        return { screenRepairScopeType: "standard_removable_reusable_frame" };
      }
      if (/\bdoor\b/i.test(text)) {
        return { screenRepairScopeType: "screen_door" };
      }
      if (/\bnew frame\b/i.test(text)) {
        return { screenRepairScopeType: "new_frame" };
      }
      if (/\bdamaged frame\b/i.test(text)) {
        return { screenRepairScopeType: "damaged_frame" };
      }
      if (/\bsolar\b/i.test(text)) {
        return { screenRepairScopeType: "solar_screen" };
      }
      if (/\boversized|specialty\b/i.test(text)) {
        return { screenRepairScopeType: "specialty_or_oversized" };
      }
      if (/\bnot sure|unknown\b/i.test(text)) {
        return { screenRepairScopeType: "unknown" };
      }
      return null;
    case "gutterUndergroundDrainCount":
      return number !== null && Number.isInteger(number)
        ? {
          gutterAddons: {
            ...(fields.gutterAddons ?? {}),
            undergroundDrains: { enabled: number > 0, count: number },
          },
        }
        : null;
    case "gutterGuardsLinearFeet":
      return isPositive(number)
        ? {
          gutterAddons: {
            ...(fields.gutterAddons ?? {}),
            gutterGuards: { enabled: true, linearFeet: number },
          },
        }
        : null;
    case "gutterRepairNeeds": {
      const repairNeeds: string[] = [];
      const add = (value: string) => {
        if (!repairNeeds.includes(value)) repairNeeds.push(value);
      };
      if (/\b(?:no|none|nothing)\b/i.test(text)) add("none");
      if (/\b(?:unsure|not sure|unknown)\b/i.test(text)) add("unsure");
      if (/\b(?:leak|leaking|seam)\b/i.test(text)) add("leaking_seams");
      if (
        /\b(?:loose|reattach).*(?:gutter|section)|(?:gutter|section).*(?:loose|reattach)\b/i
          .test(text)
      ) add("loose_gutter_sections");
      if (
        /\b(?:detached|fallen).*(?:gutter|section)|(?:gutter|section).*(?:detached|fallen)\b/i
          .test(text)
      ) add("detached_gutter_sections");
      if (
        /\b(?:loose|reattach).*downspout|downspout.*(?:loose|reattach)\b/i
          .test(text)
      ) add("loose_downspouts");
      if (
        /\b(?:detached|fallen).*downspout|downspout.*(?:detached|fallen)\b/i
          .test(text)
      ) add("detached_downspouts");
      if (/\b(?:other|another|something else)\b/i.test(text)) {
        add("another_repair_need");
      }
      if (!repairNeeds.length) return null;
      return {
        gutterAddons: {
          ...(fields.gutterAddons ?? {}),
          repairNeeds,
          minorRepairs: !repairNeeds.every((value) =>
            value === "none" || value === "unsure" ||
            value === "another_repair_need"
          ),
        },
      };
    }
    case "gutterRepairNotes": {
      const note = text.trim().slice(0, 500);
      return note.length >= 3
        ? {
          gutterAddons: {
            ...(fields.gutterAddons ?? {}),
            repairNotes: note,
          },
        }
        : null;
    }
    case "houseWashPatioSelections": {
      const frontSelected = /\bfront\b/i.test(text);
      const backSelected = /\b(?:back|rear)\b/i.test(text);
      const both = /\bboth\b/i.test(text);
      if (!frontSelected && !backSelected && !both) return null;
      return {
        houseWashPatios: {
          ...(fields.houseWashPatios ?? {}),
          frontSelected: both || frontSelected,
          backSelected: both || backSelected,
        },
      };
    }
    case "houseWashPatioPricingMethod":
      if (/exact|square feet|square footage/i.test(text)) {
        return {
          houseWashPatios: {
            ...(fields.houseWashPatios ?? {}),
            pricingMethod: "exact_square_footage",
          },
        };
      }
      if (/standard|simple|option/i.test(text)) {
        return {
          houseWashPatios: {
            ...(fields.houseWashPatios ?? {}),
            pricingMethod: "simple_selection",
          },
        };
      }
      return null;
    case "houseWashFrontPatioSqft":
      return isPositive(number) && number <= 100_000
        ? {
          houseWashPatios: {
            ...(fields.houseWashPatios ?? {}),
            frontSelected: true,
            frontSqft: number,
          },
        }
        : null;
    case "houseWashBackPatioSqft":
      return isPositive(number) && number <= 100_000
        ? {
          houseWashPatios: {
            ...(fields.houseWashPatios ?? {}),
            backSelected: true,
            backSqft: number,
          },
        }
        : null;
    case "contact_name": {
      const corrected = text.match(
        /^\s*(?:it'?s\s+)?([A-Za-z][A-Za-z'’-]{0,23}(?:\s+[A-Za-z][A-Za-z'’-]{0,23}){0,2})\s+(?:not|instead of)\s+/i,
      )?.[1];
      const name = parseSpokenName(corrected ?? text);
      // Local booking identity requires a confirmed first AND last name.
      return name && name.trim().split(/\s+/).length >= 2 ? { name } : null;
    }
    case "contact_email": {
      const email = parseSpokenEmail(text);
      return email ? { email } : null;
    }
    case "contact_phone": {
      const phone = normalizeSpokenPhone(text);
      return phone ? { phone } : null;
    }
    case "address":
      return /\d/.test(text) && text.trim().length >= 6
        ? { address: text.trim() }
        : null;
    default:
      return null;
  }
}

export function applyCanonicalVoiceAnswer(
  session: QuoteSession,
  fieldId: string,
  utterance: string,
): VoiceAnswerResult {
  const patch = patchForField(fieldId, utterance, session.fields);
  if (!patch) {
    return { accepted: false, session, fieldId, reason: "unrecognized_answer" };
  }
  const keys = Object.keys(patch) as (keyof QuoteSessionFields)[];
  const defaulted = fieldId === "services" &&
      patch.windowCleaningScope === "whole_home"
    ? ["windowCleaningScope" as keyof QuoteSessionFields]
    : [];
  const next = mergeFields(session, patch, {
    markDefaulted: defaulted,
    markCustomerEstimate: keys.filter((key) =>
      key === "squareFootage" || key === "drivewaySqft" ||
      key === "pressureWashingAreas"
    ),
    markConfirmedSummary: fieldId === "priceChangingAssumptionConfirmation"
      ? canonicalPrePriceRecapFieldIds(
        session.fields,
      ) as (keyof QuoteSessionFields)[]
      : [],
  });
  return { accepted: true, session: next, fieldId };
}

/** Format the canonical engine total without independently rounding it to a
 * whole dollar. The engine already owns cent-level arithmetic. */
export function formatCanonicalCurrency(total: number): string {
  if (!Number.isFinite(total)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(total) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(total);
}

export function buildCanonicalPriceStatement(total: number): string {
  return `The current total is ${
    formatCanonicalCurrency(total)
  }. ${PRICE_ASSURANCE}`;
}
