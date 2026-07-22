// ============================================================================
// Content layer for the "Evergreen Service Education Nurture" draft campaign.
//
// Six polished, timing-neutral educational emails paired with the existing
// campaign engine. This module is pure data + a pure renderer:
//
//   - No I/O.
//   - No delivery-infrastructure changes.
//   - No hard-coded seasonal deadlines. Copy must remain reasonable at any
//     point in the year (see FORBIDDEN_TIMING_PHRASES).
//
// The renderer output is stored on each step's `body_template` / `subject`
// so the existing campaign-event -> sms_messages -> Resend pipeline sends it
// unchanged. Per-step editable fields (subject, body, CTA, optional article)
// live in `sms_campaign_steps.content_config`.
// ============================================================================

export const EVERGREEN_EDUCATION_CAMPAIGN_ID =
  "55555555-5555-4555-9555-555555555555";

export const EVERGREEN_EDUCATION_PLACEHOLDER_PREFIX = "evergreen_edu_";

/** Editable content fields stored in `sms_campaign_steps.content_config`. */
export interface EducationalStepContent {
  placeholder_id: string;
  subject: string;
  /** Email body (plain text, may contain mustache variables like {{customer_first_name}}). */
  body: string;
  cta_label: string;
  cta_url: string;
  /** Optional approved BluLadder.com article/guide. */
  article_title?: string;
  article_url?: string;
  article_description?: string;
  /** Copy used when no article is configured. Must always be present. */
  fallback_copy: string;
}

/**
 * Phrases that would tie evergreen educational copy to a fixed moment in the
 * year. Guarded by tests so no touch can silently regress into seasonal
 * language. Christmas-light content is especially at risk of drifting into
 * "this fall" / month-name framing.
 */
export const FORBIDDEN_TIMING_PHRASES: readonly string[] = [
  "this fall",
  "this month",
  "this week",
  "this year",
  "this spring",
  "this summer",
  "this winter",
  "next month",
  "hurry",
  "limited time",
  "deadline",
  "spots left",
  "act now",
  "january",
  "february",
  "march",
  "april",
  "may ",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "black friday",
  "cyber monday",
  "labor day",
  "memorial day",
];

const CTA_HOME = "https://bid.bluladder.com/";
const CTA_WINDOWS = "https://bid.bluladder.com/?service=window_cleaning";
const CTA_WASHING = "https://bid.bluladder.com/?service=house_wash";
const CTA_GUTTERS = "https://bid.bluladder.com/?service=gutter_cleaning";
const CTA_MAINT = "https://bid.bluladder.com/?intent=maintenance_plan";
const CTA_CHRISTMAS = "https://bid.bluladder.com/?service=christmas_lights";

/**
 * Six evergreen touches. Timing (delay_hours) is owned by the campaign
 * foundation slice; this module only owns content. Each step is email-only.
 */
