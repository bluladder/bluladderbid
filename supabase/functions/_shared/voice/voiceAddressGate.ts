// ============================================================================
// voiceAddressGate.ts — deterministic VOICE-ONLY address confirmation gate.
//
// A geocoded candidate never becomes booking / availability / text-delivery
// eligible until the caller explicitly confirms the complete canonical
// address. The readback preserves the canonical street wording and reads the
// house number digit by digit, because ASR routinely mangles both (incident 019fb423: "5610" was
// persisted when the caller said "5612").
//
// Pure module — no I/O. Web and SMS behavior is unaffected.
// ============================================================================

export interface VoiceAddressCandidate {
  /** Canonical formatted address returned by the geocoder. */
  formattedAddress?: string;
  /** Raw address string the caller gave us. */
  spokenAddress?: string;
  /** "pending" until the caller says yes; then "confirmed". */
  status?:
    | "pending"
    | "confirmed"
    | "house_number_mismatch"
    | "component_incomplete";
  /** The confirmed canonical address, once confirmed. */
  confirmedAddress?: string | null;
  components?: VoiceAddressComponents;
  pendingComponent?: AddressComponentName | null;
  componentAttempts?: Partial<Record<AddressComponentName, number>>;
}

export interface VoiceAddressComponents {
  house_number?: string;
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  postal_code?: string;
}

export type AddressComponentName = keyof VoiceAddressComponents;

export const MAX_ADDRESS_COMPONENT_ATTEMPTS = 2;

export function recordAddressComponentAttempt(
  candidate: VoiceAddressCandidate,
  component: AddressComponentName,
): VoiceAddressCandidate {
  return {
    ...candidate,
    componentAttempts: {
      ...(candidate.componentAttempts ?? {}),
      [component]: (candidate.componentAttempts?.[component] ?? 0) + 1,
    },
  };
}

export function addressComponentAttemptsExhausted(
  candidate: VoiceAddressCandidate,
  component: AddressComponentName,
): boolean {
  return (candidate.componentAttempts?.[component] ?? 0) >=
    MAX_ADDRESS_COMPONENT_ATTEMPTS;
}

const COMPONENT_ORDER: readonly AddressComponentName[] = [
  "house_number",
  "street",
  "city",
  "state",
  "postal_code",
];

export function addressComponentsFromServiceAreaResult(
  result: Record<string, unknown> | null | undefined,
): VoiceAddressComponents {
  return {
    house_number: typeof result?.streetNumber === "string"
      ? result.streetNumber
      : undefined,
    street: typeof result?.route === "string" ? result.route : undefined,
    city: typeof result?.city === "string" ? result.city : undefined,
    state: typeof result?.state === "string" ? result.state : undefined,
    postal_code: typeof result?.postalCode === "string"
      ? result.postalCode
      : undefined,
  };
}

export function nextMissingAddressComponent(
  components: VoiceAddressComponents,
): AddressComponentName {
  return COMPONENT_ORDER.find((key) => !components[key]?.trim()) ?? "street";
}

export function addressComponentQuestion(
  component: AddressComponentName,
): string {
  switch (component) {
    case "house_number":
      return buildHouseNumberQuestion();
    case "street":
      return "I have the other address details. What is the street name, including Street, Road, Drive, or Lane?";
    case "unit":
      return "What is the apartment, suite, or unit number?";
    case "city":
      return "I have the street. What city is the property in?";
    case "state":
      return "What state is the property in?";
    case "postal_code":
      return "What is the five-digit ZIP code for that address?";
  }
}

