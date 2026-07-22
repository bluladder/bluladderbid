// Admin-only, read-mostly diagnostic for the failed CallRail SMS attempt from
// owner-live-delivery-verify. Reports masked findings about the raw
// OWNER_TEST_SMS_NUMBER secret, the normalized value, and the exact CallRail
// payload construction. Also cancels a single pending sms_messages row (by id)
// to prevent automatic retry, without changing global retry behavior.
//
// Does NOT send anything.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { normalizePhone, getCallRailConfig } from "../_shared/sms.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "***";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

function charProfile(raw: string): Record<string, unknown> {
  const codePoints = Array.from(raw).map((c) => c.codePointAt(0) ?? 0);
  const nonPlusDigit = Array.from(raw).filter((c) => c !== "+" && !/\d/.test(c));
  return {
    length: raw.length,
    hasLeadingWhitespace: /^\s/.test(raw),
    hasTrailingWhitespace: /\s$/.test(raw),
    hasNonPlusDigitChars: nonPlusDigit.length > 0,
    nonPlusDigitCharCodes: nonPlusDigit.map((c) => c.codePointAt(0) ?? 0),
    // Any weird Unicode (BOM, RTL marks, NBSP, etc.)
    hasNonAsciiChar: codePoints.some((cp) => cp > 127),
    firstCharCode: codePoints[0] ?? null,
    lastCharCode: codePoints[codePoints.length - 1] ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "Method not allowed" }, 405);

  const gate = await requireAdminOrService(req);
  if (!gate.ok) return j({ error: "Admin authentication required" }, 401);

  let body: { cancelSmsMessageId?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const raw = Deno.env.get("OWNER_TEST_SMS_NUMBER") ?? "";
  const profile = charProfile(raw);
  const normalized = normalizePhone(raw);
  const normDigits = normalized ? normalized.replace(/\D/g, "") : "";
  const isCanonicalUs = /^\+1\d{10}$/.test(normalized ?? "");
  const countryCode = normalized && normalized.startsWith("+1") ? "1" : (normalized?.match(/^\+(\d{1,3})/)?.[1] ?? null);
  const areaCode = isCanonicalUs ? normDigits.slice(1, 4) : null;

  const cfg = getCallRailConfig();
  const senderNorm = cfg ? normalizePhone(cfg.senderNumber) : null;
  const senderIsUs = !!senderNorm && /^\+1\d{10}$/.test(senderNorm);

  const payloadShape = {
    endpoint: "POST /v3/a/{accountId}/text-messages.json",
    recipientField: "customer_phone_number",
    senderField: "tracking_number",
    recipientValueMasked: maskPhone(normalized),
    senderValueMasked: maskPhone(cfg?.senderNumber ?? null),
    recipientDiffersFromNormalizedSecret: normalized ? maskPhone(normalized) !== maskPhone(raw) : false,
    fieldsCouldBeReversed: false, // fields are named, not positional
    duplicatedCountryCode: !!normalized && /^\+11\d{10}$/.test(normalized),
  };

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Look up the failed row. Prefer explicit id from request; else the latest
  // transactional row for the last owner-live-verify quote.
  let smsRow: Record<string, unknown> | null = null;
  let cancelResult: string | null = null;
  if (body.cancelSmsMessageId) {
    const { data } = await supabase
      .from("sms_messages")
      .select("id, quote_id, message_kind, status, error, callrail_message_id, next_retry_at, attempts, created_at, phone_e164, to_phone, phone, recipient_phone")
      .eq("id", body.cancelSmsMessageId)
      .maybeSingle();
    smsRow = (data as Record<string, unknown>) ?? null;
  } else {
    const { data: q } = await supabase
      .from("quotes").select("id").ilike("source_session_id", "owner-live-verify-%")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (q?.id) {
      const { data } = await supabase
        .from("sms_messages")
        .select("id, quote_id, message_kind, status, error, callrail_message_id, next_retry_at, attempts, created_at, phone_e164, to_phone, phone, recipient_phone")
        .eq("quote_id", q.id).eq("message_kind", "transactional")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      smsRow = (data as Record<string, unknown>) ?? null;
    }
  }

  // Cancel to block retry, if still pending. Local to this one row.
  if (smsRow && smsRow.status === "pending") {
    const { error } = await supabase.from("sms_messages")
      .update({ status: "cancelled", error: "diagnostic hold: owner-live-delivery-diagnose", next_retry_at: null })
      .eq("id", smsRow.id as string);
    cancelResult = error ? `cancel_failed: ${error.message}` : "cancelled";
  } else {
    cancelResult = smsRow ? `no_action (status=${smsRow.status})` : "no_matching_row";
  }

  // Mask any phone-shaped fields on the row before returning.
  const maskedSmsRow = smsRow ? {
    ...smsRow,
    phone_e164: smsRow.phone_e164 ? maskPhone(String(smsRow.phone_e164)) : null,
    to_phone: smsRow.to_phone ? maskPhone(String(smsRow.to_phone)) : null,
    phone: smsRow.phone ? maskPhone(String(smsRow.phone)) : null,
    recipient_phone: smsRow.recipient_phone ? maskPhone(String(smsRow.recipient_phone)) : null,
  } : null;

  return j({
    secret: {
      present: raw.length > 0,
      ...profile,
      maskedNormalized: maskPhone(normalized),
      normalizedDigitCount: normDigits.length,
      detectedCountryCode: countryCode,
      detectedAreaCode: areaCode,
      isCanonicalUsE164: isCanonicalUs,
    },
    callrailPayload: payloadShape,
    callrailSender: {
      configured: !!cfg,
      masked: cfg ? maskPhone(cfg.senderNumber) : null,
      normalizedIsUsE164: senderIsUs,
    },
    smsRow: maskedSmsRow,
    retryGuard: cancelResult,
  });
});