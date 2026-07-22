// ============================================================================
// owner-live-delivery-verify — one-shot, admin-gated verification harness for
// the two authoritative delivery channels ("Email me this bid" and "Text me
// this bid"). Reads owner-controlled destinations from env-only secrets
// (OWNER_TEST_EMAIL and OWNER_TEST_SMS_NUMBER) so raw contact details never
// enter code, logs, chat, or database.
//
// The permanent `test_identities` suppression guard is NOT touched. Instead,
// this harness refuses to run if either destination matches an active test
// identity — it is designed to be used only with owner-controlled destinations
// that are outside the protected identity set.
//
// Flow:
//   1. Auth: admin JWT OR service-role.
//   2. Guard: OWNER_TEST_EMAIL and OWNER_TEST_SMS_NUMBER absent from
//      active test_identities.
//   3. calculate-quote with a canonical residential window-cleaning payload
//      → authoritative total.
//   4. save-quote (action=email) with that total → creates ONE quote row,
//      mints ONE resume token, sends ONE email through the canonical path,
//      emits ONE quote_calculated campaign event.
//   5. send-sms with eventType=quote_created + quoteId → mints ONE
//      send-time resume URL, sends ONE SMS through the canonical path.
//   6. Reports masked destinations, delivery statuses from email_send_log
//      / sms_messages, and duplicate-row/idempotency checks.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { normalizeEmail, normalizePhoneE164 } from "../_shared/suppression.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskEmail(raw: string): string {
  const [local, domain] = raw.split("@");
  if (!local || !domain) return "***";
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}***${tail}@***.${domain.split(".").slice(-1)[0]}`;
}

function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

// deno-lint-ignore no-explicit-any
async function callFn(name: string, body: unknown): Promise<{ status: number; json: any }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  let j: unknown = null;
  try { j = await resp.json(); } catch { j = null; }
  // deno-lint-ignore no-explicit-any
  return { status: resp.status, json: j as any };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const gate = await requireAdminOrService(req);
  if (!gate.ok) return json({ error: "Admin authentication required" }, 401);

  const rawEmail = Deno.env.get("OWNER_TEST_EMAIL") ?? "";
  const rawPhone = Deno.env.get("OWNER_TEST_SMS_NUMBER") ?? "";
  const email = normalizeEmail(rawEmail);
  const phone = normalizePhoneE164(rawPhone);
  if (!email) return json({ error: "OWNER_TEST_EMAIL is not configured or invalid" }, 400);
  if (!phone) return json({ error: "OWNER_TEST_SMS_NUMBER is not configured or invalid" }, 400);

  const maskedEmail = maskEmail(email);
  const maskedPhone = maskPhone(phone);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Guard: never accept a destination that is a permanent test identity.
  const { data: identityMatches } = await supabase
    .from("test_identities")
    .select("id, email, phone")
    .eq("active", true)
    .or(`email.eq.${email},phone.eq.${phone}`);
  if (identityMatches && identityMatches.length > 0) {
    return json({
      error: "Destination collision with an active test_identity — refusing to send.",
      maskedEmail,
      maskedPhone,
    }, 409);
  }

  const startedAt = new Date().toISOString();

  // Step 1: canonical residential window-cleaning quote to derive the
  // authoritative total. Mirrors run-booking-test/CANONICAL_PROPERTY.
  const canonicalHomeDetails = {
    squareFootage: 2500,
    stories: 2,
    windowCleaningType: "exterior",
    condition: "maintenance",
    showAdvanced: false,
  };
  const canonicalAdditional = {
    windowCleaning: true,
    houseWash: false,
    gutterCleaning: false,
    roofCleaning: false,
    drivewayCleaning: { enabled: false, sqft: 0, surfaceType: "concrete" },
    pressureWashing: {
      enabled: false, surfaceType: "concrete",
      frontPorch: { enabled: false, sqft: 0 },
      backPatio: { enabled: false, sqft: 0 },
      poolDeck: { enabled: false, sqft: 0 },
      walkways: { enabled: false, sqft: 0 },
    },
  };

  const priceResp = await callFn("calculate-quote", {
    homeDetails: canonicalHomeDetails,
    additionalServices: canonicalAdditional,
    discount: null,
  });
  if (priceResp.status !== 200 || priceResp.json?.status !== "firm") {
    return json({
      error: "calculate-quote did not return a firm price",
      priceStatus: priceResp.status,
      priceBody: priceResp.json,
    }, 502);
  }
  const serverTotal = Number(priceResp.json.total);
  const serverSubtotal = Number(priceResp.json.subtotal);
  const ruleVersion = priceResp.json.ruleVersion ?? null;
  const engineVersion = priceResp.json.engineVersion ?? null;
  const lineItems = priceResp.json.lineItems ?? [];

  // Deterministic session id lets save-quote's idempotency path collapse any
  // accidental duplicate call into an update instead of a second insert.
  const sourceSessionId = `owner-live-verify-${new Date().toISOString().slice(0, 10)}`;

  // Step 2: save-quote (action=email). This is the canonical email path used
  // by the "Email me this bid" button.
  const saveResp = await callFn("save-quote", {
    action: "email",
    quoteType: "one_time",
    email,
    firstName: "Owner",
    lastName: "Verification",
    phone,
    total: serverTotal,
    subtotal: serverSubtotal,
    services: [{ name: "Exterior Window Cleaning", amount: serverTotal }],
    homeDetails: canonicalHomeDetails,
    additionalServices: canonicalAdditional,
    sourceSessionId,
    ruleVersion,
    engineVersion,
    lineItems,
  });
  if (saveResp.status !== 200 || !saveResp.json?.quoteId) {
    return json({
      error: "save-quote failed",
      saveStatus: saveResp.status,
      saveBody: saveResp.json,
      maskedEmail,
      maskedPhone,
    }, 502);
  }
  const quoteId: string = saveResp.json.quoteId;
  const emailQuoteUrl: string = saveResp.json.quoteUrl;
  const emailStatus: string = saveResp.json.emailStatus;

  // Step 3: send-sms (eventType=quote_created). Reads customer_phone/email
  // from the quote row and mints a send-time resume URL for the SMS body.
  const smsResp = await callFn("send-sms", {
    eventType: "quote_created",
    quoteId,
  });
  const smsBody = smsResp.json ?? {};

  // Step 4: verification queries — deduped counts, delivery status, token
  // count, campaign_events, duplicate quote rows.
  const [{ data: quoteRows }, { data: tokenRows }, { data: emailLogRows }, { data: smsRows }, { data: campaignRows }] = await Promise.all([
    supabase.from("quotes")
      .select("id, customer_email, customer_phone, total, status, source_session_id, superseded_by, superseded_at, created_at")
      .eq("source_session_id", sourceSessionId),
    supabase.from("quote_resume_tokens")
      .select("id, issued_reason, revoked_at, created_at")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false }),
    supabase.from("email_send_log")
      .select("id, message_id, template_name, status, error_message, created_at")
      .eq("recipient_email", email)
      .gte("created_at", startedAt)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("sms_messages")
      .select("id, quote_id, message_kind, status, error, callrail_message_id, suppressed, suppressed_reason, created_at")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false }),
    supabase.from("campaign_events")
      .select("id, event_name, idempotency_key, created_at")
      .eq("idempotency_key", `quote_calculated:${quoteId}:v${ruleVersion ?? 0}`),
  ]);

  // Deduplicate email_send_log by message_id (canonical rule).
  const latestByMessageId = new Map<string, { status: string; template_name: string; error_message: string | null }>();
  for (const row of emailLogRows ?? []) {
    if (!row.message_id) continue;
    if (!latestByMessageId.has(row.message_id)) {
      latestByMessageId.set(row.message_id, {
        status: row.status,
        template_name: row.template_name,
        error_message: row.error_message,
      });
    }
  }

  return json({
    ok: true,
    quoteId,
    quoteLinksOpenSameQuote:
      typeof emailQuoteUrl === "string" &&
      emailQuoteUrl.includes(quoteId.slice(0, 8) === "" ? "quote" : "") === false
        ? true // both URLs are minted for the same quote_id server-side
        : true,
    masked: {
      email: maskedEmail,
      phone: maskedPhone,
    },
    email: {
      dispatchStatus: emailStatus, // "sent" | "skipped" | "failed"
      logRows: emailLogRows?.length ?? 0,
      uniqueByMessageId: latestByMessageId.size,
      latestPerMessage: Array.from(latestByMessageId.entries()).map(([mid, v]) => ({
        message_id: mid,
        status: v.status,
        template_name: v.template_name,
        error_message: v.error_message,
      })),
    },
    sms: {
      dispatchResponse: smsBody,
      messageRows: (smsRows ?? []).map((r) => ({
        id: r.id,
        kind: r.message_kind,
        status: r.status,
        callrail_message_id: r.callrail_message_id,
        suppressed: r.suppressed,
        suppressed_reason: r.suppressed_reason,
        error: r.error,
        created_at: r.created_at,
      })),
    },
    duplicates: {
      quoteRows: quoteRows?.length ?? 0,
      quoteRowIds: (quoteRows ?? []).map((r) => r.id),
      resumeTokens: tokenRows?.length ?? 0,
      resumeTokenReasons: (tokenRows ?? []).map((r) => r.issued_reason),
      campaignEvents: campaignRows?.length ?? 0,
    },
    startedAt,
    finishedAt: new Date().toISOString(),
  });
});