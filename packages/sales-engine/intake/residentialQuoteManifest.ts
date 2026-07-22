// ============================================================================
// residentialQuoteManifest.ts — canonical intake manifest for the residential
// quote workflow. Runtime-neutral: no React, no Deno, no Supabase. Consumed by
// voice, web, SMS, and future channels.
//
// Separation of responsibilities (see packages/sales-engine/README.md):
//   - The canonical pricing engine decides whether enough information exists
//     to price (returns `missing[]`).
//   - THIS manifest decides *which question to ask next* — priority order and
//     the exact customer-facing wording that names the canonical field.
//
// Contact-first sequence for a NEW customer quote (owner directive, 2026-07):
//   1. name  →  2. mobile phone  →  3. pricing inputs  →  4. speak price
//   5. email (required before booking or unbooked proposal)  →  6. schedule
// ============================================================================

/** All intake field ids the residential quote workflow can ask about. */
export type ResidentialIntakeFieldId =
  | "contact_name"
  | "contact_phone"
  | "services"
  | "windowCleaningScope"
  | "squareFootage"
  | "windowCleaningSides"
  | "stories"
  | "windowCleaningCondition"
  | "contact_email"
  | "city"
  | "address";

export interface IntakeFieldSpec {
  id: ResidentialIntakeFieldId;
  /** Canonical customer-facing prompt. Names the exact field being captured. */
  prompt: string;
  /** Short label for admin/analytics surfaces. */
  label: string;
  /**
   * `missing[]` tokens returned by the canonical pricing engine that map to
   * THIS field. Used to translate engine readiness into the next question.
   */
  engineMissingTokens: string[];
  /**
   * Business purpose — one line, used for design reviews and analytics.
   * Every question must state why we ask it.
   */
  purpose: string;
}

/**
 * Priority order (contact-first). The workflow asks the *first* entry whose
 * field is not yet captured and is currently required. Later stages (email,
 * address) are gated by the workflow, not by pricing.
 */
export const RESIDENTIAL_INTAKE_MANIFEST: readonly IntakeFieldSpec[] = [
  {
    id: "contact_name",
    prompt: "May I get your first name so I can put this quote under it?",
    label: "Customer name",
    engineMissingTokens: [],
    purpose:
      "Personalizes the call and links the quote to the customer record before pricing.",
  },
  {
    id: "contact_phone",
    prompt:
      "What's the best mobile number to text your quote to, in case we get disconnected?",
    label: "Mobile phone",
    engineMissingTokens: [],
    purpose:
      "Guarantees quote delivery and preserves continuity if the call drops.",
  },
  {
    id: "services",
    prompt:
      "Which service would you like priced today — window cleaning, house wash, gutters, or something else?",
    label: "Requested services",
    engineMissingTokens: ["services"],
    purpose: "Selects which pricing rules the engine applies.",
  },
  {
    id: "windowCleaningScope",
    prompt:
      "Got it. Is this every window on the home, or a specific count of windows?",
    label: "Window cleaning scope",
    engineMissingTokens: [],
    purpose:
      "Routes to whole-home (sqft-based) or partial (per-window) pricing rules.",
  },
  {
    id: "squareFootage",
    prompt: "How many square feet is your home?",
    label: "Home square footage",
    engineMissingTokens: ["squareFootage"],
    purpose:
      "Highest-impact pricing input for whole-home residential window cleaning.",
  },
  {
    id: "windowCleaningSides",
    prompt:
      "Would you like exterior only, or full service inside and out?",
    label: "Interior vs exterior",
    engineMissingTokens: [],
    purpose: "Determines whether interior pricing applies in addition to exterior.",
  },
  {
    id: "stories",
    prompt: "How many stories is the home — one, two, or three?",
    label: "Stories",
    engineMissingTokens: ["stories"],
    purpose: "Applies the story modifier to the base per-sqft price.",
  },
  {
    id: "windowCleaningCondition",
    prompt:
      "Would you say the windows are regularly maintained, or heavily soiled with significant buildup?",
    label: "Window condition",
    // The canonical pricing engine treats `condition` as an optional modifier
    // (no `missing[]` token), but BluLadder Bid's web workflow always asks it
    // before quoting residential window cleaning. The residential FSM injects
    // this id via `additionallyRequired` when windowCleaning is selected so
    // voice matches web behavior without a voice-only required-field list.
    engineMissingTokens: [],
    purpose:
      "Selects the canonical condition modifier (maintenance vs heavy) already used by the web booking flow and pricing engine.",
  },
  {
    id: "contact_email",
    prompt:
      "What's the best email for me to send your quote and booking confirmation to?",
    label: "Email",
    engineMissingTokens: [],
    purpose:
      "Required before booking or finalizing an unbooked proposal so we can deliver confirmations and follow-ups.",
  },
  {
    id: "city",
    prompt: "Which city is the home in?",
    label: "City",
    engineMissingTokens: [],
    purpose:
      "Serviceability check. Not required to calculate a residential price unless the canonical engine asks.",
  },
  {
    id: "address",
    prompt: "What's the street address for the visit?",
    label: "Street address",
    engineMissingTokens: [],
    purpose:
      "Required for booking, availability, and drive-time routing — not for a rough quote.",
  },
] as const;

