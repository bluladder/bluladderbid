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
  | "responsibid"
  | "escalation_sender";

export interface PhoneEntry {
  purpose: PhonePurpose;
  e164: string;
  display: string;
  label: string;
  isPublic: boolean;
}

export const PHONE_FALLBACK: Record<PhonePurpose, PhoneEntry> = {
  primary_public: { purpose: "primary_public", e164: "+14697472877", display: "(469) 747-2877", label: "BluLadder", isPublic: true },
  app_ai: { purpose: "app_ai", e164: "+14697472877", display: "(469) 747-2877", label: "BluLadder Bid", isPublic: false },
  responsibid: { purpose: "responsibid", e164: "+14692426556", display: "(469) 242-6556", label: "ResponsiBid", isPublic: false },
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
