// ============================================================================
// quote-resume — the ONLY server path a customer-facing browser uses to
// retrieve quote details after receiving a resume link. It:
//
//   1. Verifies the opaque resume token via verifyResumeToken.
//   2. Confirms token scope (quote id match), expiry, and revocation.
//   3. Returns a customer-safe typed DTO — never a raw quotes row.
//   4. Returns a constant-shape failure that never reveals whether a quote
//      exists (all invalid/expired/revoked/mismatched requests look identical).
//
// A bare /quote/<uuid> URL (no token, or an invalid token) MUST fall through
// to the customer verification flow — this function does not otherwise leak
// name, email, phone, address, pricing, services, or attribution.
// ============================================================================
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { rateLimit } from "../_shared/rateLimit.ts";
import { verifyResumeToken } from "../_shared/quoteResumeTokens.ts";
import { getAppUrl } from "../_shared/appUrl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Constant-shape unauthorized response. Never varies on the specific reason
 * (not_found vs expired vs revoked vs mismatch) — that would let an attacker
 * probe for the existence of a quote. Customers see a generic reason and are
 * routed into customer verification.
 */
function unauthorized() {
  return json(200, {
    ok: false,
    reason: "unauthorized",
    verificationUrl: `${getAppUrl()}/verify`,
    message:
      "This link is no longer valid. Verify your identity to continue securely.",
  });
}

