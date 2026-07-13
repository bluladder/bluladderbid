// ============================================================================
// First-class system-test suppression.
//
// This is the AUTHORITATIVE gate that prevents internal/system tests from ever
// delivering a real SMS, email or CallRail message. It is intentionally
// independent of opt-out records — an approved test identity must NEVER send,
// even if that person has no opt-out on file.
//
// Suppression triggers (any one of them):
//   1. Environment-level suppression (preview / staging / development).
//   2. A global administrator-controlled switch (system_test_config.suppress_all).
//   3. The recipient matches an approved, active test identity (normalized email
//      OR E.164 phone).
//
// It MUST be called immediately before delivery, not only at enrollment time.
// ============================================================================
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const t = String(raw).trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export function normalizePhoneE164(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export interface SuppressionResult {
  suppressed: boolean;
  reason: string | null;
}

// deno-lint-ignore no-explicit-any
export async function checkSuppression(
  supabase: any,
  target: { phone?: string | null; email?: string | null },
): Promise<SuppressionResult> {
  // 1) Environment-level suppression for non-production environments.
  const env = (
    Deno.env.get("LOVABLE_ENV") ||
    Deno.env.get("ENVIRONMENT") ||
    Deno.env.get("DENO_ENV") ||
    ""
  ).toLowerCase();
  if (env === "preview" || env === "staging" || env === "development" || env === "dev") {
    return { suppressed: true, reason: `environment:${env}` };
  }

  // 2) Global administrator-controlled suppression switch.
  try {
    const { data: cfg } = await supabase
      .from("system_test_config")
      .select("suppress_all, suppress_reason")
      .eq("id", "default")
      .maybeSingle();
    if (cfg?.suppress_all) {
      return { suppressed: true, reason: cfg.suppress_reason || "system_test_suppression_enabled" };
    }
  } catch {
    // A failed config read must not silently disable suppression of test
    // identities below, so we simply continue to the identity check.
  }

  // 3) Approved test identities (matched by normalized email OR E.164 phone).
  const email = normalizeEmail(target.email);
  const phone = normalizePhoneE164(target.phone);
  if (!email && !phone) return { suppressed: false, reason: null };

  try {
    const ors: string[] = [];
    if (email) ors.push(`email.eq.${email}`);
    if (phone) ors.push(`phone.eq.${phone}`);
    const { data } = await supabase
      .from("test_identities")
      .select("id")
      .eq("active", true)
      .or(ors.join(","))
      .limit(1);
    if (data && data.length > 0) {
      return { suppressed: true, reason: "test_identity" };
    }
  } catch {
    // ignore — absence of a match means not a known test identity
  }

  return { suppressed: false, reason: null };
}
