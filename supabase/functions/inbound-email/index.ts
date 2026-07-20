// Resend inbound webhook. Persists every inbound email into
// email_inbound_messages BEFORE processing, then matches the reply token to
// a canonical conversation and appends the message to that thread.
//
// Authentication: shared secret via `x-webhook-secret` header (or `?token=`),
// checked against RESEND_INBOUND_WEBHOOK_SECRET. Fail-closed if unset.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyReplyToken, tokenFromAddress } from "../_shared/emailReplyToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length && typeof v[0] === "string") return v[0];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.email === "string") return o.email;
    if (typeof o.address === "string") return o.address;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET") ?? "";
  if (!expected) return j({ error: "webhook_not_configured" }, 503);
  const provided =
    req.headers.get("x-webhook-secret") ||
    new URL(req.url).searchParams.get("token") || "";
  // constant-time compare
  if (provided.length !== expected.length) return j({ error: "unauthorized" }, 401);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return j({ error: "unauthorized" }, 401);

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const data = (payload?.data ?? payload) as Record<string, unknown>;

  const fromEmail =
    firstString((data as any).from) ||
    firstString((data as any).sender) || "";
  const toRaw = (data as any).to ?? (data as any).recipient ?? "";
  const toEmail = Array.isArray(toRaw)
    ? String(toRaw[0] ?? "")
    : typeof toRaw === "string" ? toRaw : firstString(toRaw) || "";
  const subject = typeof (data as any).subject === "string" ? (data as any).subject : "";
  const textBody = typeof (data as any).text === "string" ? (data as any).text : "";
  const htmlBody = typeof (data as any).html === "string" ? (data as any).html : "";
  const providerMessageId =
    firstString((data as any).message_id) ||
    firstString((data as any).id) || null;

  if (!fromEmail || !toEmail) return j({ error: "invalid_payload" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. PERSIST FIRST (before any matching / processing).
  const { data: inbound, error: insertErr } = await supabase
    .from("email_inbound_messages")
    .insert({
      provider: "resend",
      provider_message_id: providerMessageId,
      from_email: fromEmail,
      to_email: toEmail,
      subject,
      text_body: textBody,
      html_body: htmlBody,
      raw_payload: payload as any,
    })
    .select("id")
    .single();

  if (insertErr) {
    // Likely a duplicate provider_message_id. Idempotent: return 200.
    if (/duplicate|unique/i.test(insertErr.message)) return j({ ok: true, duplicate: true });
    return j({ error: insertErr.message }, 500);
  }

  // 2. Match reply token from To: address.
  const rawToken = tokenFromAddress(toEmail);
  const verifiedId = rawToken ? await verifyReplyToken(rawToken) : null;

  if (!verifiedId) {
    await supabase
      .from("email_inbound_messages")
      .update({ processed_at: new Date().toISOString(), processing_error: "no_valid_token" })
      .eq("id", inbound!.id);
    return j({ ok: true, matched: false, reason: "no_valid_token" });
  }

  const { data: tokenRow } = await supabase
    .from("email_reply_tokens")
    .select("token, conversation_id, quote_id, booking_id, revoked_at, expires_at")
    .eq("token", `${verifiedId}.`) // stored as id.sig; look up by prefix instead
    .maybeSingle();
  // The stored token is the full `id.sig` string; look it up by prefix match.
  // Do a second query to find any token whose id portion equals verifiedId.
  const { data: tokenRows } = await supabase
    .from("email_reply_tokens")
    .select("token, conversation_id, quote_id, booking_id, revoked_at, expires_at")
    .like("token", `${verifiedId}.%`)
    .limit(1);

  const t = tokenRow ?? (tokenRows && tokenRows[0]) ?? null;
  const revoked = t?.revoked_at || (t?.expires_at && new Date(t.expires_at as string).getTime() < Date.now());
  if (!t || revoked) {
    await supabase.from("email_inbound_messages")
      .update({ processed_at: new Date().toISOString(), processing_error: "token_unknown_or_revoked" })
      .eq("id", inbound!.id);
    return j({ ok: true, matched: false });
  }

  const convoId = t.conversation_id as string | null;
  const linkUpdate: Record<string, unknown> = {
    reply_token: t.token,
    conversation_id: convoId,
    quote_id: t.quote_id,
    booking_id: t.booking_id,
    processed_at: new Date().toISOString(),
  };
  await supabase.from("email_inbound_messages").update(linkUpdate).eq("id", inbound!.id);

  if (convoId) {
    await supabase.from("chat_messages").insert({
      conversation_id: convoId,
      role: "user",
      content: `[email reply from ${fromEmail}]\nSubject: ${subject}\n\n${textBody || htmlBody}`,
    });
    await supabase.from("chat_conversations")
      .update({ last_activity_at: new Date().toISOString(), channel: "email" })
      .eq("id", convoId);
  }

  return j({ ok: true, matched: true, conversation_id: convoId });
});