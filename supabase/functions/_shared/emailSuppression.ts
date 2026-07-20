// ============================================================================
// Email suppression gate.
//
// Any recipient present in public.email_suppressions must NEVER receive another
// email — regardless of transport (transactional, campaign, escalation). This
// helper is called from the single sendEmail() path in emailConfig.ts so every
// caller inherits the check automatically.
//
// Reasons: 'bounced' | 'complained' | 'unsubscribed' | 'invalid' | 'manual'
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SuppressionReason =
  | "bounced"
  | "complained"
  | "unsubscribed"
  | "invalid"
  | "manual";

export function normalizeEmailAddr(raw?: string | null): string | null {
  if (!raw) return null;
  const t = String(raw).trim().toLowerCase();
  return t.length > 0 ? t : null;
}

// deno-lint-ignore no-explicit-any
function serviceClient(): any {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface SuppressionCheck {
  suppressed: boolean;
  reason: SuppressionReason | null;
}

/** Returns { suppressed: true, reason } if the email is on the suppression list. Fails open. */
export async function isEmailSuppressed(email: string): Promise<SuppressionCheck> {
  const normalized = normalizeEmailAddr(email);
  if (!normalized) return { suppressed: false, reason: null };
  const supabase = serviceClient();
  if (!supabase) return { suppressed: false, reason: null };
  try {
    const { data } = await supabase
      .from("email_suppressions")
      .select("reason")
      .eq("email", normalized)
      .maybeSingle();
    if (data?.reason) return { suppressed: true, reason: data.reason as SuppressionReason };
  } catch {
    /* fail open */
  }
  return { suppressed: false, reason: null };
}

/** Upsert a suppression record. Idempotent on email address (case-insensitive). */
export async function recordSuppression(opts: {
  email: string;
  reason: SuppressionReason;
  source?: string;
  providerEventId?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const email = normalizeEmailAddr(opts.email);
  if (!email) return { ok: false, error: "invalid_email" };
  const supabase = serviceClient();
  if (!supabase) return { ok: false, error: "no_service_client" };
  try {
    const { data: existing } = await supabase
      .from("email_suppressions")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    const payload = {
      email,
      reason: opts.reason,
      source: opts.source ?? "resend",
      provider_event_id: opts.providerEventId ?? null,
      notes: opts.notes ?? null,
    };
    if (existing?.id) {
      const { error } = await supabase
        .from("email_suppressions")
        .update(payload)
        .eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase.from("email_suppressions").insert(payload);
      // Ignore unique-violation races (23505) — a concurrent insert already recorded it.
      if (error && !String(error.message).includes("duplicate")) {
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}