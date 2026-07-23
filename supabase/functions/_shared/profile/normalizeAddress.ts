// ============================================================================
// normalizeAddress — canonical, deterministic address key used for
// deduplicating properties. Not for display; the raw street/city/state/zip
// are stored alongside for humans.
// ============================================================================

const STREET_SUFFIX: Record<string, string> = {
  street: "st", str: "st", st: "st",
  avenue: "ave", ave: "ave", av: "ave",
  boulevard: "blvd", blvd: "blvd",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
  circle: "cir", cir: "cir",
  trail: "trl", trl: "trl",
  way: "way",
};

const DIRECTIONALS: Record<string, string> = {
  north: "n", n: "n",
  south: "s", s: "s",
  east: "e", e: "e",
  west: "w", w: "w",
  northeast: "ne", ne: "ne",
  northwest: "nw", nw: "nw",
  southeast: "se", se: "se",
  southwest: "sw", sw: "sw",
};

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  normalized: string;
}

/** Parse a "street, city, ST 12345" style string into components. Any
 * unparseable input still yields a stable normalized key from the raw text. */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const empty: ParsedAddress = { street: "", city: "", state: "", postalCode: "", normalized: "" };
  if (!raw) return empty;
  const cleaned = String(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return empty;
  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  let street = "", city = "", state = "", postalCode = "";
  if (parts.length >= 3) {
    street = parts[0];
    city = parts[1];
    const m = parts[2].match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?/);
    if (m) { state = m[1]; postalCode = m[2] ?? ""; }
  } else if (parts.length === 2) {
    street = parts[0];
    const m = parts[1].match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5})/);
    if (m) { city = m[1]; state = m[2]; postalCode = m[3]; } else city = parts[1];
  } else {
    street = parts[0];
  }
  const normalized = normalizeKey(street, city, state, postalCode);
  return { street, city, state: state.toUpperCase(), postalCode, normalized };
}

/** Canonical normalized key: lowercase, punctuation-free, common
 *  street-suffix and directional abbreviations, unit stripped. */
export function normalizeKey(street: string, city = "", state = "", postal = ""): string {
  const s = tokens(street).map(canonToken).filter(Boolean).join(" ");
  const c = tokens(city).join(" ");
  return [s, c, state.toLowerCase(), postal.replace(/\D/g, "").slice(0, 5)]
    .filter(Boolean).join("|");
}

function tokens(v: string): string[] {
  return v.toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
}

function canonToken(t: string): string {
  return STREET_SUFFIX[t] ?? DIRECTIONALS[t] ?? t;
}

/** True when two raw addresses resolve to the same normalized key. */
export function sameAddress(a: string | null, b: string | null): boolean {
  const na = parseAddress(a).normalized;
  const nb = parseAddress(b).normalized;
  return !!na && na === nb;
}