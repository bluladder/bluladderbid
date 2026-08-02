// ============================================================================
// Tenant-safe local booking identity preparation for deterministic voice.
//
// This creates/links only BluLadder-local customer/property rows after every
// identity and address prerequisite is explicitly confirmed. It never calls
// Jobber or any other provider. Deterministic ids plus winner rereads make a
// retried/concurrent turn converge without broad upserts.
// ============================================================================

import { deterministicUuid } from "../deterministicUuid.ts";
import {
  normalizeEmail,
  normalizePhone,
  type QuoteSession,
} from "../quoteSession.ts";
import { parseAddress } from "../profile/normalizeAddress.ts";

// deno-lint-ignore no-explicit-any
type SB = any;
type Row = Record<string, unknown>;
type QueryResult = { data?: unknown; error?: unknown };

export type VoiceIdentityPreparationBlocker =
  | "name_unconfirmed"
  | "name_incomplete"
  | "email_unconfirmed"
  | "phone_unconfirmed"
  | "address_unconfirmed"
  | "address_incomplete"
  | "service_area_not_eligible"
  | "service_area_unconfirmed"
  | "customer_ambiguous"
  | "customer_contact_conflict"
  | "customer_name_conflict"
  | "customer_create_conflict"
  | "property_ambiguous"
  | "property_ownership_conflict"
  | "property_create_conflict"
  | "property_link_conflict"
  | "lineage_persistence_failed";

export type VoiceIdentityPreparationResult =
  | {
    status: "ready";
    customerId: string;
    propertyId: string;
    customerCreated: boolean;
    propertyCreated: boolean;
  }
  | {
    status: "not_ready" | "blocked" | "error";
    blocker: VoiceIdentityPreparationBlocker;
  };

function isConfirmed(status: unknown): boolean {
  return status === "verified" || status === "corrected";
}

function splitConfirmedName(
  name: string,
): { firstName: string; lastName: string } | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" &&
    a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function readRows(
  query: PromiseLike<QueryResult>,
): Promise<{ rows: Row[]; error: unknown }> {
  try {
    const result = await query;
    return {
      rows: Array.isArray(result?.data)
        ? result.data
        : result?.data
        ? [result.data]
        : [],
      error: result?.error ?? null,
    };
  } catch (error) {
    return { rows: [], error };
  }
}

