// Shared SMS helpers: CallRail sending, phone normalization, template rendering.

const CALLRAIL_API_BASE = "https://api.callrail.com/v3";

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
  const senderNumber = Deno.env.get("CALLRAIL_SENDER_NUMBER");
  if (!apiKey || !accountId || !companyId || !senderNumber) return null;
  return { apiKey, accountId, companyId, senderNumber };
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
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
      return { ok: false, error: `CallRail ${res.status}: ${text}` };
    }

    let messageId: string | undefined;
    try {
      const json = JSON.parse(text);
      messageId = json?.id ?? json?.message_id ?? undefined;
    } catch {
      // non-JSON success response; ignore
    }
    return { ok: true, messageId };
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
const START_KEYWORDS = new Set([
  "start", "unstop", "yes", "subscribe", "optin", "opt-in",
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