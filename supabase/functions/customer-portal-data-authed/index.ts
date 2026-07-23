// Supabase-Auth-backed portal data endpoint. Mirrors customer-portal-data but
// resolves the customer identity from the caller's JWT (auth_user_id) instead
// of the legacy portal session token. Every returned row is scoped to the
// customer identity linked to the authenticated user.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const token = auth.slice(7);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u } = await userClient.auth.getUser(token);
  const user = u?.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: account } = await service
    .from("customer_accounts")
    .select("id, customer_id, verified_phone, verified_email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!account) return json({ error: "not_linked" }, 404);

  const orFilters: string[] = [];
  if (account.verified_phone) orFilters.push(`phone.eq.${account.verified_phone}`);
  if (account.verified_email) orFilters.push(`email.eq.${account.verified_email.toLowerCase()}`);
  let customerIds: string[] = [account.customer_id];
  if (orFilters.length > 0) {
    const { data: matches } = await service
      .from("customers").select("id").or(orFilters.join(","));
    if (matches?.length) {
      customerIds = Array.from(new Set([account.customer_id, ...matches.map((m: { id: string }) => m.id)]));
    }
  }

  const [customer, quotes, upcoming, completed] = await Promise.all([
    service.from("customers").select("first_name, last_name, address").eq("id", account.customer_id).maybeSingle(),
    service.from("quotes")
      .select("id, created_at, total, status, services_json, line_item_snapshot, home_details_json")
      .in("customer_id", customerIds)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false }).limit(20),
    service.from("bookings")
      .select("id, reference_number, scheduled_start, scheduled_end, status, services_json, total, jobber_visit_id, jobber_job_id, home_details_json")
      .in("customer_id", customerIds)
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .order("scheduled_start", { ascending: true }).limit(20),
    service.from("bookings")
      .select("id, reference_number, scheduled_start, status, services_json, total, jobber_visit_id, jobber_job_id, home_details_json")
      .in("customer_id", customerIds).eq("status", "completed")
      .order("scheduled_start", { ascending: false }).limit(20),
  ]);

  if (quotes.error || upcoming.error || completed.error) {
    console.error("[customer-portal-data-authed] data load error", {
      quotes: quotes.error?.message,
      upcoming: upcoming.error?.message,
      completed: completed.error?.message,
    });
  }

  const addressByVisit = await loadAddressesByVisit(service, [
    ...((upcoming.data ?? []) as BookingRow[]),
    ...((completed.data ?? []) as BookingRow[]),
  ]);
  const fallbackAddress = customer.data?.address ?? null;

  return json({
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
  });
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

async function loadAddressesByVisit(service: ReturnType<typeof createClient>, rows: BookingRow[]): Promise<Map<string, string>> {
  const visitIds = Array.from(new Set(rows.map((r) => r.jobber_visit_id).filter(Boolean) as string[]));
  if (visitIds.length === 0) return new Map();

  const { data, error } = await service
    .from("jobber_busy_blocks")
    .select("jobber_visit_id, client_address, status, updated_at")
    .in("jobber_visit_id", visitIds)
    .order("updated_at", { ascending: false });
  if (error || !data) {
    console.error("[customer-portal-data-authed] busy-block address lookup failed", error?.message);
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}