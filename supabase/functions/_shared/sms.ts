// Shared SMS helpers: CallRail sending, phone normalization, template rendering.

const CALLRAIL_API_BASE = "https://api.callrail.com/v3";
const APPROVED_CALLRAIL_SENDER_NUMBER = "+14697472877";

/** Normalize a US/Canada phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // Already E.164
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export interface CallRailConfig {
  apiKey: string;
  accountId: string;
  companyId: string;
  senderNumber: string;
}

export function getCallRailConfig(): CallRailConfig | null {
  const apiKey = Deno.env.get("CALLRAIL_API_KEY");
  const accountId = Deno.env.get("CALLRAIL_ACCOUNT_ID");
  const companyId = Deno.env.get("CALLRAIL_COMPANY_ID");
  const configuredSender = normalizePhone(Deno.env.get("CALLRAIL_SENDER_NUMBER"));
  if (!apiKey || !accountId || !companyId) return null;

  // BluLadder Bid must send customer-facing SMS from the approved CallRail line.
  // If the environment secret is stale/missing, fail safe to the canonical line
  // instead of silently sending from a retired or non-public tracking number.
  const senderNumber = configuredSender === APPROVED_CALLRAIL_SENDER_NUMBER
    ? configuredSender
    : APPROVED_CALLRAIL_SENDER_NUMBER;
  return { apiKey, accountId, companyId, senderNumber };
}

export interface SendResult {
  ok: boolean;
  /** CallRail returns the text conversation/thread id as the top-level `id`. */
  conversationId?: string;
  /** Message-specific id from the latest outgoing item, when CallRail includes it. */
  messageId?: string;
  error?: string;
  providerStatus?: number;
  providerResponseKind?: string;
  providerMessageStatus?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function normalizeStatus(value: unknown): string | undefined {
  const s = asString(value)?.trim().toLowerCase();
  return s || undefined;
}

// CallRail's Send-a-Text endpoint returns a conversation object. Its top-level
// `id` is NOT a per-send message id — it stays the same for later texts in the
// same conversation. When available, the actual newest outbound message id is in
// `recent_messages[0].id` or `messages[0].id`; otherwise we persist only the
// conversation id and mark the send as provider-accepted, not delivered.
// deno-lint-ignore no-explicit-any
function parseCallRailTextResponse(json: any): {
  conversationId?: string;
  messageId?: string;
  providerMessageStatus?: string;
} {
  const conversationId = asString(json?.id ?? json?.conversation_id ?? json?.sms_thread_id ?? json?.thread_id);
  const messageCandidates = [
    ...(Array.isArray(json?.recent_messages) ? json.recent_messages : []),
    ...(Array.isArray(json?.messages) ? json.messages : []),
  ];
  const outgoing = messageCandidates.find((m) => String(m?.direction ?? "").toLowerCase() === "outgoing") ?? messageCandidates[0];
  const messageId = asString(outgoing?.id ?? json?.message?.id ?? json?.text_message?.id ?? json?.message_id);
  const providerMessageStatus = normalizeStatus(outgoing?.status ?? json?.status);
  return { conversationId, messageId, providerMessageStatus };
}

