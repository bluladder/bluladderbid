// Server-authoritative portal data endpoint. Reads only rows for the customer
// linked to a validated portal session. Never trust a browser-supplied customer
// id, phone, or email.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { extractPortalToken, getActivePortalSession } from "../_shared/customerVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
  "Access-Control-Allow-Credentials": "true",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const raw = extractPortalToken(req);
  const session = raw ? await getActivePortalSession(supabase, raw) : null;
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: account } = await supabase
    .from("customer_accounts")
    .select("customer_id, verified_phone, verified_email")
    .eq("id", session.customer_account_id)
    .single();
  if (!account) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // A single verified person can have multiple customer rows (created from
  // different intake paths — SMS, web form, imports). Aggregate every row that
  // shares the verified phone or verified email on this account so the portal
  // shows all of their quotes, upcoming visits, and past work — not just the
  // customer row that happened to be linked when the account was created.
  const orFilters: string[] = [];
  if (account.verified_phone) orFilters.push(`phone.eq.${account.verified_phone}`);
  if (account.verified_email) orFilters.push(`email.eq.${account.verified_email.toLowerCase()}`);
  let customerIds: string[] = [account.customer_id];
  if (orFilters.length > 0) {
    const { data: matches } = await supabase
      .from("customers")
      .select("id")
      .or(orFilters.join(","));
    if (matches && matches.length > 0) {
      customerIds = Array.from(new Set([account.customer_id, ...matches.map((m: any) => m.id)]));
    }
  }
  const primaryCustomerId = account.customer_id;

  const [customer, quotes, upcoming, completed] = await Promise.all([
    supabase.from("customers")
      .select("first_name, last_name, address")
      .eq("id", primaryCustomerId).maybeSingle(),
    supabase.from("quotes")
      .select("id, created_at, total, status, services_json, line_item_snapshot, home_details_json")
      .in("customer_id", customerIds)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("bookings")
      .select("id, reference_number, scheduled_start, scheduled_end, status, services_json, total, jobber_visit_id, jobber_job_id, home_details_json")
      .in("customer_id", customerIds)
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .order("scheduled_start", { ascending: true })
      .limit(20),
    supabase.from("bookings")
      .select("id, reference_number, scheduled_start, status, services_json, total, jobber_visit_id, jobber_job_id, home_details_json")
      .in("customer_id", customerIds)
      .eq("status", "completed")
      .order("scheduled_start", { ascending: false })
      .limit(20),
  ]);

  if (quotes.error || upcoming.error || completed.error) {
    console.error("[customer-portal-data] data load error", {
      quotes: quotes.error?.message,
      upcoming: upcoming.error?.message,
      completed: completed.error?.message,
    });
  }

  const addressByVisit = await loadAddressesByVisit(supabase, [
    ...((upcoming.data ?? []) as BookingRow[]),
    ...((completed.data ?? []) as BookingRow[]),
  ]);
  const fallbackAddress = customer.data?.address ?? null;

  return new Response(JSON.stringify({
    customer: customer.data ?? null,
    recent_quotes: ((quotes.data ?? []) as QuoteRow[]).map((q) => ({
      ...q,
      address: extractAddress(q.home_details_json) ?? fallbackAddress,
      services_json: normalizeQuoteServices(q),
    })),
    upcoming_appointments: ((upcoming.data ?? []) as BookingRow[]).map((b) => ({
      ...b,
      address: addressByVisit.get(b.jobber_visit_id ?? "") ?? extractAddress(b.home_details_json) ?? fallbackAddress,
    })),
    previous_work: ((completed.data ?? []) as BookingRow[]).map((b) => ({
      ...b,
      address: addressByVisit.get(b.jobber_visit_id ?? "") ?? extractAddress(b.home_details_json) ?? fallbackAddress,
    })),
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

interface QuoteRow {
  home_details_json?: Record<string, unknown> | null;
  services_json?: unknown;
  line_item_snapshot?: unknown;
}

interface BookingRow {
  jobber_visit_id?: string | null;
  home_details_json?: Record<string, unknown> | null;
}

function normalizeQuoteServices(q: QuoteRow): unknown {
  if (q.services_json && typeof q.services_json === "object") return q.services_json;
  if (Array.isArray(q.line_item_snapshot)) return { lineItems: q.line_item_snapshot };
  return q.services_json;
}

function extractAddress(homeDetails: Record<string, unknown> | null | undefined): string | null {
  if (!homeDetails || typeof homeDetails !== "object") return null;
  const candidates = ["address", "propertyAddress", "fullAddress", "serviceAddress"];
  for (const key of candidates) {
    const value = homeDetails[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function loadAddressesByVisit(supabase: ReturnType<typeof createClient>, rows: BookingRow[]): Promise<Map<string, string>> {
  const visitIds = Array.from(new Set(rows.map((r) => r.jobber_visit_id).filter(Boolean) as string[]));
  if (visitIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("jobber_busy_blocks")
    .select("jobber_visit_id, client_address, status, updated_at")
    .in("jobber_visit_id", visitIds)
    .order("updated_at", { ascending: false });
  if (error || !data) {
    console.error("[customer-portal-data] busy-block address lookup failed", error?.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const block of data as Array<{ jobber_visit_id: string | null; client_address: string | null; status: string | null }>) {
    if (!block.jobber_visit_id || !block.client_address) continue;
    if (!map.has(block.jobber_visit_id) || block.status !== "cancelled") {
      map.set(block.jobber_visit_id, block.client_address);
    }
  }
  return map;
}