export function normalizeAddressComponentAnswer(
  component: AddressComponentName,
  utterance: string,
): string | null {
  const raw = String(utterance ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  if (component === "house_number") return parseSpokenHouseNumber(raw);
  if (component === "postal_code") {
    const numeric = raw.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
    if (numeric) return numeric;
    const spoken = parseSpokenHouseNumber(raw);
    return spoken?.length === 5 ? spoken : null;
  }
  if (component === "state") {
    if (/\b(texas|tx)\b/i.test(raw)) return "TX";
    return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
  }
  if (component === "city") {
    const explicit = raw.match(
      /\bcity(?:\s+is)?\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,2})(?:[,.!?]|$)/i,
    )?.[1];
    const value = (explicit ?? raw).replace(/[.!?]+$/, "").trim();
    if (/^(?:the\s+)?city$/i.test(value)) return null;
    return /^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,2}$/
        .test(value)
      ? value
      : null;
  }
  if (component === "unit") return raw.length <= 20 ? raw : null;
  if (component === "street") {
    const direct = raw.replace(
      /^(?:no[, ]+)?(?:the\s+)?street(?:\s+name)?(?:\s+is)?\s+/i,
      "",
    ).replace(/[.!?]+$/, "").trim();
    const corrected = raw.match(
      /\b([A-Za-z][A-Za-z'’-]{1,40})\s+(?:not|instead of)\s+[A-Za-z][A-Za-z'’-]{1,40}/i,
    )?.[1];
    const letters = [...raw.matchAll(
      /\b([A-Za-z])\s+(?:as\s+in|for|like)\s+[A-Za-z][A-Za-z'’-]*/gi,
    )].map((match) => match[1]);
    const suffixMatches = [...raw.matchAll(
      /\b(street|st|road|rd|drive|dr|lane|ln|court|ct|avenue|ave|boulevard|blvd|way|circle|cir|trail|trl|parkway|pkwy)\b/gi,
    )];
    // A spelling phrase may contain a suffix-shaped example ("R as in road").
    // The actual suffix is the final suffix token supplied by the caller.
    const suffix = suffixMatches.at(-1)?.[1];
    if (letters.length >= 3) {
      const spelled = letters.join("");
      return [
        spelled.charAt(0).toUpperCase() + spelled.slice(1).toLowerCase(),
        suffix ? expandStreetSuffix(suffix) : "",
      ].filter(Boolean).join(" ");
    }
    if (corrected) {
      return [corrected, suffix ? expandStreetSuffix(suffix) : ""]
        .filter(Boolean).join(" ");
    }
    if (direct !== raw && direct.length <= 80) return direct;
  }
  return raw.length <= 80 && !/@/.test(raw) ? raw : null;
}

export function formatAddressComponents(
  components: VoiceAddressComponents,
): string {
  const street = [components.house_number, components.street]
    .filter(Boolean).join(" ");
  const unit = components.unit ? `, ${components.unit}` : "";
  const locality = [components.city, components.state, components.postal_code]
    .filter(Boolean).join(" ");
  return `${street}${unit}${locality ? `, ${locality}` : ""}`.trim();
}

const DIGITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
};

/**
 * Spoken street-suffix abbreviations expanded for pronunciation. TTS reads
 * "Ln" as "linn" and "Dr" as "doctor"; the readback must say the real word.
 */
const SUFFIX_EXPANSIONS: Record<string, string> = {
  ln: "Lane",
  st: "Street",
  rd: "Road",
  dr: "Drive",
  ave: "Avenue",
  av: "Avenue",
  blvd: "Boulevard",
  ct: "Court",
  cir: "Circle",
  pl: "Place",
  pkwy: "Parkway",
  hwy: "Highway",
  trl: "Trail",
  ter: "Terrace",
  way: "Way",
  sq: "Square",
  cv: "Cove",
  xing: "Crossing",
  loop: "Loop",
  run: "Run",
};

