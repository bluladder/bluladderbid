// ============================================================================
// voiceAddressGate.ts — deterministic VOICE-ONLY address confirmation gate.
//
// A geocoded candidate never becomes booking / availability / text-delivery
// eligible until the caller explicitly confirms the complete canonical
// address. The readback spells the street and reads the house number digit by
// digit, because ASR routinely mangles both (incident 019fb423: "5610" was
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
  status?: "pending" | "confirmed" | "house_number_mismatch";
  /** The confirmed canonical address, once confirmed. */
  confirmedAddress?: string | null;
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

/** Split "5612 Binbranch Lane, McKinney, TX 75071" for a spoken readback. */
export function buildAddressReadback(formatted: string): string {
  const segs = String(formatted ?? "").split(",").map((s) => s.trim()).filter(
    Boolean,
  );
  const street = segs[0] ?? "";
  const tail = segs.slice(1).join(", ");
  const words = street.split(/\s+/).filter(Boolean);
  const house = houseNumberOf(street);
  const body = house ? words.slice(1) : words;
  const suffix = body.length > 1 ? body[body.length - 1] : "";
  const name = (body.length > 1 ? body.slice(0, -1) : body).join(" ");
  const parts: string[] = [];
  if (house) parts.push(speakDigits(house));
  if (name) parts.push(`${name}, spelled ${spellOut(name)}`);
  if (suffix) parts.push(suffix);
  const spoken = [parts.join(" "), tail].filter(Boolean).join(", ");
  return `I have ${spoken}. Is that exactly right?`;
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
