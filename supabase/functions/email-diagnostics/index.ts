// ============================================================================
// email-diagnostics — admin-only, NO-SEND provider validation for BluLadder
// email. It confirms the SINGLE centralized sender configuration and asks the
// email provider which domains are verified — WITHOUT dispatching any message.
//
// Used by the admin UI before any real retest, and by the agent to verify the
// From domain is verified. It never sends an email and never returns secrets.
// ============================================================================
import { getBearer, verifyAdmin } from "../_shared/auth.ts";
import { getSenderConfig, listResendDomains, isFromDomainVerified } from "../_shared/emailConfig.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const adminId = await verifyAdmin(getBearer(req), "operations_admin");
  if (!adminId) return json({ ok: false, error: "Unauthorized" }, 401);

  const cfg = getSenderConfig();
  const validation = await listResendDomains();
  const fromDomainVerified = validation.ok && isFromDomainVerified(validation, cfg.fromDomain);

  return json({
    ok: true,
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
    readyToSend: cfg.apiKeyPresent && fromDomainVerified,
  });
});