export function expandStreetSuffix(suffix: string): string {
  const key = String(suffix ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return SUFFIX_EXPANSIONS[key] ??
    (suffix ? suffix.charAt(0).toUpperCase() + suffix.slice(1) : suffix);
}

/**
 * Read a house number out of a caller utterance, accepting both digits
 * ("5612") and the digit-by-digit spoken form ("five six one two").
 */
export function parseSpokenHouseNumber(utterance: string): string | null {
  const raw = String(utterance ?? "");
  const numeric = raw.match(/\b(\d{2,6})\b/);
  if (numeric) return numeric[1];
  const tokens = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let best = "";
  let run = "";
  for (const t of tokens) {
    const d = /^\d$/.test(t) ? t : DIGIT_WORDS[t];
    if (d === undefined) {
      if (run.length > best.length) best = run;
      run = "";
      continue;
    }
    run += d;
  }
  if (run.length > best.length) best = run;
  return best.length >= 2 ? best : null;
}

/** Swap ONLY the leading house number of an address, leaving the rest intact. */
export function replaceHouseNumber(
  address: string,
  houseNumber: string,
): string {
  const a = String(address ?? "").trim();
  if (!a) return houseNumber;
  if (/^\d{1,6}\b/.test(a)) return a.replace(/^\d{1,6}\b/, houseNumber);
  return `${houseNumber} ${a}`;
}

export function spellOut(word: string): string {
  return word.replace(/[^A-Za-z]/g, "").toUpperCase().split("").join("-");
}

export function speakDigits(value: string): string {
  return value.replace(/\D/g, "").split("").map((d) => DIGITS[Number(d)]).join(
    "-",
  );
}

export function houseNumberOf(
  address: string | null | undefined,
): string | null {
  const m = String(address ?? "").trim().match(/^(\d{1,6})\b/);
  return m ? m[1] : null;
}

/** Build one concise confirmation while reading the house number digit by digit. */
export function buildAddressReadback(formatted: string): string {
  const segs = String(formatted ?? "").split(",").map((s) => s.trim()).filter(
    Boolean,
  );
  const street = segs[0] ?? "";
  const remainder = segs.slice(1);
  const unit =
    remainder.find((segment) =>
      /^(?:apt|apartment|unit|suite|#)\b/i.test(segment)
    ) ?? "";
  const city =
    remainder.find((segment) =>
      segment !== unit && !/^[A-Z]{2}\b(?:\s+\d{5})?/i.test(segment)
    ) ?? "";
  const words = street.split(/\s+/).filter(Boolean);
  const house = houseNumberOf(street);
  const body = house ? words.slice(1) : words;
  const suffix = body.length > 1
    ? expandStreetSuffix(body[body.length - 1])
    : "";
  const name = (body.length > 1 ? body.slice(0, -1) : body).join(" ");
  const parts: string[] = [];
  if (house) parts.push(speakDigits(house));
  if (name) parts.push(name);
  if (suffix) parts.push(suffix);
  const conciseStreet = [parts.join(" "), unit].filter(Boolean).join(", ") ||
    street || formatted;
  return `I found ${conciseStreet}${
    city ? ` in ${city}` : ""
  }. Is that correct?`;
}

/** Ask for the house number one digit at a time (mismatch recovery). */
export function buildHouseNumberQuestion(): string {
  return "I want to get the house number exactly right. Can you read me the house number one digit at a time?";
}

export type AddressConfirmationAnswer = "yes" | "no" | "unclear";

const YES =
  /\b(yes|yeah|yep|yup|correct|that'?s right|that is right|exactly|right|affirmative|perfect|sounds right)\b/i;
const NO =
  /\b(no|nope|not right|incorrect|wrong|that'?s not|negative|change it|it'?s actually|should be)\b/i;

export function classifyAddressConfirmation(
  utterance: string,
): AddressConfirmationAnswer {
  const t = String(utterance ?? "").trim();
  if (!t) return "unclear";
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return "unclear";
}

export interface VoiceAddressGateDecision {
  kind: "confirmed" | "ask_confirmation" | "ask_house_number";
  reply: string;
  event: string;
  /** Persisted service_area_status. Never "eligible" before confirmation. */
  serviceAreaStatus: "eligible" | "pending_confirmation";
}

/**
 * Decide what must happen with a freshly geocoded VOICE candidate. The gate
 * fails closed: anything other than an explicit confirmation keeps the
 * candidate out of eligibility.
 */
export function planVoiceAddressGate(input: {
  formattedAddress: string | null | undefined;
  spokenAddress: string | null | undefined;
  alreadyConfirmedAddress?: string | null;
}): VoiceAddressGateDecision {
  const formatted = String(input.formattedAddress ?? "").trim();
  if (
    formatted && input.alreadyConfirmedAddress &&
    formatted.toLowerCase() ===
      input.alreadyConfirmedAddress.trim().toLowerCase()
  ) {
    return {
      kind: "confirmed",
      reply: "",
      event: "voice_address_already_confirmed",
      serviceAreaStatus: "eligible",
    };
  }
  const spokenHouse = houseNumberOf(input.spokenAddress);
  const geocodedHouse = houseNumberOf(formatted);
  if (spokenHouse && geocodedHouse && spokenHouse !== geocodedHouse) {
    return {
      kind: "ask_house_number",
      reply: buildHouseNumberQuestion(),
      event: "voice_address_house_number_mismatch",
      serviceAreaStatus: "pending_confirmation",
    };
  }
  return {
    kind: "ask_confirmation",
    reply: buildAddressReadback(formatted),
    event: "voice_address_confirmation_required",
    serviceAreaStatus: "pending_confirmation",
  };
}
