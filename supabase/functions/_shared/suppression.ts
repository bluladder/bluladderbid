// ============================================================================
// First-class system-test suppression.
//
// AUTHORITATIVE gate that prevents synthetic/test/marketing traffic from ever
// delivering a real SMS or email. Independent of opt-outs — a protected test
// identity must NEVER receive an untriggered send.
//
// Suppression triggers, in priority order:
//   1. Environment-level suppression (preview / staging / development) — always.
//   2. Global administrator kill-switch (system_test_config.suppress_all) —
//      always, regardless of purpose. Explicit ops kill.
//   3. Recipient matches an approved, active test identity AND the caller did
//      NOT declare an allowlisted transactional purpose.
//
// Callers declare intent via `options.purpose`. Only a narrow allowlist of
// customer-triggered transactional purposes bypasses the identity gate.
// Marketing/campaign/synthetic paths pass no purpose and stay suppressed.
// Quote email/SMS additionally require `customerInitiated: true` so an
// automated follow-up cannot reuse the event type to escape the gate.
//
// This does NOT replace email_suppressions (hard bounce / complaint /
// unsubscribe) — that check runs inside sendEmail() and always overrides.
// It also does NOT replace SMS opt-out checks — those run in call sites.
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

// Canonical transactional purposes that MAY bypass the test-identity gate.
// Any new purpose here must be a direct response to a specific customer or
// booking event — never a broadcast, nurture, follow-up, or retry.
export type TransactionalPurpose =
  | "booking_confirmed"
  | "booking_updated"
  | "booking_cancelled"
  | "verification"            // portal OTP / phone verification
  | "quote_requested"         // customer-requested delivery of a quote
  | "contact_request_received"; // callback / "contact us" confirmation

const IDENTITY_ALLOWLIST: ReadonlySet<TransactionalPurpose> = new Set([
  "booking_confirmed",
  "booking_updated",
  "booking_cancelled",
  "verification",
  "quote_requested",
  "contact_request_received",
]);

// Purposes that MUST also be explicitly customer-initiated to bypass the
// identity gate. Prevents an automated campaign from reusing "quote_requested"
// to send to a protected identity.
const REQUIRES_CUSTOMER_INITIATED: ReadonlySet<TransactionalPurpose> = new Set([
  "quote_requested",
]);

export interface SuppressionOptions {
  /** Canonical transactional purpose; omit for campaigns/marketing/QA/synthetic. */
  purpose?: TransactionalPurpose;
  /** True only when the send is a direct response to an explicit customer action. */
  customerInitiated?: boolean;
}

/** Pure policy decision — given a matched test identity and options, is the
 *  send allowed through? Exported for direct unit testing. */
export function isPurposeAllowlisted(opts: SuppressionOptions | undefined): boolean {
  if (!opts?.purpose) return false;
  if (!IDENTITY_ALLOWLIST.has(opts.purpose)) return false;
  if (REQUIRES_CUSTOMER_INITIATED.has(opts.purpose) && !opts.customerInitiated) return false;
  return true;
}

// deno-lint-ignore no-explicit-any
export async function checkSuppression(
  supabase: any,
  target: { phone?: string | null; email?: string | null },
  options?: SuppressionOptions,
): Promise<SuppressionResult> {
  // 1) Environment-level suppression for non-production environments.
  //    Always blocks — never send real messages from preview/dev.
  const env = (
    Deno.env.get("LOVABLE_ENV") ||
    Deno.env.get("ENVIRONMENT") ||
    Deno.env.get("DENO_ENV") ||
    ""
  ).toLowerCase();
  if (env === "preview" || env === "staging" || env === "development" || env === "dev") {
    return { suppressed: true, reason: `environment:${env}` };
  }

  // 2) Global administrator kill-switch. Explicit ops kill — always blocks,
  //    regardless of purpose. Owners must turn this off to send anything.
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
    // Fall through to identity check — a failed config read must not silently
    // disable the identity gate.
  }

  // 3) Approved test identities (matched by normalized email OR E.164 phone).
  //    An allowlisted transactional purpose bypasses this gate; anything else
  //    (campaigns, nurture, QA, retries, unknown purpose) stays suppressed.
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
      if (isPurposeAllowlisted(options)) {
        return { suppressed: false, reason: null };
      }
      const why = options?.purpose
        ? `test_identity:purpose_not_allowlisted:${options.purpose}`
        : "test_identity";
      return { suppressed: true, reason: why };
    }
  } catch {
    // ignore — absence of a match means not a known test identity
  }

  return { suppressed: false, reason: null };
}
