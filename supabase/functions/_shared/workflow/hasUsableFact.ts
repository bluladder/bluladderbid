// ============================================================================
// hasUsableFact.ts — repeated-question prevention.
//
// A question may only be asked when hasUsableFact returns false. Normalizes
// equivalent customer answers before checking so "outside only", "exterior
// only" and "just the outside" all resolve to the same canonical value.
// ============================================================================

import type { QuoteSession, QuoteSessionFields } from "../quoteSession.ts";
import type { RequiredField } from "./types.ts";

const USABLE_STATUSES = new Set(["captured", "verified", "corrected", "derived"]);

function underlyingKey(field: RequiredField): keyof QuoteSessionFields | null {
  switch (field) {
    case "services": return "services";
    case "windowCleaningScope": return "windowCleaningScope";
    case "squareFootage": return "squareFootage";
    case "windowCleaningSides": return "windowCleaningSides";
    case "stories": return "stories";
    case "windowCleaningCondition": return "condition";
    case "address": return "address";
    case "city": return "city";
    case "contact_email": return "email";
    case "contact_phone": return "phone";
    case "contact_name": return "name";
  }
}

function isNonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

export function hasUsableFact(field: RequiredField, session: QuoteSession): boolean {
  const key = underlyingKey(field);
  if (!key) return false;
  const val = (session.fields as Record<string, unknown>)[key];
  if (!isNonEmpty(val)) return false;
  const status = session.fieldStatus[key as keyof QuoteSessionFields];
  if (!status) return true;
  return USABLE_STATUSES.has(status);
}

export function normalizeWindowSides(raw: string): "outside_only" | "inside_and_outside" | null {
  const s = raw.toLowerCase();
  if (/(inside\s*(and|&|\+)\s*outside|both\s*sides|interior\s*(and|&|\+)\s*exterior|full\s*service|inside\s*and\s*out)/.test(s)) {
    return "inside_and_outside";
  }
  if (/(outside|exterior)\s*(only|glass|surface|surfaces)?|just\s*(the\s*)?outsides?|only\s*outside/.test(s)) {
    return "outside_only";
  }
  return null;
}