async function fetchCallRailConversationMessageStatus(
  config: CallRailConfig,
  conversationId: string,
  sentContent: string,
): Promise<{ messageId?: string; providerMessageStatus?: string }> {
  const url = `${CALLRAIL_API_BASE}/a/${config.accountId}/text-messages/${conversationId}.json`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Token token="${config.apiKey}"` },
    });
    if (!res.ok) return {};
    const json = await res.json();
    const messages = Array.isArray(json?.messages) ? json.messages : [];
    const normalizedSent = sentContent.trim();
    const match = messages.find((m: any) =>
      String(m?.direction ?? "").toLowerCase() === "outgoing" &&
      String(m?.content ?? m?.body ?? m?.message ?? m?.text ?? "").trim() === normalizedSent
    ) ?? messages.find((m: any) => String(m?.direction ?? "").toLowerCase() === "outgoing");
    if (!match) return {};
    return {
      messageId: asString(match.id ?? match.message_id ?? match.uuid),
      providerMessageStatus: normalizeStatus(match.status ?? match.message_status ?? match.delivery_status),
    };
  } catch {
    return {};
  }
}

/** Send a single SMS through CallRail's Send-a-Text-Message endpoint. */
export async function sendCallRailSms(
  config: CallRailConfig,
  toNumber: string,
  content: string,
): Promise<SendResult> {
  const normalized = normalizePhone(toNumber);
  if (!normalized) {
    return { ok: false, error: `Invalid recipient phone number: ${toNumber}` };
  }

  const url = `${CALLRAIL_API_BASE}/a/${config.accountId}/text-messages.json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Token token="${config.apiKey}"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company_id: config.companyId,
        customer_phone_number: normalized,
        tracking_number: config.senderNumber,
        content,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `CallRail ${res.status}: ${text}`, providerStatus: res.status };
    }

    let conversationId: string | undefined;
    let messageId: string | undefined;
    let providerMessageStatus: string | undefined;
    let providerResponseKind = "unknown";
    try {
      const json = JSON.parse(text);
      providerResponseKind = Array.isArray(json) ? "array" : typeof json;
      const parsed = parseCallRailTextResponse(json);
      conversationId = parsed.conversationId;
      messageId = parsed.messageId;
      providerMessageStatus = parsed.providerMessageStatus;
      if (conversationId && (!messageId || !providerMessageStatus)) {
        const refreshed = await fetchCallRailConversationMessageStatus(config, conversationId, content);
        messageId = messageId ?? refreshed.messageId;
        providerMessageStatus = providerMessageStatus ?? refreshed.providerMessageStatus;
      }
    } catch {
      // non-JSON success response; ignore
      providerResponseKind = "text";
    }
    return { ok: true, conversationId, messageId, providerStatus: res.status, providerResponseKind, providerMessageStatus };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Render {{variable}} placeholders in a template against a value map. Missing vars become empty strings. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Format an ISO datetime into a friendly date + arrival time for SMS. */
export function formatApptDate(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
  });
  return { date, time };
}

// ---- Opt-out (STOP) handling ----

const STOP_KEYWORDS = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out",
]);
// Explicit opt-in commands only. Bare "yes" is intentionally excluded — see
// _shared/bookingIntent.ts. This keeps the legacy classifier from silently
// re-subscribing customers who reply "Yes, Tuesday works".
const START_KEYWORDS = new Set([
  "start", "unstop", "subscribe", "optin", "opt-in",
]);

/** Returns "stop", "start", or null based on the first word of an inbound message body. */
export function classifyInbound(body: string | null | undefined): "stop" | "start" | null {
  if (!body) return null;
  const first = String(body).trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z-]/g, "");
  if (!first) return null;
  if (STOP_KEYWORDS.has(first)) return "stop";
  if (START_KEYWORDS.has(first)) return "start";
  return null;
}

// Minimal shape of the Supabase client we rely on (avoids importing types here).
/** Returns true if the given phone number has opted out of texts. Fails open (false) on error. */
// deno-lint-ignore no-explicit-any
export async function isPhoneOptedOut(
  supabase: any,
  phone: string | null | undefined,
): Promise<boolean> {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  try {
    const { data } = await supabase
      .from("sms_opt_outs")
      .select("opted_out")
      .eq("phone", normalized)
      .maybeSingle();
    return !!(data as { opted_out?: boolean } | null)?.opted_out;
  } catch {
    return false;
  }
}

// ---- Per-lead channel pause (admin / customer self-service) ----

export interface ChannelPause {
  sms_paused: boolean;
  email_paused: boolean;
}

/**
 * Look up the per-lead messaging pause switches on a customer record.
 * Pausing a channel suppresses messages to that single lead without touching
 * the campaigns themselves. Fails open (nothing paused) on error.
 */
// deno-lint-ignore no-explicit-any
export async function getCustomerPause(
  supabase: any,
  by: { id?: string | null; email?: string | null; phone?: string | null },
): Promise<ChannelPause> {
  const fallback: ChannelPause = { sms_paused: false, email_paused: false };
  try {
    let q;
    if (by.id) {
      q = supabase.from("customers").select("sms_paused,email_paused").eq("id", by.id);
    } else if (by.email) {
      q = supabase.from("customers").select("sms_paused,email_paused").eq("email", String(by.email).toLowerCase().trim());
    } else if (by.phone) {
      const np = normalizePhone(by.phone);
      if (!np) return fallback;
      q = supabase.from("customers").select("sms_paused,email_paused").eq("phone", np);
    } else {
      return fallback;
    }
    const { data } = await q.maybeSingle();
    if (!data) return fallback;
    return { sms_paused: !!data.sms_paused, email_paused: !!data.email_paused };
  } catch {
    return fallback;
  }
}