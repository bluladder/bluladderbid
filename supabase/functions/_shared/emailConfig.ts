// ============================================================================
// emailConfig.ts — the SINGLE source of truth for outbound email sending.
//
// Every BluLadder email (internal escalation alerts AND customer-visible staff
// replies) is sent through this module so there is exactly ONE From identity,
// ONE Resend call shape, and ONE error taxonomy. No function may hard-code its
// own From address or call Resend directly anymore.
//
// The sender identity is configurable via environment so the verified Resend
// domain can be corrected without a code change:
//   EMAIL_FROM_NAME     (default "BluLadder")
//   EMAIL_FROM_ADDRESS  (default "alerts@admin.bluladder.com")
//   EMAIL_REPLY_TO      (default "info@bluladder.com")
//
// It also exposes a NO-SEND provider validation (listResendDomains) used by the
// admin email-diagnostics function to confirm the From domain is verified in
// the Resend account WITHOUT dispatching a message.
// ============================================================================

// Resend is reached through the Lovable connector gateway (the linked "resend"
// connector), NOT the raw Resend API. The connector injects RESEND_API_KEY as a
// gateway *connection* key, so calling api.resend.com directly with it fails.
const GATEWAY_BASE = "https://connector-gateway.lovable.dev/resend";
const RESEND_EMAILS_URL = `${GATEWAY_BASE}/emails`;
const RESEND_DOMAINS_URL = `${GATEWAY_BASE}/domains`;

/** Auth headers for the connector gateway (Lovable key + connection key). */
function gatewayHeaders(extra?: Record<string, string>): Record<string, string> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const connectionKey = Deno.env.get("RESEND_API_KEY") ?? "";
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
    ...(extra ?? {}),
  };
}

export interface SenderConfig {
  fromName: string;
  fromEmail: string;
  fromHeader: string; // "Name <email>"
  replyTo: string;
  fromDomain: string;
  apiKeyPresent: boolean;
}

/** Resolve the one-and-only sender identity from env (with safe defaults). */
export function getSenderConfig(fromNameOverride?: string): SenderConfig {
  const fromName = (fromNameOverride || Deno.env.get("EMAIL_FROM_NAME") || "BluLadder").trim();
  const fromEmail = (Deno.env.get("EMAIL_FROM_ADDRESS") || "alerts@admin.bluladder.com").trim();
  const replyTo = (Deno.env.get("EMAIL_REPLY_TO") || "info@bluladder.com").trim();
  const fromDomain = fromEmail.includes("@") ? fromEmail.split("@")[1].toLowerCase() : "";
  return {
    fromName,
    fromEmail,
    fromHeader: `${fromName} <${fromEmail}>`,
    replyTo,
    fromDomain,
    apiKeyPresent: !!Deno.env.get("RESEND_API_KEY"),
  };
}

export type EmailFailureCategory =
  | "provider_not_configured" // no RESEND_API_KEY in this deployment
  | "sender_not_verified" // domain / From address not verified in Resend
  | "invalid_recipient" // recipient address rejected
  | "invalid_sender" // From address malformed / rejected
  | "rate_limited" // Resend is throttling
  | "sandbox_restricted" // test-domain / onboarding recipient restriction
  | "provider_rejected" // any other Resend rejection
  | "network_error"; // request never reached Resend

export interface EmailFailure {
  category: EmailFailureCategory;
  message: string; // safe, admin-facing (never leaks the key)
  retryable: boolean;
  reachedProvider: boolean;
  httpStatus: number | null;
}

/** Map a Resend HTTP failure into a specific, secret-free, actionable reason. */
export function classifyResendFailure(status: number, bodyText: string): EmailFailure {
  const lower = (bodyText || "").toLowerCase();

  // Sandbox / test-domain restriction — check first, its body often returns 403.
  if (lower.includes("onboarding@resend.dev") || lower.includes("testing emails") || lower.includes("can only send")) {
    return { category: "sandbox_restricted", message: "The email provider is in sandbox mode: verify a domain to email addresses other than the account owner.", retryable: false, reachedProvider: true, httpStatus: status };
  }
  // Explicit unverified-domain wording, regardless of status code.
  if (lower.includes("not verified") || lower.includes("domain is not verified") || lower.includes("verify a domain")) {
    return { category: "sender_not_verified", message: "Email sender domain is not verified in the email provider.", retryable: false, reachedProvider: true, httpStatus: status };
  }
  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("unauthorized")) {
    // A bad/absent key OR a key whose account cannot use this domain.
    if (lower.includes("domain") && (lower.includes("verif") || lower.includes("not found"))) {
      return { category: "sender_not_verified", message: "Email sender domain is not verified in the email provider.", retryable: false, reachedProvider: true, httpStatus: status };
    }
    return { category: "sender_not_verified", message: "The email provider rejected the sender: the From domain is not verified (or the API key cannot use it).", retryable: false, reachedProvider: true, httpStatus: status };
  }
  if (status === 422 && (lower.includes("from") || lower.includes("sender"))) {
    return { category: "invalid_sender", message: "The email provider rejected the From address format.", retryable: false, reachedProvider: true, httpStatus: status };
  }
  if (status === 422 || (lower.includes("invalid") && lower.includes("to"))) {
    return { category: "invalid_recipient", message: "The recipient email address was rejected by the email provider.", retryable: false, reachedProvider: true, httpStatus: status };
  }
  if (status === 429) {
    return { category: "rate_limited", message: "The email provider is rate-limiting requests. Try again shortly.", retryable: true, reachedProvider: true, httpStatus: status };
  }
  return { category: "provider_rejected", message: "The email provider rejected the request.", retryable: false, reachedProvider: true, httpStatus: status };
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId: string | null;
  from: string;
  replyTo: string;
  to: string;
  httpStatus: number | null;
  reachedProvider: boolean;
  failure: EmailFailure | null;
}

