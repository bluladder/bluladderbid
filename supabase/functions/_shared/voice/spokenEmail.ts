// ============================================================================
// spokenEmail.ts — deterministic email extraction from a voice turn.
//
// The quote-by-text rail needs a real email to persist a canonical quote
// (`customers.email` is NOT NULL and `save-quote` resolves the customer by
// email). Callers rarely spell an address cleanly, and ASR renders it as
// "ben at bluladder dot com". This module converts the common spoken forms into
// a normal address WITHOUT guessing: anything it cannot map confidently
// resolves to null so the rail re-asks instead of writing the wrong identity.
// ============================================================================

/** Words that are never part of a spoken local part. */
const FILLER = new Set([
  "my",
  "me",
  "mine",
  "the",
  "is",
  "its",
  "it",
  "thats",
  "that",
  "this",
  "email",
  "e-mail",
  "mail",
  "address",
  "use",
  "using",
  "send",
  "sent",
  "to",
  "you",
  "can",
  "sure",
  "yeah",
  "yes",
  "ok",
  "okay",
  "so",
  "and",
  "well",
  "please",
  "im",
  "am",
  "at",
]);

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Expand the spoken separators ("at", "dot", "underscore", ...) in place. */
function despeak(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/[,!?;]/g, " ");
  t = t.replace(/\s+at\s+the\s+rate\s+of\s+/g, " @ ");
  t = t.replace(/\s+(?:at sign|at-sign|atsign)\s+/g, " @ ");
  t = t.replace(/\s+at\s+/g, " @ ");
  t = t.replace(/\s+(?:dot|period|point)\s+/g, " . ");
  t = t.replace(/\s+(?:dash|hyphen|minus)\s+/g, " - ");
  t = t.replace(/\s+(?:underscore|under score)\s+/g, " _ ");
  t = t.replace(/\s+plus\s+/g, " + ");
  return t;
}

/**
 * Extract a single email address from a spoken/typed turn.
 * Returns a lowercase address, or null when nothing unambiguous is present or
 * when the turn appears to contain more than one distinct candidate.
 */
export function parseSpokenEmail(
  text: string | null | undefined,
): string | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  const candidates = new Set<string>();

  // 1. Already-written addresses.
  for (const m of raw.toLowerCase().matchAll(new RegExp(EMAIL_RE, "gi"))) {
    candidates.add(m[0]);
  }

  // 2. Spoken form: collapse the separator words, drop the leading filler
  //    ("my email is", "it's", "you can use"), then squeeze the spaces ASR
  //    sprinkles inside the local part and the domain labels.
  const spoken = despeak(raw).replace(/['\u2019]/g, "");
  const lastAt = spoken.lastIndexOf("@");
  // Two separate spoken addresses in one turn are ambiguous: re-ask instead of
  // stitching them into one nonsense address.
  const ambiguous = (spoken.match(/@/g) ?? []).length > 1 &&
    /\s(?:or|and)\s/.test(spoken);
  if (lastAt > 0 && !ambiguous) {
    const localTokens = spoken.slice(0, lastAt).trim().split(/\s+/).filter((
      tok,
    ) => tok && !FILLER.has(tok));
    const localJoined = localTokens.join("").replace(/[^a-z0-9._%+-]/g, "");
    const domainParts: string[] = [];
    let current = "";
    for (const tok of spoken.slice(lastAt + 1).trim().split(/\s+/)) {
      if (tok === ".") {
        if (current) domainParts.push(current);
        current = "";
        continue;
      }
      if (!/^[a-z0-9-]+$/.test(tok)) break;
      current += tok;
    }
    if (current) domainParts.push(current);
    const domain = domainParts.filter(Boolean).join(".");
    const joined = `${localJoined}@${domain}`;
    if (EMAIL_RE.test(joined)) candidates.add(joined.toLowerCase());
  }

  if (candidates.size !== 1) return null;
  const only = [...candidates][0];
  // Final structural guard: exactly one "@", a dotted domain, real TLD length.
  if ((only.match(/@/g) ?? []).length !== 1) return null;
  const [local, domain] = only.split("@");
  if (!local || local.length > 64) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) return null;
  if (labels[labels.length - 1].length < 2) return null;
  return only;
}

const SPOKEN_EMAIL_DIGITS: Readonly<Record<string, string>> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
};

const SPOKEN_EMAIL_SYMBOLS: Readonly<Record<string, string>> = {
  ".": "Dot",
  "_": "Underscore",
  "-": "Dash",
  "+": "Plus",
};

/**
 * Spell one email side with explicit punctuation pauses. This is deliberately
 * verbose: a customer must be able to hear and correct the durable identity
 * before a quote or booking is associated with it.
 */
function spellEmailSide(value: string): string {
  const phrases: string[] = [];
  let alphanumeric: string[] = [];
  const flush = () => {
    if (!alphanumeric.length) return;
    phrases.push(alphanumeric.join(", "));
    alphanumeric = [];
  };
  for (const character of value) {
    if (/[a-z]/i.test(character)) {
      alphanumeric.push(character.toUpperCase());
      continue;
    }
    if (/\d/.test(character)) {
      alphanumeric.push(SPOKEN_EMAIL_DIGITS[character]);
      continue;
    }
    const symbol = SPOKEN_EMAIL_SYMBOLS[character];
    if (symbol) {
      flush();
      phrases.push(symbol);
    }
  }
  flush();
  return phrases.join(". ");
}

/** Deliberate, character-by-character readback for explicit confirmation. */
export function buildSpokenEmailReadback(email: string): string {
  const safe = String(email ?? "").trim().toLowerCase();
  const [local = "", domain = ""] = safe.split("@");
  return `I heard the email as: ${spellEmailSide(local)}. At. ${
    spellEmailSide(domain)
  }. Is that exactly right?`;
}