// -------- Typed customer-safe DTOs ------------------------------------------
interface QuoteDtoBase {
  quoteId: string;
  createdAt: string;
  expiresAt: string | null;
  status: string;
  isExpired: boolean;
  isDeclined: boolean;
  isConverted: boolean;
  firstName: string | null;
  serviceAddress: {
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  home: {
    squareFootage: number | null;
    stories: number | null;
  };
}

interface OneTimeQuoteDto extends QuoteDtoBase {
  quoteType: "one_time";
  total: number;
  subtotal: number;
  lineItems: Array<{ label: string; amount: number; description?: string }>;
  promotion: { id?: string; label?: string; amount?: number } | null;
  discount: { code?: string; amount?: number } | null;
}

interface RecurringQuoteDto extends QuoteDtoBase {
  quoteType: "recurring_plan";
  annualTotal: number;
  monthlyPayment: number | null;
  downPayment: number | null;
  billingCadence: "one_time" | "monthly" | "annual";
  services: Array<{
    name: string;
    frequency: number | null;
    pricePerVisit: number | null;
    annualTotal: number | null;
  }>;
  promotion: { id?: string; label?: string; amount?: number } | null;
}

type QuoteDto = OneTimeQuoteDto | RecurringQuoteDto;

// deno-lint-ignore no-explicit-any
function toStringOrNull(v: any): string | null {
  return typeof v === "string" && v.length ? v : null;
}
// deno-lint-ignore no-explicit-any
function toNumberOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// deno-lint-ignore no-explicit-any
function buildDto(row: any): QuoteDto {
  const home = (row.home_details_json ?? {}) as Record<string, unknown>;
  const addr = (home.customerAddress ?? null) as Record<string, unknown> | null;
  const services = (row.services_json ?? {}) as Record<string, unknown>;
  const snap = (row.authoritative_snapshot ?? {}) as Record<string, unknown>;
  const firstName = ((row.customer_name as string | null) ?? "").trim().split(/\s+/)[0] || null;
  const base: QuoteDtoBase = {
    quoteId: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    status: row.status,
    isExpired: !!(row.expires_at && new Date(row.expires_at).getTime() < Date.now()),
    isDeclined: row.status === "declined",
    isConverted: row.status === "converted",
    firstName,
    serviceAddress: addr
      ? {
          street: toStringOrNull(addr.street),
          city: toStringOrNull(addr.city),
          state: toStringOrNull(addr.state),
          zip: toStringOrNull(addr.zip),
        }
      : null,
    home: {
      squareFootage: toNumberOrNull(home.squareFootage),
      stories: toNumberOrNull(home.stories),
    },
  };

  const quoteType = (row.quote_type === "recurring_plan" ? "recurring_plan" : "one_time") as
    | "one_time"
    | "recurring_plan";

  if (quoteType === "recurring_plan") {
    const payment = (services.payment ?? {}) as Record<string, unknown>;
    const svcArr = Array.isArray(services.services) ? (services.services as Array<Record<string, unknown>>) : [];
    return {
      ...base,
      quoteType: "recurring_plan",
      annualTotal: toNumberOrNull(snap.annual_total ?? payment.annualTotal ?? row.total) ?? 0,
      monthlyPayment: toNumberOrNull(snap.recurring_amount ?? payment.monthlyPayment),
      downPayment: toNumberOrNull(snap.down_payment ?? payment.downPayment),
      billingCadence:
        snap.billing_cadence === "one_time" || snap.billing_cadence === "annual"
          ? (snap.billing_cadence as "one_time" | "annual")
          : "monthly",
      services: svcArr.map((s) => ({
        name: String(s.name ?? ""),
        frequency: toNumberOrNull(s.frequency),
        pricePerVisit: toNumberOrNull(s.pricePerVisit),
        annualTotal: toNumberOrNull(s.annualTotal),
      })),
      promotion: (snap.promotion as OneTimeQuoteDto["promotion"]) ?? null,
    };
  }

  const li = Array.isArray(snap.line_items) ? (snap.line_items as Array<Record<string, unknown>>) : [];
  return {
    ...base,
    quoteType: "one_time",
    total: toNumberOrNull(snap.total ?? row.total) ?? 0,
    subtotal: toNumberOrNull(snap.subtotal ?? row.subtotal) ?? 0,
    lineItems: li.map((it) => ({
      label: String(it.label ?? ""),
      amount: toNumberOrNull(it.amount) ?? 0,
      description: typeof it.description === "string" ? it.description : undefined,
    })),
    promotion: (snap.promotion as OneTimeQuoteDto["promotion"]) ?? null,
    discount: (snap.discount as OneTimeQuoteDto["discount"]) ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, reason: "unauthorized" });

  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ ok: false, reason: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    });
  }

  let body: { quoteId?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return unauthorized();
  }
  const quoteId = typeof body.quoteId === "string" ? body.quoteId : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!quoteId || !token) return unauthorized();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const verify = await verifyResumeToken(supabase, quoteId, token);
  if (!verify.ok) return unauthorized();

  // Explicit, scoped select. Never quotes.select('*').
  const { data: row, error } = await supabase
    .from("quotes")
    .select(
      "id, customer_name, customer_email, customer_phone, quote_type, home_details_json, services_json, authoritative_snapshot, total, subtotal, status, created_at, expires_at, source_session_id",
    )
    .eq("id", quoteId)
    .maybeSingle();
  if (error || !row) return unauthorized();

  // Best-effort viewed transition (never blocks). Constant-shape success.
  if (row.status === "pending" || row.status === "emailed" || row.status === "saved") {
    try {
      await supabase
        .from("quotes")
        .update({ viewed_at: new Date().toISOString(), status: row.status === "pending" ? "viewed" : row.status })
        .eq("id", quoteId);
    } catch (_e) { /* non-blocking */ }
  }

  const dto = buildDto(row);

  // Hydration payload — returned ONLY on a valid token match. Allows the
  // resume booking screen to re-open the saved proposal without asking the
  // customer to re-enter anything. The token proves the caller controls
  // this quote's link; we do not include cross-customer or admin data.
  const services = (row.services_json ?? {}) as Record<string, unknown>;
  const home = (row.home_details_json ?? {}) as Record<string, unknown>;
  // Look up an existing booking for this quote so already-booked links skip
  // scheduling entirely.
  let booking: {
    id: string;
    referenceNumber: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    status: string | null;
  } | null = null;
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("id, reference_number, scheduled_start, scheduled_end, status")
      .eq("quote_id", quoteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (b?.id) {
      booking = {
        id: b.id,
        referenceNumber: b.reference_number ?? null,
        scheduledStart: b.scheduled_start ?? null,
        scheduledEnd: b.scheduled_end ?? null,
        status: b.status ?? null,
      };
    }
  } catch (_e) { /* non-blocking */ }

  const [firstName, ...restName] = ((row.customer_name as string | null) ?? "").trim().split(/\s+/).filter(Boolean);
  const hydration = {
    customer: {
      firstName: firstName || null,
      lastName: restName.length ? restName.join(" ") : null,
      email: (row.customer_email as string | null) ?? null,
      phone: (row.customer_phone as string | null) ?? null,
    },
    homeDetails: home,
    additionalServices: (services.additionalServices ?? null) as Record<string, unknown> | null,
    sourceSessionId: (row.source_session_id as string | null) ?? null,
  };

  return json(200, { ok: true, quote: dto, hydration, booking });
});