/**
 * The ONE outbound email path. Success is reported ONLY when Resend accepts the
 * message (2xx). Any other outcome returns a classified, safe failure.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  fromNameOverride?: string;
}): Promise<SendEmailResult> {
  const cfg = getSenderConfig(opts.fromNameOverride);
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const base = { from: cfg.fromHeader, replyTo: cfg.replyTo, to: opts.to };

  if (!apiKey) {
    return {
      ok: false, providerMessageId: null, ...base, httpStatus: null, reachedProvider: false,
      failure: { category: "provider_not_configured", message: "The configured email API key is unavailable in this deployment.", retryable: false, reachedProvider: false, httpStatus: null },
    };
  }

  let resp: Response;
  try {
    resp = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        from: cfg.fromHeader,
        reply_to: cfg.replyTo,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
  } catch (e) {
    return {
      ok: false, providerMessageId: null, ...base, httpStatus: null, reachedProvider: false,
      failure: { category: "network_error", message: "The email request could not reach the email provider.", retryable: true, reachedProvider: false, httpStatus: null },
    };
  }

  if (resp.ok) {
    let id: string | null = null;
    try { const j = await resp.json(); id = j?.id ?? null; } catch { /* ignore */ }
    return { ok: true, providerMessageId: id, ...base, httpStatus: resp.status, reachedProvider: true, failure: null };
  }

  const text = await resp.text().catch(() => "");
  const failure = classifyResendFailure(resp.status, text);
  return { ok: false, providerMessageId: null, ...base, httpStatus: resp.status, reachedProvider: true, failure };
}

export interface ResendDomain {
  name: string;
  status: string; // "verified" | "pending" | "not_started" | ...
  region?: string | null;
}

export interface DomainValidation {
  ok: boolean;
  apiKeyPresent: boolean;
  reachedProvider: boolean;
  httpStatus: number | null;
  domains: ResendDomain[];
  error: string | null;
}

/** NO-SEND provider validation: list the Resend account's domains + status. */
export async function listResendDomains(): Promise<DomainValidation> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { ok: false, apiKeyPresent: false, reachedProvider: false, httpStatus: null, domains: [], error: "The configured email API key is unavailable." };
  }
  let resp: Response;
  try {
    resp = await fetch(RESEND_DOMAINS_URL, { headers: gatewayHeaders() });
  } catch {
    return { ok: false, apiKeyPresent: true, reachedProvider: false, httpStatus: null, domains: [], error: "Could not reach the email provider." };
  }
  if (!resp.ok) {
    const status = resp.status;
    const msg = status === 401 || status === 403
      ? "The configured email API key was rejected by the email provider."
      : `The email provider returned status ${status}.`;
    return { ok: false, apiKeyPresent: true, reachedProvider: true, httpStatus: status, domains: [], error: msg };
  }
  let body: unknown;
  try { body = await resp.json(); } catch { body = null; }
  // deno-lint-ignore no-explicit-any
  const raw = (body as any)?.data ?? (body as any)?.domains ?? [];
  const domains: ResendDomain[] = Array.isArray(raw)
    ? raw.map((d: Record<string, unknown>) => ({ name: String(d.name ?? ""), status: String(d.status ?? "unknown"), region: (d.region as string) ?? null }))
    : [];
  return { ok: true, apiKeyPresent: true, reachedProvider: true, httpStatus: resp.status, domains, error: null };
}

/** Is the From domain present AND verified in the Resend account? */
export function isFromDomainVerified(v: DomainValidation, fromDomain: string): boolean {
  const d = fromDomain.toLowerCase();
  return v.domains.some((x) => x.name.toLowerCase() === d && x.status.toLowerCase() === "verified");
}
