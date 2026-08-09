// Version-controlled voice policy. This module owns ordinary conversational
// sequencing and approved assumptions; numeric pricing remains exclusively in
// the canonical pricing engine and live pricing configuration.

import {
  mergeFields,
  type QuoteSession,
  type QuoteSessionFields,
} from "../quoteSession.ts";
import { normalizeAuthoritativeDiscountCode } from "../discountCodeValidation.ts";
import { normalizeServiceId } from "../salesEngine/quoteIntakeContract.ts";
import { parseSpokenQuantity } from "./spokenQuantity.ts";

export const VOICE_QUOTE_POLICY = Object.freeze(
  {
    version: "voice-express-v1",
    opening:
      "Hi, thank you for calling BluLadder. Are you calling to get a quote, schedule an appointment, or do you have a specific question?",
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
      // The canonical intake still carries stories for cross-channel parity. One
      // story is the neutral voice default; window pricing ignores story modifiers.
      stories: 1,
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
    delivery: {
      priceFirst: true,
      requireAuthoritativeProviderAcceptance: true,
    },
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
  } as const,
);

export function isProviderRecordingNotice(value: string): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return /^(?:this|the) call (?:is|will be|may be) recorded(?: for .+)?[.!]?$/
    .test(text);
}

const OPERATIONAL_TAIL_START =
  /^(?:please\s+)?(?:(?:the|a|my|our|your)\s+)?(?:dog|pet|crew|parking)\b|^(?:please\s+)?(?:park\b|use\s+(?:the\s+)?(?:selected\s+)?(?:gate|parking)\b|access(?:\s+(?:is|will\s+be)\s+outside|(?:\s+(?:through|via|by))?\s+(?:the\s+)?(?:gate|parking))\b|text\s+(?:me\s+)?before\s+arrival\b|message\s+(?:me\s+)?(?:before\s+arrival|when\s+.+\bon\s+the\s+way)\b|(?:the\s+)?gate\b|access\s+instructions?\b|arrival\s+instructions?\b)/i;

const OPERATIONAL_CUE =
  /\b(?:dog|pet|gate|parking|park|arrival|arrive|crew|access|behind\s+the\s+gate|by\s+the\s+gate|on\s+the\s+way)\b|\b(?:text|message)\s+(?:me\s+)?before\s+arrival\b/i;

const HIGH_CONFIDENCE_PRICING_FACT =
  /\b(?:\d[\d,]*\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft\.?|sf)|window(?:s)?\s+(?:cleaning|washing|quote)|(?:clean|wash)\s+(?:the\s+)?windows?|house\s+(?:wash|washing)|gutter(?:s)?\s+(?:cleaning|washing|quote)|roof\s+(?:cleaning|wash|washing)|driveway\s+(?:cleaning|washing|quote)|pressure\s+wash(?:ing)?|inside\s+(?:and|&)\s+outside|(?:outside|exterior)\s+only|all\s+exterior\s+windows?|hard[ -]?water|ladder\s+(?:work|access)|unusual\s+(?:ladder\s+)?access|(?:solar|standard|removable)\s+screens?|(?:no|without)\s+screens?|french\s+panes?|divided\s+panes?|(?:heavy|maintenance|regular)\s+(?:condition|buildup|soil)|(?:window[- ]enclosed|screened|enclosed)\s+patio|sunroom|(?:[123]|one|two|three)[ -]stor(?:y|ies))\b/i;

const QUOTE_TEXT_NOUN = /\b(?:quote|price|estimate|bid|total)\b/i;
const QUOTE_TEXT_PRONOUN = /\b(?:it|that|this)\b/i;
const QUOTE_TEXT_DELIVERY =
  /\b(?:text(?:ed|ing)?|txt|sms|message(?:d|ing)?|send|sent)\b|\bby\s+(?:text|sms)\b/i;