export interface VoiceIdentityPreparationFacts {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  normalizedAddress: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Pure gate; tests can prove defaults/captured facts never become identity. */
export function voiceIdentityPreparationFacts(
  session: QuoteSession,
): VoiceIdentityPreparationFacts | VoiceIdentityPreparationBlocker {
  const fields = session.fields;
  if (!isConfirmed(session.fieldStatus.name)) return "name_unconfirmed";
  const name = String(fields.name ?? "").trim();
  const split = splitConfirmedName(name);
  if (!split) return "name_incomplete";
  if (!isConfirmed(session.fieldStatus.email)) return "email_unconfirmed";
  const email = normalizeEmail(fields.email ?? null);
  if (!email) return "email_unconfirmed";
  const phoneConfirmed = isConfirmed(session.fieldStatus.phone) ||
    fields.callerIdConfirmationStatus === "contact_confirmed" ||
    fields.callerIdConfirmationStatus === "confirmed";
  const phone = normalizePhone(fields.phone ?? null);
  if (!phoneConfirmed || !phone) return "phone_unconfirmed";
  if (!isConfirmed(session.fieldStatus.address)) return "address_unconfirmed";
  if (fields.serviceAreaStatus !== "eligible") {
    return "service_area_not_eligible";
  }
  if (!isConfirmed(session.fieldStatus.serviceAreaStatus)) {
    return "service_area_unconfirmed";
  }
  const canonicalAddress = String(
    (fields.serviceAreaResult?.formattedAddress as string | undefined) ??
      fields.address ?? "",
  ).trim();
  const parsed = parseAddress(canonicalAddress);
  if (
    !parsed.normalized || !parsed.street || !parsed.city || !parsed.state ||
    !parsed.postalCode
  ) return "address_incomplete";
  return {
    name,
    ...split,
    email,
    phone,
    address: canonicalAddress,
    normalizedAddress: parsed.normalized,
    street: parsed.street,
    city: parsed.city,
    state: parsed.state,
    postalCode: parsed.postalCode,
  };
}

async function resolveOrCreateCustomer(
  supabase: SB,
  organizationId: string,
  facts: VoiceIdentityPreparationFacts,
  expectedCustomerId: string | null,
): Promise<
  | { ok: true; id: string; created: boolean }
  | { ok: false; blocker: VoiceIdentityPreparationBlocker }
> {
  if (expectedCustomerId) {
    const linked = await supabase.from("customers")
      .select("id, organization_id, email, phone, first_name, last_name")
      .eq("id", expectedCustomerId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (linked?.error || !linked?.data) {
      return { ok: false, blocker: "customer_contact_conflict" };
    }
    if (
      !sameText(linked.data.email, facts.email) ||
      normalizePhone(String(linked.data.phone ?? "")) !== facts.phone
    ) return { ok: false, blocker: "customer_contact_conflict" };
    if (
      !sameText(linked.data.first_name, facts.firstName) ||
      !sameText(linked.data.last_name, facts.lastName)
    ) return { ok: false, blocker: "customer_name_conflict" };
    return { ok: true, id: expectedCustomerId, created: false };
  }
  const existing = await readRows(
    supabase.from("customers")
      .select("id, organization_id, email, phone, first_name, last_name")
      .eq("organization_id", organizationId)
      .ilike("email", facts.email)
      .limit(2),
  );
  if (existing.error) return { ok: false, blocker: "customer_create_conflict" };
  if (existing.rows.length > 1) {
    return { ok: false, blocker: "customer_ambiguous" };
  }
  if (existing.rows.length === 1) {
    const row = existing.rows[0];
    if (normalizePhone(String(row.phone ?? "")) !== facts.phone) {
      return { ok: false, blocker: "customer_contact_conflict" };
    }
    if (
      !sameText(row.first_name, facts.firstName) ||
      !sameText(row.last_name, facts.lastName)
    ) return { ok: false, blocker: "customer_name_conflict" };
    return { ok: true, id: String(row.id), created: false };
  }

  const id = await deterministicUuid(
    "voice-customer",
    organizationId,
    facts.email,
  );
  const inserted = await supabase.from("customers").insert({
    id,
    organization_id: organizationId,
    email: facts.email,
    phone: facts.phone,
    first_name: facts.firstName,
    last_name: facts.lastName,
    address: facts.address,
  }).select("id, organization_id, email, phone, first_name, last_name")
    .maybeSingle();
  if (!inserted?.error && inserted?.data?.id === id) {
    return { ok: true, id, created: true };
  }
  // Concurrent winner is acceptable only at our deterministic id and tenant.
  const winner = await supabase.from("customers")
    .select("id, organization_id, email, phone, first_name, last_name")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (
    !winner?.error && winner?.data &&
    sameText(winner.data.email, facts.email) &&
    normalizePhone(String(winner.data.phone ?? "")) === facts.phone &&
    sameText(winner.data.first_name, facts.firstName) &&
    sameText(winner.data.last_name, facts.lastName)
  ) return { ok: true, id, created: false };
  // A global unique-email or cross-tenant collision is intentionally opaque.
  return { ok: false, blocker: "customer_create_conflict" };
}

async function resolveOrCreateProperty(
  supabase: SB,
  organizationId: string,
  customerId: string,
  facts: VoiceIdentityPreparationFacts,
  expectedPropertyId: string | null,
): Promise<
  | { ok: true; id: string; created: boolean }
  | { ok: false; blocker: VoiceIdentityPreparationBlocker }
> {
  let propertyId = expectedPropertyId ?? "";
  if (expectedPropertyId) {
    const linked = await supabase.from("properties")
      .select("id, organization_id, normalized_address")
      .eq("id", expectedPropertyId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (
      linked?.error || !linked?.data ||
      linked.data.normalized_address !== facts.normalizedAddress
    ) return { ok: false, blocker: "property_ownership_conflict" };
  } else {
    const existing = await readRows(
      supabase.from("properties")
        .select("id, organization_id, normalized_address")
        .eq("organization_id", organizationId)
        .eq("normalized_address", facts.normalizedAddress)
        .limit(2),
    );
    if (existing.error) {
      return { ok: false, blocker: "property_create_conflict" };
    }
    if (existing.rows.length > 1) {
      return { ok: false, blocker: "property_ambiguous" };
    }
    propertyId = existing.rows.length === 1 ? String(existing.rows[0].id) : "";
  }
  let created = false;
  if (!propertyId) {
    propertyId = await deterministicUuid(
      "voice-property",
      organizationId,
      facts.normalizedAddress,
    );
    const inserted = await supabase.from("properties").insert({
      id: propertyId,
      organization_id: organizationId,
      normalized_address: facts.normalizedAddress,
      street: facts.street,
      city: facts.city,
      state: facts.state,
      postal_code: facts.postalCode,
      property_type: "residential",
      active: true,
    }).select("id, organization_id, normalized_address").maybeSingle();
    if (!inserted?.error && inserted?.data?.id === propertyId) created = true;
    else {
      const winner = await supabase.from("properties")
        .select("id, organization_id, normalized_address")
        .eq("id", propertyId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (
        winner?.error || !winner?.data ||
        winner.data.normalized_address !== facts.normalizedAddress
      ) return { ok: false, blocker: "property_create_conflict" };
    }
  }

  // A verified address already linked to another local customer is ambiguous
  // for autonomous voice. Staff can later establish a shared-household role.
  const owners = await readRows(
    supabase.from("customer_properties")
      .select("id, customer_id, property_id, active")
      .eq("property_id", propertyId)
      .eq("active", true)
      .limit(2),
  );
  if (owners.error) return { ok: false, blocker: "property_link_conflict" };
  if (owners.rows.some((row) => row.customer_id !== customerId)) {
    return { ok: false, blocker: "property_ownership_conflict" };
  }
  if (!owners.rows.some((row) => row.customer_id === customerId)) {
    const linkId = await deterministicUuid(
      "voice-customer-property",
      organizationId,
      customerId,
      propertyId,
    );
    const inserted = await supabase.from("customer_properties").insert({
      id: linkId,
      customer_id: customerId,
      property_id: propertyId,
      relationship_type: "owner",
      authorization_status: "self_asserted",
      is_primary: false,
      active: true,
    }).select("id, customer_id, property_id, active").maybeSingle();
    if (inserted?.error || !inserted?.data) {
      const winner = await supabase.from("customer_properties")
        .select("id, customer_id, property_id, active")
        .eq("id", linkId)
        .eq("customer_id", customerId)
        .eq("property_id", propertyId)
        .eq("active", true)
        .maybeSingle();
      if (winner?.error || !winner?.data) {
        return { ok: false, blocker: "property_link_conflict" };
      }
    }
  }
  return { ok: true, id: propertyId, created };
}

export async function prepareVoiceBookingIdentity(
  supabase: SB,
  args: {
    session: QuoteSession;
    conversationId: string;
    organizationId: string;
  },
): Promise<VoiceIdentityPreparationResult> {
  if (!args.session.conversationIds.includes(args.conversationId)) {
    return { status: "blocked", blocker: "lineage_persistence_failed" };
  }
  const facts = voiceIdentityPreparationFacts(args.session);
  if (typeof facts === "string") return { status: "not_ready", blocker: facts };
  try {
    const conversation = await supabase.from("chat_conversations")
      .select("id, organization_id, quote_session_id, customer_id, property_id")
      .eq("id", args.conversationId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();
    if (conversation?.error || !conversation?.data) {
      return { status: "error", blocker: "lineage_persistence_failed" };
    }
    if (
      conversation.data.quote_session_id &&
      conversation.data.quote_session_id !== args.session.id
    ) return { status: "blocked", blocker: "lineage_persistence_failed" };
    if (
      args.session.customerId && conversation.data.customer_id &&
      args.session.customerId !== conversation.data.customer_id
    ) return { status: "blocked", blocker: "customer_contact_conflict" };
    if (
      args.session.propertyId && conversation.data.property_id &&
      args.session.propertyId !== conversation.data.property_id
    ) return { status: "blocked", blocker: "property_ownership_conflict" };
    const expectedCustomerId = args.session.customerId ??
      conversation.data.customer_id ?? null;
    const expectedPropertyId = args.session.propertyId ??
      conversation.data.property_id ?? null;
    const customer = await resolveOrCreateCustomer(
      supabase,
      args.organizationId,
      facts,
      expectedCustomerId,
    );
    if (!customer.ok) return { status: "blocked", blocker: customer.blocker };
    const property = await resolveOrCreateProperty(
      supabase,
      args.organizationId,
      customer.id,
      facts,
      expectedPropertyId,
    );
    if (!property.ok) return { status: "blocked", blocker: property.blocker };

    let sessionUpdate = supabase.from("quote_sessions").update({
      customer_id: customer.id,
      property_id: property.id,
      phone_e164: facts.phone,
      email_normalized: facts.email,
    }).eq("id", args.session.id)
      .eq("organization_id", args.organizationId);
    sessionUpdate = args.session.customerId
      ? sessionUpdate.eq("customer_id", args.session.customerId)
      : sessionUpdate.is("customer_id", null);
    sessionUpdate = args.session.propertyId
      ? sessionUpdate.eq("property_id", args.session.propertyId)
      : sessionUpdate.is("property_id", null);
    const sessionWrite = await sessionUpdate.select("id").maybeSingle();
    if (sessionWrite?.error || !sessionWrite?.data) {
      return { status: "error", blocker: "lineage_persistence_failed" };
    }

    let conversationUpdate = supabase.from("chat_conversations").update({
      customer_id: customer.id,
      confirmed_email: facts.email,
      confirmed_email_at: new Date().toISOString(),
      confirmed_email_customer_id: customer.id,
      property_id: property.id,
      quote_session_id: args.session.id,
      resolution_method: "customer_account",
      resolution_confidence: "verified_email_and_contact",
      awaiting_email_disambiguation: false,
      unresolved_reason: null,
    }).eq("id", args.conversationId)
      .eq("organization_id", args.organizationId);
    conversationUpdate = conversation.data.customer_id
      ? conversationUpdate.eq("customer_id", conversation.data.customer_id)
      : conversationUpdate.is("customer_id", null);
    conversationUpdate = conversation.data.property_id
      ? conversationUpdate.eq("property_id", conversation.data.property_id)
      : conversationUpdate.is("property_id", null);
    conversationUpdate = conversation.data.quote_session_id
      ? conversationUpdate.eq(
        "quote_session_id",
        conversation.data.quote_session_id,
      )
      : conversationUpdate.is("quote_session_id", null);
    const conversationWrite = await conversationUpdate.select("id")
      .maybeSingle();
    if (conversationWrite?.error || !conversationWrite?.data) {
      return { status: "error", blocker: "lineage_persistence_failed" };
    }

    if (args.session.quoteId) {
      const quote = await supabase.from("quotes")
        .select("id, organization_id, customer_id, property_id")
        .eq("id", args.session.quoteId)
        .eq("organization_id", args.organizationId)
        .maybeSingle();
      if (
        quote?.error || !quote?.data ||
        (quote.data.customer_id && quote.data.customer_id !== customer.id) ||
        (quote.data.property_id && quote.data.property_id !== property.id)
      ) return { status: "blocked", blocker: "lineage_persistence_failed" };
      const quoteWrite = await supabase.from("quotes").update({
        customer_id: customer.id,
        property_id: property.id,
      }).eq("id", args.session.quoteId)
        .eq("organization_id", args.organizationId)
        .select("id").maybeSingle();
      if (quoteWrite?.error || !quoteWrite?.data) {
        return { status: "error", blocker: "lineage_persistence_failed" };
      }
    }

    return {
      status: "ready",
      customerId: customer.id,
      propertyId: property.id,
      customerCreated: customer.created,
      propertyCreated: property.created,
    };
  } catch {
    return { status: "error", blocker: "lineage_persistence_failed" };
  }
}