/** O(1) lookup by field id. */
export const RESIDENTIAL_INTAKE_BY_ID: Readonly<
  Record<ResidentialIntakeFieldId, IntakeFieldSpec>
> = Object.freeze(
  Object.fromEntries(
    RESIDENTIAL_INTAKE_MANIFEST.map((f) => [f.id, f]),
  ) as Record<ResidentialIntakeFieldId, IntakeFieldSpec>,
);

/** Priority order as an array of ids — convenience for callers that only need the sequence. */
export const RESIDENTIAL_INTAKE_PRIORITY: readonly ResidentialIntakeFieldId[] =
  RESIDENTIAL_INTAKE_MANIFEST.map((f) => f.id);

/**
 * Translate the canonical pricing engine's `missing[]` tokens into intake
 * field ids. Unknown tokens are ignored (the engine may add new tokens over
 * time; the manifest is the authority on which of those we surface as
 * questions). Duplicates removed; order preserved.
 */
export function fieldsForEngineMissing(
  missing: readonly string[],
): ResidentialIntakeFieldId[] {
  const out: ResidentialIntakeFieldId[] = [];
  for (const token of missing) {
    for (const spec of RESIDENTIAL_INTAKE_MANIFEST) {
      if (spec.engineMissingTokens.includes(token) && !out.includes(spec.id)) {
        out.push(spec.id);
      }
    }
  }
  return out;
}

/**
 * Decide the next question given (a) which fields are already captured and
 * (b) which fields the canonical pricing engine says are still required.
 *
 * Contract:
 *   - Contact-first fields (name, phone) are always asked before pricing.
 *   - Then pricing fields the engine flagged (translated via
 *     fieldsForEngineMissing) in manifest priority order.
 *   - `additionallyRequired` lets the workflow inject booking-stage fields
 *     (email, address) once the quote has been spoken.
 *   - A field is skipped if it appears in `captured`.
 *   - Returns null when nothing to ask.
 */
export function nextResidentialQuestion(args: {
  captured: readonly ResidentialIntakeFieldId[];
  engineMissing: readonly string[];
  additionallyRequired?: readonly ResidentialIntakeFieldId[];
}): IntakeFieldSpec | null {
  const capturedSet = new Set(args.captured);
  const required = new Set<ResidentialIntakeFieldId>([
    "contact_name",
    "contact_phone",
    ...fieldsForEngineMissing(args.engineMissing),
    ...(args.additionallyRequired ?? []),
  ]);
  for (const spec of RESIDENTIAL_INTAKE_MANIFEST) {
    if (required.has(spec.id) && !capturedSet.has(spec.id)) return spec;
  }
  return null;
}