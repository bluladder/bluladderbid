// Passwordless customer verification — CONFIRM endpoint.
// Validates the submitted OTP against the stored hash, resolves an unambiguous
// customer match (or opens an admin review issue for ambiguous matches), and
// issues a short-lived opaque portal session as an httpOnly cookie.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { normalizePhone } from "../_shared/sms.ts";
import { normalizeEmailAddr } from "../_shared/emailSuppression.ts";
import {
  clientIp,
  generateSessionToken,
  loadVerificationConfig,
  portalCookie,
  sha256Hex,
} from "../_shared/customerVerification.ts";
import { resolvePortalOrganizationAuthority } from "../_shared/portalOrganizationAuthority.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const generic = (extra: Record<string, unknown> = {}, cookie?: string) => {
    const headers: Record<string, string> = {
      ...corsHeaders,
      "Content-Type": "application/json",
    };
    if (cookie) headers["Set-Cookie"] = cookie;
    return new Response(JSON.stringify({ verified: false, ...extra }), {
      status: 200,
      headers,
    });
  };

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhone(
      typeof body?.phone === "string" ? body.phone : "",
    );
    const email = normalizeEmailAddr(
      typeof body?.email === "string" ? body.email : "",
    );
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const channel = phone ? "sms" : email ? "email" : "";
    if (!channel || !/^\d{6}$/.test(code)) return generic();
    const authority = await resolvePortalOrganizationAuthority(supabase, req);
    if (authority.status !== "resolved") return generic();
    const organizationId = authority.organizationId;

    const cfg = await loadVerificationConfig(supabase);
    const subjectHash = await sha256Hex(phone ?? email ?? "");
    const codeHash = await sha256Hex(code);
    const ipHash = await sha256Hex(clientIp(req));

    let challengeQuery = supabase
      .from("customer_verification_challenges")
      .select(
        "id, otp_hash, status, attempts, max_attempts, expires_at, usable_until, delivery_status",
      )
      .eq("organization_id", organizationId)
      .eq("channel", channel)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    challengeQuery = phone
      ? challengeQuery.eq("phone_hash", subjectHash)
      : challengeQuery.eq("recipient_hint", subjectHash);
    const { data: challenge, error: challengeError } = await challengeQuery
      .maybeSingle();
    if (challengeError || !challenge) return generic();

    // Expired?
    const expiresAtMs = new Date(challenge.expires_at).getTime();
    const usableUntilMs = challenge.usable_until
      ? new Date(challenge.usable_until).getTime()
      : expiresAtMs;
    const isDelayedProviderAccepted = ["accepted", "sent"].includes(
      String(challenge.delivery_status ?? ""),
    );
    const cutoffMs = isDelayedProviderAccepted
      ? Math.max(expiresAtMs, usableUntilMs)
      : expiresAtMs;
    if (cutoffMs < Date.now()) {
      await supabase.from("customer_verification_challenges").update({
        status: "expired",
      }).eq("id", challenge.id);
      return generic();
    }

    // Locked?
    if (
      (challenge.attempts ?? 0) >= (challenge.max_attempts ?? cfg.max_attempts)
    ) {
      await supabase.from("customer_verification_challenges").update({
        status: "locked",
      }).eq("id", challenge.id);
      return generic();
    }

    if (challenge.otp_hash !== codeHash) {
      const attempts = (challenge.attempts ?? 0) + 1;
      const willLock = attempts >= (challenge.max_attempts ?? cfg.max_attempts);
      await supabase.from("customer_verification_challenges").update({
        attempts,
        status: willLock ? "locked" : "pending",
      }).eq("id", challenge.id);
      return generic();
    }

    // OTP is valid. Consume the challenge immediately (no reuse).
    const { error: consumeError } = await supabase.from(
      "customer_verification_challenges",
    ).update({
      status: "verified",
      verified_at: new Date().toISOString(),
      attempts: (challenge.attempts ?? 0) + 1,
    }).eq("id", challenge.id).eq("organization_id", organizationId);
    if (consumeError) return generic();

    // Resolve unambiguous customer match. Compare on normalized phone or lower-cased email.
    const { data: matches, error: matchesError } = await supabase
      .from("customers")
      .select(phone ? "id, phone" : "id, email")
      .eq("organization_id", organizationId)
      .not(phone ? "phone" : "email", "is", null);
    if (matchesError) return generic();
    const candidateIds = (matches ?? [])
      .filter((c: { phone?: string | null; email?: string | null }) => (
        phone
          ? normalizePhone(c.phone) === phone
          : (c.email ?? "").toLowerCase().trim() === email
      ))
      .map((c: { id: string }) => c.id);

    if (candidateIds.length > 1) {
      // Ambiguous — do not expose data. Queue an admin issue and return verified=false.
      await supabase.from("customer_account_match_issues").insert({
        organization_id: organizationId,
        verified_phone: phone ?? null,
        verified_email: email ?? null,
        candidate_customer_ids: candidateIds,
      });
      return generic({ ambiguous: true });
    }

    let customerId: string | null = candidateIds[0] ?? null;

    // No existing customer — verified guest. Do not issue a portal session that
    // has no customer to view; return verified=true guest instead.
    if (!customerId) {
      return new Response(JSON.stringify({ verified: true, guest: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create-or-update customer_account row.
    let accountId: string;
    let accountQuery = supabase
      .from("customer_accounts")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1);
    accountQuery = phone
      ? accountQuery.eq("verified_phone", phone)
      : accountQuery.eq("customer_id", customerId);
    const { data: existingAccount, error: accountLookupError } =
      await accountQuery.maybeSingle();
    if (accountLookupError) return generic();
    if (existingAccount) {
      accountId = existingAccount.id;
      const { error: accountUpdateError } = await supabase.from(
        "customer_accounts",
      ).update({
        customer_id: customerId,
        last_verified_at: new Date().toISOString(),
        ...(phone ? { verified_phone: phone } : { verified_email: email }),
      }).eq("id", accountId).eq("organization_id", organizationId);
      if (accountUpdateError) return generic();
    } else {
      const { data: created, error: createErr } = await supabase
        .from("customer_accounts")
        .insert({
          organization_id: organizationId,
          customer_id: customerId,
          verified_phone: phone ?? null,
          verified_email: email ?? null,
        })
        .select("id")
        .single();
      if (createErr || !created) return generic();
      accountId = created.id;
    }

    // Issue portal session.
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const absoluteExp = new Date(
      Date.now() + cfg.session_absolute_seconds * 1000,
    ).toISOString();
    const { error: sessionError } = await supabase.from(
      "customer_portal_sessions",
    ).insert({
      organization_id: organizationId,
      session_token_hash: tokenHash,
      customer_account_id: accountId,
      ip_hash: ipHash,
      absolute_expires_at: absoluteExp,
    });
    if (sessionError) return generic();

    return new Response(
      JSON.stringify({
        verified: true,
        guest: false,
        session_token: token,
        expires_at: absoluteExp,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Set-Cookie": portalCookie(token, cfg.session_absolute_seconds),
        },
      },
    );
  } catch (_err) {
    return generic();
  }
});
