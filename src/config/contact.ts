// ============================================================================
// contact.ts — the SINGLE source of truth for BluLadder contact endpoints on
// the client. Phone numbers must NOT be hard-coded anywhere else in the UI.
//
// The authoritative, admin-editable copy lives in the `phone_numbers` table
// (selected by PURPOSE, never guessed). These constants are the safe fallback
// used before the table loads, and they define the approved mapping so tests
// can assert the correct number is used for each purpose.
// ============================================================================

export type PhonePurpose =
  | 'primary_public' // General public / "Call BluLadder" / office escalation
  | 'app_ai' // BluLadder Bid app + AI-chat transactional texting
  | 'escalation_sender';

export interface PhoneEntry {
  purpose: PhonePurpose;
  e164: string;
  display: string;
  label: string;
  /** Safe to show to customers as a contact number. */
  isPublic: boolean;
}

// Numbers that were once wired into BluLadder Bid but have been retired from
// active use. They MUST NOT resolve as primary/public/AI/SMS/booking/transfer
// numbers. Kept only for defense-in-depth redaction in prompts and logs so a
// stale knowledge row or historical transcript cannot leak them.
export const RETIRED_PHONE_NUMBERS: ReadonlyArray<{ e164: string; display: string; reason: string }> = [
  {
    e164: '+14692426556',
    display: '(469) 242-6556',
    // Former ResponsiBid integration line. BluLadder Bid no longer uses it
    // for voice, SMS, transfer, booking, support, or public display.
    reason: 'retired_responsibid',
  },
];

/** Approved fallback mapping. Mirrors the seeded `phone_numbers` rows. */
export const PHONE_FALLBACK: Record<PhonePurpose, PhoneEntry> = {
  primary_public: {
    purpose: 'primary_public',
    // Customer-facing primary number. We publish the dedicated CallRail number
    // (also used for texting + voice AI) so every customer touchpoint shares a
    // single line. Do NOT reintroduce the 866 vanity number in public copy.
    e164: '+14697472877',
    display: '(469) 747-2877',
    label: 'BluLadder',
    isPublic: true,
  },
  app_ai: {
    purpose: 'app_ai',
    e164: '+14697472877',
    display: '(469) 747-2877',
    label: 'BluLadder Bid',
    isPublic: false,
  },
  escalation_sender: {
    purpose: 'escalation_sender',
    e164: '+14697472877',
    display: '(469) 747-2877',
    label: 'BluLadder Bid',
    isPublic: false,
  },
};

/** The customer-facing primary business contact. */
export const PRIMARY_PUBLIC_PHONE = PHONE_FALLBACK.primary_public;

export const SUPPORT_EMAIL = 'info@bluladder.com';

/** Build a `tel:` href from an E.164 number. */
export const telHref = (e164: string) => `tel:${e164}`;
