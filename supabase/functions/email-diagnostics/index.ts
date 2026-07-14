// ============================================================================
// email-diagnostics — admin-only, NO-SEND provider validation for BluLadder
// email. It confirms the SINGLE centralized sender configuration and asks the
// email provider which domains are verified — WITHOUT dispatching any message.
//
// Used by the admin UI before any real retest, and by the agent to verify the
// From domain is verified. It never sends an email and never returns secrets.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBearer, verifyAdmin } from "../_shared/auth.ts";
import { getSenderConfig, listResendDomains, isFromDomainVerified } from "../_shared/emailConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DIAG_DEDUPE_KEY = "email_diagnostics";
const SEND_DEDUPE_KEY = "email_send_success";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Compute the single, sanitized failure reason for a diagnostic snapshot.
 * Mirrors the admin-facing error taxonomy — never leaks secrets or raw bodies.
 */
function computeFailureReason(
  apiKeyPresent: boolean,
  validation: { ok: boolean; reachedProvider: boolean; httpStatus: number | null; domains: { name: string; status: string }[] },
  fromDomain: string,
  fromDomainVerified: boolean,
): string | null {
  if (!apiKeyPresent) return "Resend API key unavailable";
  if (!validation.reachedProvider) return "Diagnostics unavailable";
  if (!validation.ok) {
    if (validation.httpStatus === 401 || validation.httpStatus === 403) return "Resend API key unavailable";
    return "Provider rejected request";
  }
  if (fromDomainVerified) return null;
  const present = validation.domains.some((d) => d.name.toLowerCase() === fromDomain.toLowerCase());
  return present ? "Sender domain not verified" : "From address does not match verified domain";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const correlationId = crypto.randomUUID();
  const adminId = await verifyAdmin(getBearer(req), "operations_admin");
  if (!adminId) return json({ ok: false, error: "Unauthorized", correlationId }, 401);

  const cfg = getSenderConfig();
  const validation = await listResendDomains();
  const fromDomainVerified = validation.ok && isFromDomainVerified(validation, cfg.fromDomain);
  const readyToSend = cfg.apiKeyPresent && fromDomainVerified;
  const failureReason = computeFailureReason(cfg.apiKeyPresent, validation, cfg.fromDomain, fromDomainVerified);

  // --- System Health bookkeeping (no-send) --------------------------------
  // Record the diagnostic outcome as a single deduped system_issues row so the
  // admin panel can show last-success / last-error and link to the record.
  const health = { lastSuccessAt: null as string | null, lastErrorAt: null as string | null, lastError: null as string | null, issueId: null as string | null, lastEmailSendAt: null as string | null };
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from("system_issues")
      .select("id, occurrence_count, details")
      .eq("dedupe_key", DIAG_DEDUPE_KEY)
      .maybeSingle();
    const prev = (existing?.details ?? {}) as { last_success_at?: string; last_error?: string; last_error_at?: string };

    const details: Record<string, unknown> = { ...prev };
    if (readyToSend) {
      details.last_success_at = now;
    } else {
      details.last_error = failureReason;
      details.last_error_at = now;
    }

    if (existing) {
      await supabase.from("system_issues").update({
        status: readyToSend ? "resolved" : "open",
        severity: readyToSend ? "info" : "critical",
        occurrence_count: readyToSend ? (existing.occurrence_count ?? 0) : (existing.occurrence_count ?? 0) + 1,
        last_seen_at: now,
        suggested_action: readyToSend ? null : failureReason,
        details,
      }).eq("id", existing.id);
      health.issueId = existing.id;
    } else {
      const { data: ins } = await supabase.from("system_issues").insert({
        issue_type: "email_delivery",
        dedupe_key: DIAG_DEDUPE_KEY,
        status: readyToSend ? "resolved" : "open",
        severity: readyToSend ? "info" : "critical",
        suggested_action: readyToSend ? null : failureReason,
        details,
      }).select("id").single();
      health.issueId = ins?.id ?? null;
    }
    health.lastSuccessAt = (details.last_success_at as string) ?? null;
    health.lastError = (details.last_error as string) ?? null;
    health.lastErrorAt = (details.last_error_at as string) ?? null;

    // Last successful real email-send (recorded by escalation-test-notify / staff-reply).
    const { data: sendRow } = await supabase
      .from("system_issues")
      .select("details")
      .eq("dedupe_key", SEND_DEDUPE_KEY)
      .maybeSingle();
    health.lastEmailSendAt = ((sendRow?.details ?? {}) as { last_success_at?: string }).last_success_at ?? null;
  } catch {
    // Health bookkeeping must never break the diagnostic response.
  }

  return json({
    ok: true,
    correlationId,
    sender: {
      fromName: cfg.fromName,
      fromEmail: cfg.fromEmail,
      fromHeader: cfg.fromHeader,
      replyTo: cfg.replyTo,
      fromDomain: cfg.fromDomain,
      apiKeyPresent: cfg.apiKeyPresent,
    },
    provider: {
      reachedProvider: validation.reachedProvider,
      httpStatus: validation.httpStatus,
      apiKeyPresent: validation.apiKeyPresent,
      error: validation.error,
      domains: validation.domains,
    },
    fromDomainVerified,
    readyToSend,
    failureReason,
    health,
  });
});
