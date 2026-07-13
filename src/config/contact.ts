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
  | 'responsibid' // ResponsiBid integration ONLY — never the primary contact
  | 'escalation_sender';

export interface PhoneEntry {
  purpose: PhonePurpose;
  e164: string;
  display: string;
  label: string;
  /** Safe to show to customers as a contact number. */
  isPublic: boolean;
}

/** Approved fallback mapping. Mirrors the seeded `phone_numbers` rows. */
export const PHONE_FALLBACK: Record<PhonePurpose, PhoneEntry> = {
  primary_public: {
    purpose: 'primary_public',
    e164: '+18662422583',
    display: '(866) 242-2583',
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
  responsibid: {
    purpose: 'responsibid',
    e164: '+14692426556',
    display: '(469) 242-6556',
    label: 'ResponsiBid',
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
