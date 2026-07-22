// ============================================================================
// intakeSchemas.ts — required-field manifests per workflow branch.
//
// Single source of truth for "ready to price?" / "ready to book?". The
// residential-quote FSM reads these and asks the next unfilled field in the
// listed priority order. Never introduces new pricing rules.
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