const FIRM_CORRECTION_CUE =
  /\b(?:actually|correction|correct\s+that|change(?:\s+that)?|instead|rather|i\s+(?:need|want|meant)|make\s+it|should\s+be)\b/i;

function splitOperationalTail(clause: string): string[] {
  for (const match of clause.matchAll(/\s+(?:and|but|also|then)\s+/gi)) {
    const boundary = match.index ?? -1;
    if (boundary < 0) continue;
    const right = clause.slice(boundary + match[0].length).trim();
    if (!OPERATIONAL_TAIL_START.test(right)) continue;
    const left = clause.slice(0, boundary).trim();
    return [left, ...splitOperationalTail(right)].filter(Boolean);
  }
  return clause.trim() ? [clause.trim()] : [];
}

/** Split conversational clauses without treating pricing conjunctions as
 * boundaries. Only a narrowly recognized operational tail after "and" is
 * separated, so "inside and outside" and modifier combinations stay intact. */
export function splitVoiceClauses(text: string): string[] {
  return String(text ?? "")
    .split(/;|(?<=[.!?])\s+|,\s+(?!\d)/)
    .flatMap((part) => splitOperationalTail(part.trim()))
    .map((part) => part.replace(/^and\s+/i, "").trim())
    .filter(Boolean);
}

/** Operational instructions are inert unless the same clause contains a
 * high-confidence pricing fact. This prevents a gate or crew reference from
 * erasing a volunteered modifier that happens to share the clause. */
export function isOperationalInstructionClause(clause: string): boolean {
  const normalized = String(clause ?? "").trim();
  return OPERATIONAL_CUE.test(normalized) &&
    !HIGH_CONFIDENCE_PRICING_FACT.test(normalized);
}

function isShortQuoteTextEcho(clause: string): boolean {
  return /^(?:please\s+)?(?:text(?:ed)?|txt|sms|send|message)(?:\s+(?:it|that|this|please))*[.!]?$/i
    .test(clause.trim());
}

function isShortWrittenQuoteChoice(clause: string): boolean {
  return /^(?:please\s+)?(?:the\s+)?written\s+(?:quote|estimate|price)(?:\s+please)?[.!]?$/i
    .test(clause.trim());
}

function hasQuoteTextContext(clause: string): boolean {
  return QUOTE_TEXT_NOUN.test(clause) || QUOTE_TEXT_PRONOUN.test(clause) ||
    isShortQuoteTextEcho(clause) || isShortWrittenQuoteChoice(clause);
}

