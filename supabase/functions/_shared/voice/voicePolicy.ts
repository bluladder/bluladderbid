// Version-controlled voice policy. This module owns ordinary conversational
// sequencing and approved assumptions; numeric pricing remains exclusively in
// the canonical pricing engine and live pricing configuration.

import {
  mergeFields,
  type QuoteSession,
  type QuoteSessionFields,
} from "../quoteSession.ts";

export const VOICE_QUOTE_POLICY = Object.freeze({
  version: "voice-express-v1",
  opening:
    "Thanks for calling BluLadder. Are you calling for a quote, about an existing appointment, or do you have a question or request?",
  servicePrompt: "Which service or services would you like priced?",
  routes: ["new_quote", "existing_appointment", "question_or_request"],
  directIntent: true,
  oneQuestionPerTurn: true,
  retryLimitPerField: 1,
  ordinaryWindowFieldOrder: [
    "services",
    "squareFootage",
    "windowCleaningSides",
  ],
  approvedWindowAssumptions: {
    customerType: "residential",
    windowCleaningScope: "whole_home",
    condition: "maintenance",
    screenProfile: "standard_removable",
    advancedWindowConditions: false,
    hardWaterStains: false,
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
  },
  defaultProvenance: "approved_business_default",
  volunteeredModifiers: [
    "stories",
    "hardWaterStains",
    "hardWaterAffectedWindowEquivalents",
    "ladderWork",
    "ladderAffectedWindowEquivalents",
    "screenProfile",
    "solarScreenCoverage",
  ],
  noteLimitCharacters: 240,
  coupon: { proactiveQuestion: false, retryLimit: 1 },
  delivery: { priceFirst: true, requireAuthoritativeProviderAcceptance: true },
  address: { conciseConfirmation: true, clarificationLimit: 1 },
  budgets: {
    ordinaryWindowQuestionsBeforePrice: 3,
    singleServicePriceSeconds: [60, 90],
    multiServicePriceSeconds: 120,
  },
  safeFallbacks: {
    uncertainExternalAction: "do_not_retry_automatically",
    uncertainAddress: "preserve_candidate_for_review",
  },
} as const);

export function isProviderRecordingNotice(value: string): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return /^(?:this|the) call (?:is|will be|may be) recorded(?: for .+)?[.!]?$/
    .test(text) ||
    /^this call will be recorded[.!]?$/.test(text);
}

function requestedServices(text: string): string[] {
  const services: string[] = [];
  if (/\b(window|windows)\b/i.test(text)) services.push("window_cleaning");
  if (/\bhouse (?:wash|washing)\b/i.test(text)) services.push("house_wash");
  if (/\bgutter(?:s)?(?: cleaning)?\b/i.test(text)) services.push("gutter_cleaning");
  if (/\broof (?:cleaning|wash)\b/i.test(text)) services.push("roof_cleaning");
  if (/\bdriveway\b/i.test(text)) services.push("driveway_cleaning");
  if (/\bpressure wash(?:ing)?\b/i.test(text)) services.push("pressure_washing");
  return [...new Set(services)];
}

function spokenCount(text: string): number | null {
  const digit = text.match(/\b(\d+(?:\.5)?)\b/)?.[1];
  if (digit) return Number(digit);
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const match = text.toLowerCase().match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/,
  );
  return match ? words[match[1]] : null;
}

function boundedNote(text: string): string | null {
  if (!/\b(dog|gate|fragile|parking|arrival|text before|access instruction)\b/i.test(text)) {
    return null;
  }
  return text.trim().slice(0, VOICE_QUOTE_POLICY.noteLimitCharacters);
}

/** Capture only high-confidence volunteered facts. Notes are inert metadata:
 * they never alter price, service selection, address, or appointment state. */
