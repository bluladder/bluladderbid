// ============================================================================
// phoneConfig.ts — server-side resolver for BluLadder phone numbers BY PURPOSE.
// The AI and edge functions must never hard-code a number; they ask for a
// purpose and get the admin-approved value from the `phone_numbers` table,
// falling back to the approved constants if the row is missing.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

export type PhonePurpose =
  | "primary_public"
  | "app_ai"
  | "escalation_sender";

export interface PhoneEntry {
  purpose: PhonePurpose;
  e164: string;
  display: string;
  label: string;
  isPublic: boolean;
}

// Numbers retired from active BluLadder Bid use. Kept as a redaction list so
// AI prompts, transcripts, and outbound copy can strip them defensively even
// if a stale knowledge row still contains them. They MUST NOT resolve as an
// active purpose (public, AI/SMS, transfer, booking, escalation).
export const RETIRED_PHONE_NUMBERS: ReadonlyArray<{ e164: string; display: string; reason: string }> = [
  {
    e164: "+14692426556",
    display: "(469) 242-6556",
    reason: "retired_responsibid",
  },
];

export const PHONE_FALLBACK: Record<PhonePurpose, PhoneEntry> = {
  primary_public: { purpose: "primary_public", e164: "+14697472877", display: "(469) 747-2877", label: "BluLadder", isPublic: true },
  app_ai: { purpose: "app_ai", e164: "+14697472877", display: "(469) 747-2877", label: "BluLadder Bid", isPublic: false },
  escalation_sender: { purpose: "escalation_sender", e164: "+14697472877", display: "(469) 747-2877", label: "BluLadder Bid", isPublic: false },
};

/** Resolve one phone number by purpose. Never guesses; falls back to approved constants. */
export async function getPhoneByPurpose(
  supabase: any,
  purpose: PhonePurpose,
): Promise<PhoneEntry> {
  try {
    const { data } = await supabase
      .from("phone_numbers")
      .select("purpose, e164, display_format, label, is_public, is_active")
      .eq("purpose", purpose)
      .eq("is_active", true)
      .maybeSingle();
    if (data) {
      // Belt-and-suspenders: refuse to hand back a retired number even if a
      // stale DB row somehow survives with is_active=true.
      const retired = RETIRED_PHONE_NUMBERS.some((r) => r.e164 === data.e164);
      if (retired) return PHONE_FALLBACK[purpose];
      return {
        purpose: data.purpose,
        e164: data.e164,
        display: data.display_format,
        label: data.label,
        isPublic: data.is_public,
      };
    }
  } catch {
    // fall through to constants
  }
  return PHONE_FALLBACK[purpose];
}

/** The customer-facing primary business number (for "call the office" copy). */
export async function getPrimaryPublicPhone(supabase: any): Promise<PhoneEntry> {
  return getPhoneByPurpose(supabase, "primary_public");
}