function clauseRejectsQuoteText(clause: string): boolean {
  const normalized = clause.toLowerCase().replaceAll("’", "'");
  const shortRejection =
    /^(?:(?:no|nope)\b[\s,]*)?(?:please\s+)?(?:not\s+(?:by\s+)?(?:text|sms)|(?:do\s+not|don't|dont)\s+(?:text|texted|txt|sms|message|send))(?:\s+please)?[.!]?$/
      .test(normalized);
  const shortNo =
    /^(?:no|nope)\b[\s,]*(?:please\s+)?(?:do\s+not\s+|don't\s+|dont\s+)?(?:the\s+)?(?:quote\s+)?(?:by\s+)?(?:text|texted|txt|sms|message|send)\b/
      .test(normalized);
  if (shortRejection || shortNo) return true;
  if (!QUOTE_TEXT_DELIVERY.test(clause) || !hasQuoteTextContext(clause)) {
    return false;
  }
  const directlyNegated =
    /\b(?:do\s+not|don't|dont|never)\s+(?:(?:really|currently|presently|actually)\s+)*(?:(?:have\s+)?(?:the\s+)?(?:quote|price|estimate|bid|total|it|that|this)\s+)?(?:text(?:ed)?|txt|sms|message|send|sent)\b/
      .test(
        normalized,
      );
  const rejectedPreference =
    /\b(?:(?:do|would|will|should)\s+not|don't|dont|never|not)\s+(?:(?:really|currently|presently|actually)\s+)*(?:want|need|prefer|choose|like)\s+(?:(?:to\s+(?:have|get|receive)\s+)?(?:the\s+|my\s+)?(?:quote|price|estimate|bid|total)|it|that|this)(?:\s+(?:delivered|sent))?\s+(?:text(?:ed)?|txt|sms|message(?:d)?|sent|by\s+(?:text|sms))\b|\b(?:(?:do|would|will|should)\s+not|don't|dont|never|not)\s+(?:want|need|prefer|choose|like)\s+to\s+(?:text|txt|sms|message|send)\s+(?:me\s+)?(?:the\s+|my\s+)?(?:quote|price|estimate|bid|total)\b/
      .test(
        normalized,
      );
  const notToDelivery =
    /\b(?:said\s+)?not\s+to\s+(?:text|txt|sms|message|send)\b.{0,48}\b(?:quote|price|estimate|bid|total|it|that|this)\b/
      .test(normalized);
  const avoidDelivery =
    /\b(?:avoid|stop)\s+(?:texting|messaging|sending)\b.{0,48}\b(?:quote|price|estimate|bid|total|it|that|this)\b/
      .test(normalized);
  const reverseNegation =
    /\b(?:quote|price|estimate|bid|total|it|that|this)\b.{0,32}\b(?:should\s+)?(?:not|never)\s+(?:be\s+)?(?:texted|sent|messaged|by\s+(?:text|sms))\b/
      .test(
        normalized,
      );
  return directlyNegated || rejectedPreference || notToDelivery ||
    avoidDelivery || reverseNegation || shortNo;
}

function clauseRequestsQuoteText(clause: string): boolean {
  if (
    !QUOTE_TEXT_DELIVERY.test(clause) &&
    !isShortWrittenQuoteChoice(clause)
  ) return false;
  if (
    /^\s*(?:(?:did|have|has|had|was|were|are)\s+(?:you|we|they)\b|(?:is|was|are|were)\s+(?:the\s+|my\s+)?(?:quote|price|estimate|bid|total)\b)/i
      .test(clause)
  ) {
    return false;
  }
  if (isOperationalInstructionClause(clause) && !QUOTE_TEXT_NOUN.test(clause)) {
    return false;
  }
  return hasQuoteTextContext(clause);
}

function contextualQuoteTextDecision(
  text: string,
): "request" | "reject" | null {
  let decision: "request" | "reject" | null = null;
  for (const voiceClause of splitVoiceClauses(text)) {
    const choiceClauses = voiceClause.split(
      /\s+(?:but|instead(?:\s+of\s+that)?|actually)\s+/i,
    );
    for (const clause of choiceClauses) {
      if (clauseRejectsQuoteText(clause)) decision = "reject";
      else if (clauseRequestsQuoteText(clause)) decision = "request";
    }
  }
  return decision;
}

export function classifyContextualVoiceQuoteByTextRejection(
  text: string,
): boolean {
  return contextualQuoteTextDecision(text) === "reject";
}

export function classifyContextualVoiceQuoteByTextRequest(
  text: string,
): boolean {
  return contextualQuoteTextDecision(text) === "request";
}

function pricingContent(text: string): string {
  return splitVoiceClauses(text)
    .filter((part) => !isOperationalInstructionClause(part))
    .join("; ");
}

function requestedServices(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const serviceMention =
    "(?:window(?:s)?\\s+(?:cleaning|washing|quote)|(?:clean|wash)\\s+(?:the\\s+)?window(?:s)?|(?:front|selected)\\s+window(?:s)?|house\\s+(?:wash|washing)|gutter(?:s)?\\s+(?:cleaning|washing|quote)|clean\\s+(?:the\\s+)?gutter(?:s)?|roof\\s+(?:cleaning|wash|washing)|driveway\\s+(?:cleaning|washing|quote)|clean\\s+(?:the\\s+)?driveway|pressure\\s+wash(?:ing)?)";
  const coordinatedNegation = new RegExp(
    `\\b(?:no|not|without)\\s+(?:(?:any\\s+)?${serviceMention}\\s+(?:or|and)\\s+)+$`,
    "i",
  );
  const mentionIsNegated = (prefix: string): boolean => {
    const bounded = prefix.slice(-80);
    return /\b(?:no\s+longer|no|not|without|don\s*t|do\s+not)\s+(?:(?:really|currently|presently|actually)\s+)*(?:(?:need(?:\s+for)?|want|add|adding|ask(?:ing)?\s+for|request(?:ing)?|interested\s+in|looking\s+for)\s+)?(?:any\s+)?$/i
      .test(bounded) || coordinatedNegation.test(bounded);
  };
  const mentionIsRejectedAfterward = (suffix: string): boolean => {
    return /^\s+(?:(?:is|are|was|were)\s+)?(?:(?:really|currently|presently|actually)\s+)*(?:not|no\s+longer)\s+(?:needed|wanted|requested)\b/i
      .test(suffix);
  };
  const addIfExplicit = (rx: RegExp, id: string) => {
    const flags = rx.flags.includes("g") ? rx.flags : `${rx.flags}g`;
    const matches = [...normalized.matchAll(new RegExp(rx.source, flags))];
    const match = matches.at(-1);
    if (match?.index === undefined) return;
    const prefix = normalized.slice(0, match.index);
    const suffix = normalized.slice(match.index + match[0].length);
    if (mentionIsNegated(prefix) || mentionIsRejectedAfterward(suffix)) return;
    services.push(id);
  };
  const services: string[] = [];
  addIfExplicit(
    /\bwindow(?:s)?\s+(?:cleaning|washing|quote)\b|\b(?:clean|wash)\s+(?:the\s+)?window(?:s)?\b|\b(?:front|selected)\s+window(?:s)?\b|\bjust\s+window(?:s)?\b/,
    "window_cleaning",
  );
  addIfExplicit(/\bhouse\s+(?:wash|washing)\b/, "house_wash");
  addIfExplicit(
    /\bgutter(?:s)?\s+(?:cleaning|washing|quote)\b|\bclean\s+(?:the\s+)?gutter(?:s)?\b/,
    "gutter_cleaning",
  );
  addIfExplicit(/\broof\s+(?:cleaning|wash|washing)\b/, "roof_cleaning");
  addIfExplicit(
    /\bdriveway\s+(?:cleaning|washing|quote)\b|\bclean\s+(?:the\s+)?driveway\b/,
    "driveway_cleaning",
  );
  addIfExplicit(/\bpressure\s+wash(?:ing)?\b/, "pressure_washing");
  return [...new Set(services)];
}

/** Parse only the clause attached to the named modifier. This prevents a home
 * measurement such as "2,000 square feet" from becoming 2,000 ladder windows. */
function modifierCount(
  text: string,
  keyword: RegExp,
): number | undefined {
  const clauses = text.split(/;|,\s+(?!\d)|\b(?:and then|also)\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const matching = clauses.map((clause) => {
    const match = clause.match(keyword);
    if (match?.index === undefined) return null;
    return clause
      .replace(
        /\b(?:about|around)?\s*\d[\d,]*\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft\.?|sf)\s*(?:and\s+)?/ig,
        "",
      )
      .trim();
  }).filter((clause): clause is string => !!clause);
  keyword.lastIndex = 0;
  if (matching.length !== 1) return undefined;
  return parseSpokenQuantity(matching[0], { min: 0.5, max: 500, step: 0.5 });
}

function requiresAdvancedWindowConditions(fields: QuoteSessionFields): boolean {
  return fields.hardWaterStains === true ||
    fields.frenchPanes === true ||
    fields.ladderWork === true ||
    fields.screenProfile === "solar" ||
    fields.enclosedPatioProfile === "screened" ||
    fields.enclosedPatioProfile === "window_enclosed";
}

function clearCapturedField(
  session: QuoteSession,
  field: keyof QuoteSessionFields,
): void {
  delete (session.fields as Record<string, unknown>)[field];
  delete session.fieldStatus[field];
  delete session.fields.answerProvenance?.[field];
}

function boundedNote(text: string): string | null {
  if (
    !/\b(dog|pet|gate|fragile|parking|park|arrival|arrive|crew|text before|access instruction)\b/i
      .test(text)
  ) {
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
  const canCapturePricingFacts = session.quoteStatus === "none" ||
    session.quoteStatus === "firm";
  const preTurnRequiresAdvancedConditions =
    session.fields.advancedWindowConditions === true ||
    requiresAdvancedWindowConditions(session.fields);
  const setPricingFact = (
    field: keyof QuoteSessionFields,
    value: unknown,
  ): boolean => {
    const current = (session.fields as Record<string, unknown>)[field];
    if (JSON.stringify(current) === JSON.stringify(value)) return false;
    (patch as Record<string, unknown>)[field] = value;
    return true;
  };
  let clearLadderCount = false;
  let clearHardWaterCount = false;
  let markAdvancedConditionsDerived = false;
  const quoteText = pricingContent(utterance);
  const requested = requestedServices(quoteText);
  if (session.quoteStatus === "none" && requested.length > 0) {
    const canonical = [
      ...new Set([
        ...(initial.fields.services ?? []).map((service) =>
          normalizeServiceId(service) ?? service
        ),
        ...requested.map((service) => normalizeServiceId(service) ?? service),
      ]),
    ].sort();
    if (
      JSON.stringify(canonical) !==
        JSON.stringify(initial.fields.services ?? [])
    ) {
      patch.services = canonical;
    }
  }
  const windowContext = requested.includes("window_cleaning") ||
    (initial.fields.services ?? []).some((service) =>
      (normalizeServiceId(service) ?? service) === "window_cleaning"
    ) ||
    initial.lastStep === "asked:windowCleaningSides";
  const sideAnswerContext = initial.lastStep === "asked:windowCleaningSides";
  const sideCorrectionAllowed = session.quoteStatus !== "firm" ||
    FIRM_CORRECTION_CUE.test(quoteText);
  const explicitWindowSideClause = splitVoiceClauses(quoteText).some((clause) =>
    /\b(?:window(?:s)?\s+(?:cleaning|washing|cleaned|washed|quote)|(?:clean|wash)(?:ed|ing)?\s+(?:the\s+)?windows?)\b/i
      .test(clause) && /\b(?:inside|outside|exterior)\b/i.test(clause)
  );
  const insideAndOutsideAnswer =
    /\binside\s+(?:and|&)\s+outside\b/i.test(quoteText) &&
    (sideAnswerContext || explicitWindowSideClause ||
      session.quoteStatus === "firm");
  const explicitOutsideAnswer =
    /\b(?:(?:outside|exterior)\s+only|all\s+exterior\s+windows?)\b/i.test(
      quoteText,
    ) ||
    (/\b(?:outside|exterior)\b/i.test(quoteText) &&
      (sideAnswerContext || explicitWindowSideClause));
  if (
    session.quoteStatus === "none" &&
    /\b(commercial|business|storefront|office)\b/i.test(quoteText) &&
    /\bwindow/i.test(quoteText)
  ) {
    patch.customerType = "commercial";
    patch.windowCleaningScope = "commercial_custom";
  }
  if (
    session.quoteStatus === "none" && windowContext &&
    /\b(partial|selected|front[- ]only|front only|only\s+(?:the\s+)?(?:\w+\s+|\d+\s+)?front\s+windows?)\b/i
      .test(quoteText)
  ) {
    patch.windowCleaningScope = "partial";
  }
  if (
    canCapturePricingFacts && windowContext &&
    sideCorrectionAllowed && insideAndOutsideAnswer
  ) {
    setPricingFact("windowCleaningSides", "inside_and_outside");
  } else if (
    canCapturePricingFacts && windowContext &&
    sideCorrectionAllowed && explicitOutsideAnswer
  ) {
    setPricingFact("windowCleaningSides", "outside_only");
  }
  const sqft = quoteText.match(
    /\b((?:[1-9]\d{0,2}(?:,\d{3})+)|(?:[1-9]\d{2,5}))\s*(?:square\s*(?:feet|foot)|sq\.?\s*ft\.?|sf)\b/i,
  )?.[1];
  if (canCapturePricingFacts && sqft) {
    setPricingFact("squareFootage", Number(sqft.replaceAll(",", "")));
  }
  if (
    canCapturePricingFacts &&
    /\b(no|not|without)\s+(?:unusual\s+(?:ladder\s+)?access|ladder(?:\s+(?:work|access))?)\b/i
      .test(quoteText)
  ) {
    setPricingFact("ladderWork", false);
    clearLadderCount = true;
  } else if (
    canCapturePricingFacts &&
    /\b(?:ladder\s+(?:work|access)|unusual\s+(?:ladder\s+)?access)\b/i
      .test(quoteText)
  ) {
    setPricingFact("ladderWork", true);
    const count = modifierCount(
      quoteText,
      /\b(?:ladder\s+(?:work|access)|unusual\s+(?:ladder\s+)?access)\b/i,
    );
    if (count !== undefined) {
      setPricingFact("ladderAffectedWindowEquivalents", count);
    }
  }
  if (
    canCapturePricingFacts &&
    /\b(no|not|without)\s+hard[ -]?water\b/i.test(quoteText)
  ) {
    setPricingFact("hardWaterStains", false);
    clearHardWaterCount = true;
  } else if (canCapturePricingFacts && /\bhard[ -]?water\b/i.test(quoteText)) {
    setPricingFact("hardWaterStains", true);
    const count = modifierCount(quoteText, /\bhard[ -]?water\b/i);
    if (count !== undefined) {
      setPricingFact("hardWaterAffectedWindowEquivalents", count);
    }
  }
  if (
    canCapturePricingFacts &&
    /\b(?:no|not|without)\s+solar screens?\b/i.test(quoteText)
  ) {
    setPricingFact("screenProfile", "standard_removable");
  } else if (
    canCapturePricingFacts &&
    /\b(?:no|not|without)\s+screens?\b/i.test(quoteText)
  ) {
    setPricingFact("screenProfile", "no_screens");
  } else if (
    canCapturePricingFacts &&
    /\b(?:standard|removable)\s+screens?\b/i.test(quoteText)
  ) {
    setPricingFact("screenProfile", "standard_removable");
  } else if (canCapturePricingFacts && /\bsolar screens?\b/i.test(quoteText)) {
    setPricingFact("screenProfile", "solar");
    if (/\b(all|every)\b/i.test(quoteText)) {
      setPricingFact("solarScreenCoverage", "all");
    }
  }
  if (
    canCapturePricingFacts &&
    /\b(?:french panes?|divided panes?)\b/i.test(quoteText)
  ) {
    const frenchPanes = !/\b(no|not|without)\s+(?:french|divided)/i.test(
      quoteText,
    );
    setPricingFact("frenchPanes", frenchPanes);
  }
  const conditionCorrectionAllowed = session.quoteStatus !== "firm" ||
    FIRM_CORRECTION_CUE.test(quoteText) ||
    /\b(?:heavy|neglected|regular|maintenance|normal)\s+(?:condition|buildup|soil)\b|\b(?:post[- ]?construction|construction)\s+(?:condition|cleanup|soil|debris)\b/i
      .test(quoteText);
  if (
    canCapturePricingFacts && conditionCorrectionAllowed &&
    /\b(?:heavy|neglected|post construction|construction)\b/i.test(quoteText)
  ) {
    setPricingFact("condition", "heavy");
  } else if (
    canCapturePricingFacts && conditionCorrectionAllowed &&
    /\b(?:regular|maintenance|normal)\b/i.test(quoteText)
  ) {
    setPricingFact("condition", "maintenance");
  }
  if (
    canCapturePricingFacts &&
    /\b(?:window[- ]enclosed\s+patio|sunroom)\b/i.test(quoteText)
  ) {
    setPricingFact("enclosedPatioProfile", "window_enclosed");
  } else if (
    canCapturePricingFacts && /\bscreened\s+patio\b/i.test(quoteText)
  ) {
    setPricingFact("enclosedPatioProfile", "screened");
  } else if (
    canCapturePricingFacts && /\benclosed\s+patio\b/i.test(quoteText)
  ) {
    setPricingFact("enclosedPatioProfile", "mixed_or_uncertain");
  } else if (
    canCapturePricingFacts &&
    /\bno\s+(?:enclosed|screened)?\s*patio\b/i.test(quoteText)
  ) {
    setPricingFact("enclosedPatioProfile", "none");
  }
  const stories = quoteText.match(/\b([123]|one|two|three)[ -]stor(?:y|ies)\b/i)
    ?.[1];
  if (canCapturePricingFacts && stories) {
    setPricingFact(
      "stories",
      ({
        one: 1,
        two: 2,
        three: 3,
      } as Record<string, number>)[
        stories.toLowerCase()
      ] ?? Number(stories),
    );
  }
  if (Object.keys(patch).length > 0) {
    const simulatedFields = { ...session.fields, ...patch };
    const advancedLeafChanged = [
      "hardWaterStains",
      "frenchPanes",
      "ladderWork",
      "screenProfile",
      "enclosedPatioProfile",
    ].some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    if (advancedLeafChanged) {
      const requiresAdvanced = requiresAdvancedWindowConditions(
        simulatedFields,
      );
      if (
        requiresAdvanced && session.fields.advancedWindowConditions !== true
      ) {
        patch.advancedWindowConditions = true;
        markAdvancedConditionsDerived = true;
      } else if (
        !requiresAdvanced && preTurnRequiresAdvancedConditions &&
        session.fields.advancedWindowConditions !== false
      ) {
        patch.advancedWindowConditions = false;
        markAdvancedConditionsDerived = true;
      }
    }
    session = mergeFields(session, patch, {
      markDerived: markAdvancedConditionsDerived
        ? ["advancedWindowConditions"]
        : [],
    });
    if (clearLadderCount) {
      clearCapturedField(session, "ladderAffectedWindowEquivalents");
    }
    if (clearHardWaterCount) {
      clearCapturedField(session, "hardWaterAffectedWindowEquivalents");
    }
  }
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

export function applyApprovedWindowDefaults(
  session: QuoteSession,
): QuoteSession {
  const services = (session.fields.services ?? []).map((service) =>
    normalizeServiceId(service) ?? service
  );
  if (services.length !== 1 || services[0] !== "window_cleaning") {
    return session;
  }
  if (session.fields.customerType === "commercial") return session;
  if (
    session.fields.windowCleaningScope &&
    session.fields.windowCleaningScope !== "whole_home"
  ) return session;
  const defaults = VOICE_QUOTE_POLICY.approvedWindowAssumptions;
  const patch: Partial<QuoteSessionFields> = {};
  const derived: (keyof QuoteSessionFields)[] = [];
  if (
    session.fields.advancedWindowConditions === undefined &&
    requiresAdvancedWindowConditions(session.fields)
  ) {
    patch.advancedWindowConditions = true;
    derived.push("advancedWindowConditions");
  }
  const defaulted: (keyof QuoteSessionFields)[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (
      (session.fields as Record<string, unknown>)[key] === undefined &&
      (patch as Record<string, unknown>)[key] === undefined
    ) {
      (patch as Record<string, unknown>)[key] = value;
      defaulted.push(key as keyof QuoteSessionFields);
    }
  }
  patch.voiceJourney = {
    ...(session.fields.voiceJourney ?? {}),
    policyVersion: VOICE_QUOTE_POLICY.version,
  };
  return mergeFields(session, patch, {
    markDefaulted: defaulted,
    markDerived: derived,
  });
}

export function nextExpressPrePriceField(session: QuoteSession): string | null {
  const services = session.fields.services ?? [];
  if (services.length === 0) return "services";
  if (
    !services.some((service) =>
      service === "window_cleaning" || service === "windowCleaning"
    )
  ) return null;
  if (!session.fields.squareFootage) return "squareFootage";
  // Ordinary whole-home, window-only callers hear both canonical package
  // totals before selecting a package. The pricing engine still requires a
  // side selection for the final firm quote; only the question order changes.
  if (
    !session.fields.windowCleaningSides &&
    !mayPresentWholeHomeWindowPackageOptions(session)
  ) return "windowCleaningSides";
  if (
    session.fields.ladderWork && !session.fields.ladderAffectedWindowEquivalents
  ) {
    return "ladderAffectedWindowEquivalents";
  }
  if (
    session.fields.hardWaterStains &&
    !session.fields.hardWaterAffectedWindowEquivalents
  ) {
    return "hardWaterAffectedWindowEquivalents";
  }
  return null;
}

/** True only for the owner-approved two-package whole-home voice presentation.
 * Partial, commercial, multi-service, and non-express requests retain the
 * canonical side-before-price intake contract. */
export function mayPresentWholeHomeWindowPackageOptions(
  session: QuoteSession,
): boolean {
  if (
    session.fields.voiceJourney?.policyVersion !== VOICE_QUOTE_POLICY.version
  ) {
    return false;
  }
  const services = (session.fields.services ?? [])
    .map((service) => normalizeServiceId(service) ?? service);
  return services.length === 1 && services[0] === "window_cleaning" &&
    session.fields.customerType !== "commercial" &&
    (session.fields.windowCleaningScope === undefined ||
      session.fields.windowCleaningScope === "whole_home");
}

/** Parse only an answer to the already-spoken two-package choice. This helper
 * is never used for generic confirmations, booking, or provider actions. */
export function classifyWholeHomeWindowPackageChoice(
  text: string,
): QuoteSessionFields["windowCleaningSides"] | null {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return null;
  const insideOutside =
    /\b(?:inside\s+(?:and|&)\s+outside|both\s+(?:inside\s+and\s+outside|sides)|full(?:\s+service)?|first(?:\s+(?:one|option|package))?)\b/i;
  const outsideOnly =
    /\b(?:(?:outside|exterior)(?:\s+(?:only|windows?))?|second(?:\s+(?:one|option|package))?)\b/i;
  const first = insideOutside.test(value);
  const second = outsideOnly.test(value);
  return first === second
    ? null
    : first
    ? "inside_and_outside"
    : "outside_only";
}

export function hasVolunteeredDiscountCodeCue(text: string): boolean {
  return /\b(?:coupon|discount|promo)\s+(?:code\b|is\b|:)/i.test(text) ||
    /\b(?:code)\s+(?:is\s+)?[a-z0-9_-]/i.test(text);
}

export function normalizeVolunteeredDiscountCode(text: string): string | null {
  const normalized = String(text ?? "").replaceAll("’", "'");
  if (
    /\b(?:no|not|without|do\s+not|don't|dont)\b[^.;!?]{0,32}\b(?:coupon|discount|promo)\b/i
      .test(normalized)
  ) {
    return null;
  }
  const match = normalized.match(
    /\b(?:coupon|discount|promo)\s+(?:code\s+)?(?:is\s+|:)?([a-z0-9]{3,20})(?![-_\s.][a-z0-9])\b/i,
  ) ?? normalized.match(
    /\bcode\s+(?:is\s+|:)?([a-z0-9]{3,20})(?![-_\s.][a-z0-9])\b/i,
  );
  if (!match) return null;
  return normalizeAuthoritativeDiscountCode(match[1]);
}
