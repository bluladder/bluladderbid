import {
  clampSmsBody,
  normalizePhone,
  type SendResult,
  stripMarkdownForSms,
} from "./sms.ts";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/**
 * Non-secret connector reference for the one reviewed Klamath credential.
 * Database rows can select only this compiled allowlist entry; they never
 * contain an account SID, token, or Authorization value.
 */
export const KLAMATH_TWILIO_CREDENTIAL_REFERENCE =
  "bluladder-klamath-twilio-production-v1";

const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const API_KEY_SID_PATTERN = /^SK[0-9a-f]{32}$/i;
const MESSAGE_SID_PATTERN = /^SM[0-9a-f]{32}$/i;
const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-f]{32}$/i;

export interface TwilioSmsConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  messagingServiceSid: string;
}

/**
 * Resolve one allowlisted server-side credential and one independently
 * reviewed Messaging Service identity. Unknown references fail closed.
 */
export function resolveTwilioSmsConfig(
  credentialReference: string | null | undefined,
  senderIdentityReference: string | null | undefined,
): TwilioSmsConfig | null {
  if (
    credentialReference !== KLAMATH_TWILIO_CREDENTIAL_REFERENCE ||
    !senderIdentityReference ||
    !MESSAGING_SERVICE_SID_PATTERN.test(senderIdentityReference)
  ) {
    return null;
  }

  const accountSid = Deno.env.get("TWILIO_KLAMATH_ACCOUNT_SID") ?? "";
  const apiKeySid = Deno.env.get("TWILIO_KLAMATH_API_KEY_SID") ?? "";
  const apiKeySecret = Deno.env.get("TWILIO_KLAMATH_API_KEY_SECRET") ?? "";
  if (
    !ACCOUNT_SID_PATTERN.test(accountSid) ||
    !API_KEY_SID_PATTERN.test(apiKeySid) ||
    !apiKeySecret
  ) return null;

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    messagingServiceSid: senderIdentityReference,
  };
}

type Fetcher = typeof fetch;

/**
 * Send one SMS through the reviewed Twilio Messaging Service boundary.
 * Error output is deliberately content-free: Twilio response bodies can echo
 * recipient or sender data and must never flow into logs or durable errors.
 */
export async function sendTwilioSms(
  config: TwilioSmsConfig,
  toNumber: string,
  content: string,
  fetcher: Fetcher = fetch,
): Promise<SendResult> {
  const normalized = normalizePhone(toNumber);
  if (!normalized) {
    return { ok: false, error: "invalid_recipient" };
  }
  if (
    !ACCOUNT_SID_PATTERN.test(config.accountSid) ||
    !API_KEY_SID_PATTERN.test(config.apiKeySid) ||
    !config.apiKeySecret ||
    !MESSAGING_SERVICE_SID_PATTERN.test(config.messagingServiceSid)
  ) {
    return { ok: false, error: "twilio_config_invalid" };
  }

  const safeContent = clampSmsBody(stripMarkdownForSms(content));
  const form = new URLSearchParams({
    To: normalized,
    Body: safeContent,
    MessagingServiceSid: config.messagingServiceSid,
  });
  const endpoint =
    `${TWILIO_API_BASE}/Accounts/${config.accountSid}/Messages.json`;

  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${
          btoa(`${config.apiKeySid}:${config.apiKeySecret}`)
        }`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `twilio_http_${response.status}`,
        providerStatus: response.status,
        providerResponseKind: "http_rejection",
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        error: "twilio_response_unreadable",
        providerStatus: response.status,
        providerResponseKind: "provider_ambiguous",
      };
    }
    const messageId = typeof payload.sid === "string" &&
        MESSAGE_SID_PATTERN.test(payload.sid)
      ? payload.sid
      : undefined;
    if (!messageId) {
      return {
        ok: false,
        error: "twilio_message_id_missing",
        providerStatus: response.status,
        providerResponseKind: "provider_ambiguous",
      };
    }

    const status = typeof payload.status === "string"
      ? payload.status.trim().toLowerCase() || undefined
      : undefined;
    return {
      ok: true,
      messageId,
      providerStatus: response.status,
      providerResponseKind: "message",
      providerMessageStatus: status,
    };
  } catch {
    return {
      ok: false,
      error: "twilio_transport_uncertain",
      providerResponseKind: "transport_uncertain",
    };
  }
}
