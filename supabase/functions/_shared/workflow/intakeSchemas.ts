// ============================================================================
// intakeSchemas.ts — LEGACY per-workflow required-field manifests.
//
// SUPERSEDED for the residential-quote path by the runtime-neutral Sales
// Engine manifest at packages/sales-engine/intake/residentialQuoteManifest.ts
// and the canonical pricing engine's `missing[]` (loadPricing + calculateQuote).
//
// The residential FSM no longer consults `missingResidentialPricingFields` or
// `RESIDENTIAL_QUESTION_PRIORITY`; both remain exported ONLY to preserve the
// existing Deno test surface until the follow-up consolidation slice retires
// them alongside the corresponding tests. Do not add new callers.
//
// `missingResidentialBookingFields` is still consumed as a legacy fallback
// after the shared manifest's post-quote booking questions run.
// ============================================================================

import type { QuoteSessionFields } from "../quoteSession.ts";
import type { RequiredField } from "./types.ts";

export const RESIDENTIAL_WINDOW_WHOLE_HOME_PRICING_FIELDS: RequiredField[] = [
  "services",
  "squareFootage",
  "windowCleaningSides",
  "stories",
];

export const RESIDENTIAL_BOOKING_FIELDS: RequiredField[] = [
  "address",
  "contact_email",
  "contact_phone",
  "contact_name",
];

export const RESIDENTIAL_QUESTION_PRIORITY: RequiredField[] = [
  "services",
  "windowCleaningScope",
  "squareFootage",
  "windowCleaningSides",
  "stories",
  "city",
  "address",
  "contact_name",
  "contact_email",
  "contact_phone",
];

export function missingResidentialPricingFields(f: QuoteSessionFields): RequiredField[] {
  const missing: RequiredField[] = [];
  const services = f.services ?? [];
  if (services.length === 0) missing.push("services");
  if (services.includes("windowCleaning") || services.includes("window_cleaning")) {
    if (!f.windowCleaningScope && f.squareFootage == null) missing.push("windowCleaningScope");
  }
  if (f.squareFootage == null) missing.push("squareFootage");
  if (!f.windowCleaningSides && !f.windowCleaningType) missing.push("windowCleaningSides");
  if (f.stories == null) missing.push("stories");
  return missing;
}

export function missingResidentialBookingFields(f: QuoteSessionFields): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!f.address) missing.push("address");
  if (!f.email) missing.push("contact_email");
  if (!f.phone) missing.push("contact_phone");
  if (!f.name) missing.push("contact_name");
  return missing;
}
