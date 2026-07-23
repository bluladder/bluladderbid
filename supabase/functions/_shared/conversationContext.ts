// ============================================================================
// conversationContext — deterministic resolver that turns an inbound provider
// message (phone number + optional quote/booking hint) into (a) the best
// available customer record and (b) an SMS thread on the existing
// public.chat_conversations table. Never invents identity: when the phone
// matches multiple customers we record `ambiguous` and defer to a human.
//
// A→E precedence (higher wins):
//   A. Exact match on customers.phone (unique)
//   B. Match via most recent quote/booking whose stored phone equals from_phone
//   C. Match via customer_accounts.phone (verified portal identity)
//   D. Multi-match on customers.phone → ambiguous
//   E. No match → unresolved
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { normalizePhone } from "./sms.ts";

type Supa = any;

export type ResolutionMethod =
  | "phone_exact"
  | "recent_quote"
  | "recent_booking"
  | "customer_account"
  | "ambiguous"
  | "unresolved";

export type ResolutionConfidence = "high" | "medium" | "low" | "ambiguous" | "unknown";

export interface ResolvedContext {
  conversationId: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  latestQuoteId: string | null;
  latestBookingId: string | null;
  serviceAddress: string | null;
  resolutionMethod: ResolutionMethod;
  resolutionConfidence: ResolutionConfidence;
  unresolvedReason: string | null;
  matchNeedsReview: boolean;
}

/**
 * Resolve customer + thread for an inbound SMS. Idempotent: repeated calls
 * with the same `fromPhone` upsert into the SAME chat_conversations row.
 */
export async function resolveInboundContext(
  supabase: Supa,
  input: { fromPhone: string; receivedAt?: string | null },
): Promise<ResolvedContext> {
  const phone = normalizePhone(input.fromPhone) ?? input.fromPhone;
  const now = input.receivedAt ?? new Date().toISOString();

  let customerId: string | null = null;
  let customerName: string | null = null;
  let customerEmail: string | null = null;
  let serviceAddress: string | null = null;
  let method: ResolutionMethod = "unresolved";
  let confidence: ResolutionConfidence = "unknown";
  let unresolvedReason: string | null = "no_customer_match";
  let matchNeedsReview = false;

  // A/D. customers.phone exact
  const { data: customerMatches } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email")
    .eq("phone", phone);
  const customerRows = (customerMatches ?? []) as Array<any>;
  if (customerRows.length === 1) {
    const c = customerRows[0];
    customerId = c.id;
    customerName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
    customerEmail = c.email ?? null;
    method = "phone_exact";
    confidence = "high";
    unresolvedReason = null;
  } else if (customerRows.length > 1) {
    method = "ambiguous";
    confidence = "ambiguous";
    unresolvedReason = "multiple_customers_share_phone";
    matchNeedsReview = true;
  } else {
    // C. customer_accounts.phone (verified portal identity)
    const { data: acct } = await supabase
      .from("customer_accounts")
      .select("id, customer_id")
      .eq("phone", phone)
      .maybeSingle();
    if (acct?.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("id, first_name, last_name, email")
        .eq("id", acct.customer_id)
        .maybeSingle();
      if (c) {
        customerId = c.id;
        customerName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
        customerEmail = c.email ?? null;
        method = "customer_account";
        confidence = "medium";
        unresolvedReason = null;
      }
    }
  }

  // B. Enrich with latest quote / booking (either for the matched customer
  //    OR for anyone sharing this phone number — used only for display).
  let latestQuoteId: string | null = null;
  let latestBookingId: string | null = null;

  const quoteQuery = supabase
    .from("quotes")
    .select("id, customer_id, service_address")
    .order("updated_at", { ascending: false })
    .limit(1);
  const { data: quoteRow } = customerId
    ? await quoteQuery.eq("customer_id", customerId).maybeSingle()
    : await quoteQuery.eq("customer_phone", phone).maybeSingle();
  if (quoteRow) {
    latestQuoteId = quoteRow.id ?? null;
    serviceAddress = quoteRow.service_address ?? serviceAddress;
    if (!customerId && quoteRow.customer_id) {
      customerId = quoteRow.customer_id;
      method = "recent_quote";
      confidence = "medium";
      unresolvedReason = null;
    }
  }

  const bookingQuery = supabase
    .from("bookings")
    .select("id, customer_id, service_address")
    .order("created_at", { ascending: false })
    .limit(1);
  const { data: bookingRow } = customerId
    ? await bookingQuery.eq("customer_id", customerId).maybeSingle()
    : await bookingQuery.eq("customer_phone", phone).maybeSingle();
  if (bookingRow) {
    latestBookingId = bookingRow.id ?? null;
    serviceAddress = serviceAddress ?? bookingRow.service_address ?? null;
    if (!customerId && bookingRow.customer_id) {
      customerId = bookingRow.customer_id;
      method = "recent_booking";
      confidence = "medium";
      unresolvedReason = null;
    }
  }

  // Upsert the SMS thread (find-or-create by prospect_phone).
  const { data: existingThread } = await supabase
    .from("chat_conversations")
    .select("id, customer_id")
    .eq("channel", "sms")
    .eq("prospect_phone", phone)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  if (existingThread?.id) {
    conversationId = existingThread.id;
    await supabase
      .from("chat_conversations")
      .update({
        customer_id: existingThread.customer_id ?? customerId,
        resolution_method: method,
        resolution_confidence: confidence,
        unresolved_reason: unresolvedReason,
        service_address: serviceAddress ?? undefined,
        prospect_name: customerName ?? undefined,
        prospect_email: customerEmail ?? undefined,
        last_inbound_at: now,
        last_activity_at: now,
      })
      .eq("id", conversationId);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("chat_conversations")
      .insert({
        session_token: `sms:${phone}:${crypto.randomUUID()}`,
        channel: "sms",
        status: "active",
        prospect_phone: phone,
        prospect_name: customerName,
        prospect_email: customerEmail,
        service_address: serviceAddress,
        customer_id: customerId,
        resolution_method: method,
        resolution_confidence: confidence,
        unresolved_reason: unresolvedReason,
        last_inbound_at: now,
        last_activity_at: now,
        summary: "SMS conversation",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw insErr ?? new Error("thread_insert_failed");
    }
    conversationId = inserted.id;
  }

  return {
    conversationId,
    customerId,
    customerName,
    customerEmail,
    latestQuoteId,
    latestBookingId,
    serviceAddress,
    resolutionMethod: method,
    resolutionConfidence: confidence,
    unresolvedReason,
    matchNeedsReview,
  };
}