export const EVERGREEN_EDUCATION_STEPS: readonly EducationalStepContent[] = [
  {
    placeholder_id: "evergreen_edu_day_0",
    subject: "The visible difference professional window cleaning makes",
    body:
      "Hi {{customer_first_name}},\n\n" +
      "Most homeowners are surprised by how much light a professionally cleaned window returns to a room. It isn't just the glass — hard-water spots, tracks, sills and screens all contribute to that hazy, tired look that builds up so gradually it becomes invisible.\n\n" +
      "Our team uses purified-water systems on the exterior and hand-detailed interior work so glass is left streak-free from every angle. It's the kind of finish that photographs cleaner and holds up longer between visits.\n\n" +
      "Whenever you're ready to see the difference on your own home, we're here.",
    cta_label: "See what a BluLadder window cleaning includes",
    cta_url: CTA_WINDOWS,
    fallback_copy:
      "If you'd like to talk through what would make the biggest difference on your home, just reply to this email and our team will help.",
  },
  {
    placeholder_id: "evergreen_edu_day_60",
    subject: "What full-service window cleaning actually includes",
    body:
      "Hi {{customer_first_name}},\n\n" +
      "\"Window cleaning\" can mean very different things. When homeowners tell us a previous service didn't feel worth it, the reason is almost always the same — only the outside glass was touched.\n\n" +
      "A full-service BluLadder visit covers:\n" +
      "  • Interior and exterior glass, hand-detailed\n" +
      "  • Frames, tracks and sills wiped\n" +
      "  • Screens gently cleaned and re-seated\n" +
      "  • A final walk-through so nothing is missed\n\n" +
      "It's the kind of detail that keeps windows looking cared-for, not just rinsed.",
    cta_label: "Explore full-service window cleaning",
    cta_url: CTA_WINDOWS,
    fallback_copy:
      "If you'd like a plain-English breakdown of what's right for your home, reply and we'll walk you through it.",
  },
  {
    placeholder_id: "evergreen_edu_day_120",
    subject: "Soft washing vs. pressure washing: choosing the right method",
    body:
      "Hi {{customer_first_name}},\n\n" +
      "Pressure alone doesn't clean a house — technique does. High pressure is the right tool for concrete, driveways and hard flatwork. It is the wrong tool for siding, painted trim, soffits and roofing, where it can drive water behind surfaces and shorten the life of finishes.\n\n" +
      "For those surfaces we use soft washing: low-pressure application of professional cleaning solutions that lift organic growth and grime at the source, followed by a controlled rinse. The result is a deeper clean with less risk to the home.\n\n" +
      "Different surface, different method — that's the short version.",
    cta_label: "Learn how BluLadder cleans your home safely",
    cta_url: CTA_WASHING,
    fallback_copy:
      "If you're not sure which method your home actually needs, reply with a couple of photos and we'll tell you honestly.",
  },
  {
    placeholder_id: "evergreen_edu_day_200",
    subject: "Why gutters and exterior drainage matter more than they look",
    body:
      "Hi {{customer_first_name}},\n\n" +
      "Gutters are one of the least visible systems on a home and one of the most consequential. When they clog, water doesn't simply overflow — it backs up under shingles, saturates fascia, and drops close to the foundation instead of being carried away.\n\n" +
      "A routine gutter cleaning removes debris from the troughs, flushes the downspouts and confirms water is actually leaving the house. It's a small maintenance step that quietly protects a much larger investment.",
    cta_label: "Book a gutter cleaning and drainage check",
    cta_url: CTA_GUTTERS,
    fallback_copy:
      "If you've noticed overflow, staining behind the gutters, or water pooling near the foundation, reply and we'll take a look.",
  },
  {
    placeholder_id: "evergreen_edu_day_280",
    subject: "The quiet value of routine exterior-home maintenance",
    body:
      "Hi {{customer_first_name}},\n\n" +
      "Homes rarely fail all at once. They drift — a little organic growth on the siding, a little grit in the tracks, a slow-moving downspout — until one day the exterior looks tired and the repair list is long.\n\n" +
      "Homeowners on a routine exterior-maintenance rhythm tend to spend less overall, and their homes hold their appearance far longer between deep cleans. The point isn't to clean more often. It's to protect what's already there, on a cadence that fits the home.\n\n" +
      "We'd be glad to help you find that cadence for yours.",
    cta_label: "See recommended maintenance rhythms",
    cta_url: CTA_MAINT,
    fallback_copy:
      "Reply and tell us a little about your home — we'll suggest a maintenance rhythm that actually fits it.",
  },
  {
    placeholder_id: "evergreen_edu_day_365",
    subject: "Planning your Christmas lights: it's never too early to start",
    body:
      "Hi {{customer_first_name}},\n\n" +
      "Christmas-light installation looks simple from the curb and is anything but. The homes that come out best are the ones where the design was thought through well in advance — clip counts, power planning, roofline versus tree accents, and the small details that make an installation feel intentional instead of improvised.\n\n" +
      "It's never too early to start planning. Homeowners who reach out early tend to get exactly the look they want, without last-minute compromises on scale or materials.\n\n" +
      "Whenever you're ready to talk through what your home could look like, we're happy to help you plan it.",
    cta_label: "Start planning your Christmas lights",
    cta_url: CTA_CHRISTMAS,
    fallback_copy:
      "If you'd like our team to sketch out a plan for your home, reply and we'll get the conversation started.",
  },
] as const;

/** Compact BluLadder compliance footer appended to every rendered email. */
export const EVERGREEN_COMPLIANCE_FOOTER =
  "— The BluLadder Team\n" +
  "BluLadder Exterior Cleaning · Dallas–Fort Worth, TX\n" +
  "You're receiving this because you asked to hear from us. " +
  "Reply STOP to opt out of educational messages at any time.";

/**
 * Ensures no forbidden timing phrase appears in a text block. Case-insensitive.
 * Returns the list of phrases found (empty when the text is timing-neutral).
 */
export function findForbiddenTimingPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_TIMING_PHRASES.filter((p) => lower.includes(p));
}