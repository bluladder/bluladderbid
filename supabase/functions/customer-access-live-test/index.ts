// Admin-only edge function that dispatches ONE Customer Access live test
// message per authorization. It consumes an entry from
// `customer_access_test_authorizations` scoped by (test_type, idempotency_key)
// so an authorization for one test type cannot send another. Bypasses normal
// suppression only for the exact authorized recipient + test type.
//
// test_type ∈ {"sms_otp", "email_otp", "booking_link_sms"}
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyAdmin, getBearer } from "../_shared/auth.ts";
import {
  getCallRailConfig,
  sendCallRailSms,
  normalizePhone,
} from "../_shared/sms.ts";
import {
  sha256Hex,
  generateOtp,
  generateSessionToken,
  loadVerificationConfig,
} from "../_shared/customerVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APPROVED_TEST_EMAIL = "blmillen@gmail.com";
const APPROVED_TEST_PHONE = "+14692150144";

function sanitizeError(msg: string): string {
  // Strip anything token/secret shaped from provider errors before returning.
  return msg
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/Token\s+token="[^"]+"/gi, 'Token token="[redacted]"')
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 240);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = getBearer(req);
  const adminId = await verifyAdmin(token, "operations_admin");
  if (!adminId) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const testType = typeof body?.test_type === "string" ? body.test_type : "";
  const idempotencyKey = typeof body?.idempotency_key === "string"
    ? body.idempotency_key
    : "";

  if (
    !["sms_otp", "email_otp", "booking_link_sms"].includes(testType) ||
    !idempotencyKey
  ) {
    return new Response(JSON.stringify({ error: "invalid_request" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Atomic single-use consumption scoped to this exact test type.
  const { data: consumed, error: consumeErr } = await supabase.rpc(
    "consume_customer_access_test_auth",
    { p_test_type: testType, p_idempotency_key: idempotencyKey },
  );

  if (consumeErr || !consumed || (consumed as { status?: string }).status !== "authorized") {
    return new Response(
      JSON.stringify({ error: "not_authorized_or_expired" }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const auth = consumed as {
    id: string;
    correlation_id: string;
    recipient: string;
    target_id: string | null;
  };

  // Dispatch per test type. Each branch enforces recipient == approved test identity.
  let result: Record<string, unknown> = {
    status: "failed",
    correlation_id: auth.correlation_id,
  };

  try {
    if (testType === "sms_otp") {
      const phone = normalizePhone(auth.recipient);
      if (!phone || phone !== APPROVED_TEST_PHONE) {
        result = { ...result, error: "recipient_not_approved" };
      } else {
        const cfg = await loadVerificationConfig(supabase);
        const otp = generateOtp();
        const otpHash = await sha256Hex(otp);
        const phoneHash = await sha256Hex(phone);
        const expiresAt = new Date(
          Date.now() + cfg.otp_ttl_seconds * 1000,
        ).toISOString();

        const { data: challenge } = await supabase
          .from("customer_verification_challenges")
          .insert({
            phone_hash: phoneHash,
            otp_hash: otpHash,
            expires_at: expiresAt,
            max_attempts: cfg.max_attempts,
            ip_hash: await sha256Hex(`admin-test:${adminId}`),
            delivery_status: "queued",
          })
          .select("id, correlation_id")
          .single();

        const callRail = getCallRailConfig();
        if (!callRail) {
          result = { ...result, error: "callrail_not_configured", challenge_id: challenge?.id };
        } else {
          const smsBody =
            `Your BluLadder verification code is ${otp}. It expires in ${
              Math.round(cfg.otp_ttl_seconds / 60)
            } minutes. Do not share this code.`;
          const send = await sendCallRailSms(callRail, phone, smsBody);
          await supabase
            .from("customer_verification_challenges")
            .update({
              callrail_message_id: send.messageId ?? null,
              delivery_status: send.ok ? "sent" : "delivery_failed",
            })
            .eq("id", challenge?.id);
          result = {
            status: send.ok ? "sent" : "failed",
            correlation_id: auth.correlation_id,
            challenge_id: challenge?.id ?? null,
            challenge_correlation_id: challenge?.correlation_id ?? null,
            provider_message_id: send.messageId ?? null,
            delivery_status: send.ok ? "sent" : "delivery_failed",
            error: send.ok ? null : sanitizeError(send.error ?? "send_failed"),
          };
        }
      }
    } else if (testType === "email_otp") {
      const email = auth.recipient.trim().toLowerCase();
      if (email !== APPROVED_TEST_EMAIL) {
        result = { ...result, error: "recipient_not_approved" };
      } else {
        // Uses Supabase Auth OTP (magic link + code). Not a transactional
        // send — this is the real Auth email path the customer will use.
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase.auth as any).admin.generateLink(
          {
            type: "magiclink",
            email,
          },
        );
        if (error) {
          result = {
            ...result,
            error: sanitizeError(error.message ?? "auth_error"),
          };
        } else {
          result = {
            status: "sent",
            correlation_id: auth.correlation_id,
            auth_user_id: data?.user?.id ?? null,
            email_action_type: data?.properties?.email_action_type ?? "magiclink",
          };
        }
      }
    } else if (testType === "booking_link_sms") {
      const phone = normalizePhone(auth.recipient);
      if (!phone || phone !== APPROVED_TEST_PHONE) {
        result = { ...result, error: "recipient_not_approved" };
      } else if (!auth.target_id) {
        result = { ...result, error: "missing_booking_fixture" };
      } else {
        // Confirm target booking is a real is_test_fixture booking.
        const { data: booking } = await supabase
          .from("bookings")
          .select("id, reference_number, is_test_fixture")
          .eq("id", auth.target_id)
          .maybeSingle();
        if (!booking || !booking.is_test_fixture) {
          result = { ...result, error: "booking_not_fixture" };
        } else {
          const bootstrap = generateSessionToken();
          const bootstrapHash = await sha256Hex(bootstrap);
          const expiresAt = new Date(
            Date.now() + 48 * 3600 * 1000,
          ).toISOString();
          const { data: tokenRow } = await supabase
            .from("booking_management_tokens")
            .insert({
              token_hash: bootstrapHash,
              booking_id: booking.id,
              expires_at: expiresAt,
            })
            .select("id")
            .single();

          const callRail = getCallRailConfig();
          if (!callRail) {
            result = { ...result, error: "callrail_not_configured" };
          } else {
            const origin = Deno.env.get("PUBLIC_SITE_URL") ?? getAppUrl();
            const url = `${origin}/manage-booking?t=${bootstrap}`;
            const smsBody =
              `BluLadder: manage booking ${booking.reference_number}. Link expires in 48h: ${url}`;
            const send = await sendCallRailSms(callRail, phone, smsBody);
            result = {
              status: send.ok ? "sent" : "failed",
              correlation_id: auth.correlation_id,
              token_id: tokenRow?.id ?? null,
              provider_message_id: send.messageId ?? null,
              delivery_status: send.ok ? "sent" : "delivery_failed",
              error: send.ok ? null : sanitizeError(send.error ?? "send_failed"),
            };
          }
        }
      }
    }
  } catch (err) {
    result = {
      status: "failed",
      correlation_id: auth.correlation_id,
      error: sanitizeError(err instanceof Error ? err.message : String(err)),
    };
  }

  await supabase.rpc("record_customer_access_test_result", {
    p_id: auth.id,
    p_result: result,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});