export function applyVolunteeredVoiceFacts(
  initial: QuoteSession,
  utterance: string,
): QuoteSession {
  let session = initial;
  const patch: Partial<QuoteSessionFields> = {};
  const services = requestedServices(utterance);
  if (services.length > 0) patch.services = services;
  if (/\b(outside|exterior)(?:\s+only)?\b/i.test(utterance)) {
    patch.windowCleaningSides = "outside_only";
  } else if (/\binside\s+(?:and|&)\s+outside\b/i.test(utterance)) {
    patch.windowCleaningSides = "inside_and_outside";
  }
  const sqft = utterance.match(/\b([1-9]\d{2,4})\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft\.?|sf)\b/i)?.[1];
  if (sqft) patch.squareFootage = Number(sqft.replaceAll(",", ""));
  if (/\b(?:ladder|unusual access)\b/i.test(utterance)) {
    patch.ladderWork = true;
    const count = spokenCount(utterance);
    if (count) patch.ladderAffectedWindowEquivalents = count;
  }
  if (/\bhard[ -]?water\b/i.test(utterance)) {
    patch.hardWaterStains = true;
    const count = spokenCount(utterance);
    if (count) patch.hardWaterAffectedWindowEquivalents = count;
  }
  if (/\bsolar screens?\b/i.test(utterance)) {
    patch.screenProfile = "solar";
    if (/\b(all|every)\b/i.test(utterance)) patch.solarScreenCoverage = "all";
  }
  const stories = utterance.match(/\b([123]|one|two|three)[ -]stor(?:y|ies)\b/i)?.[1];
  if (stories) {
    patch.stories = ({ one: 1, two: 2, three: 3 } as Record<string, number>)[stories.toLowerCase()] ?? Number(stories);
  }
  if (Object.keys(patch).length > 0) session = mergeFields(session, patch);
  const note = boundedNote(utterance);
  if (note) {
    const existing = session.fields.voiceJourney?.volunteeredNotes ?? [];
    session = mergeFields(session, {
      voiceJourney: {
        ...(session.fields.voiceJourney ?? {}),
        volunteeredNotes: [...existing, note].slice(-6),
      },
    });
  }
  return session;
}

export function applyApprovedWindowDefaults(session: QuoteSession): QuoteSession {
  if (!(session.fields.services ?? []).some((service) =>
    service === "window_cleaning" || service === "windowCleaning"
  )) return session;
  const defaults = VOICE_QUOTE_POLICY.approvedWindowAssumptions;
  const patch: Partial<QuoteSessionFields> = {};
  const defaulted: (keyof QuoteSessionFields)[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    if ((session.fields as Record<string, unknown>)[key] === undefined) {
      (patch as Record<string, unknown>)[key] = value;
      defaulted.push(key as keyof QuoteSessionFields);
    }
  }
  patch.voiceJourney = {
    ...(session.fields.voiceJourney ?? {}),
    policyVersion: VOICE_QUOTE_POLICY.version,
  };
  return mergeFields(session, patch, { markDefaulted: defaulted });
}

export function nextExpressPrePriceField(session: QuoteSession): string | null {
  const services = session.fields.services ?? [];
  if (services.length === 0) return "services";
  if (!services.some((service) =>
    service === "window_cleaning" || service === "windowCleaning"
  )) return null;
  if (!session.fields.squareFootage) return "squareFootage";
  if (!session.fields.windowCleaningSides) return "windowCleaningSides";
  if (session.fields.ladderWork && !session.fields.ladderAffectedWindowEquivalents) {
    return "ladderAffectedWindowEquivalents";
  }
  if (session.fields.hardWaterStains && !session.fields.hardWaterAffectedWindowEquivalents) {
    return "hardWaterAffectedWindowEquivalents";
  }
  return null;
}

export function normalizeVolunteeredDiscountCode(text: string): string | null {
  const match = text.match(/\b(?:coupon|discount|promo)\s+(?:code\s+)?(?:is\s+)?([a-z0-9][a-z0-9_-]{2,19})\b/i);
  return match ? match[1].toUpperCase() : null;
}
