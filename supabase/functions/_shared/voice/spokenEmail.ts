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

const SPOKEN_TLD_WORDS: Record<string, string> = {
  com: "com",
  net: "net",
  org: "org",
  edu: "edu",
  gov: "gov",
  io: "io",
  co: "co",
  us: "us",
};

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
export function parseSpokenEmail(text: string | null | undefined): string | null {
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
  const spoken = despeak(raw);
  const at = spoken.split("@");
  if (at.length === 2) {
    let local = at[0];
    local = local.replace(
      /.*\b(?:e-?mail(?:\s+address)?|address|it|its|it's|that|use|is|to|send)\b/g,
      " ",
    );
    const localJoined = local.trim().replace(/[^a-z0-9._%+-\s]/g, "").replace(
      /\s+/g,
      "",
    );
    const domainParts: string[] = [];
    let current = "";
    for (const tok of at[1].trim().split(/\s+/)) {
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
