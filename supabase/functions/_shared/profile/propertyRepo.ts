// ============================================================================
// propertyRepo — server-side repository for the customer↔property↔facts
// layer. All model-facing AI tools must go through this file so callers
// cannot bypass identity/authorization checks.
//
// Contract:
//   * The AI never passes an arbitrary property_id or customer_id. Callers
//     resolve the customer from the conversation, then pass the resolved
//     customerId here. Every mutating call re-checks membership.
//   * We never silently overwrite technician/admin/jobber facts — proposed
//     values from customer/AI sources are stored as separate rows with
//     provenance and either supersede or flag a conflict.
//   * We never expose raw provenance (source_record_id, created_by_id) to
//     the customer surface.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { parseAddress } from "./normalizeAddress.ts";
import {
  isFactAllowedForService,
  isStale,
  requiredFactsForService,
  type FactType,
  type ServiceKind,
} from "./serviceFactMap.ts";

type SB = any;

export interface ResolvedCustomerProfile {
  customerId: string;
  firstName: string | null;
  lastName: string | null;
  preferredPhone: string | null;
  preferredEmail: string | null;
  preferredContactMethod: string | null;
  customerType: string;
  jobberClientId: string | null;
}

export interface CustomerProperty {
  propertyId: string;
  label: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  isPrimary: boolean;
  relationshipType: string;
  active: boolean;
}

export interface CurrentFact {
  factType: string;
  value: number | string | null;
  unit: string | null;
  source: string;
  verificationStatus: string;
  lastVerifiedAt: string | null;
  stale: boolean;
}

export interface AutofillReport {
  reusable: CurrentFact[];
  stale: CurrentFact[];
  missing: string[];
  confirmRequired: CurrentFact[];
}

// -- resolvers --------------------------------------------------------------

export async function getResolvedCustomerProfile(
  supabase: SB,
  customerId: string,
): Promise<ResolvedCustomerProfile | null> {
  const { data } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone, email, preferred_phone, preferred_email, preferred_contact_method, customer_type, jobber_client_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!data) return null;
  return {
    customerId: data.id,
    firstName: data.first_name,
    lastName: data.last_name,
    preferredPhone: data.preferred_phone ?? data.phone ?? null,
    preferredEmail: data.preferred_email ?? data.email ?? null,
    preferredContactMethod: data.preferred_contact_method ?? null,
    customerType: data.customer_type ?? "homeowner",
    jobberClientId: data.jobber_client_id ?? null,
  };
}

export async function getCustomerProperties(
  supabase: SB,
  customerId: string,
): Promise<CustomerProperty[]> {
  const { data } = await supabase
    .from("customer_properties")
    .select("property_id, label, is_primary, relationship_type, active, property:properties(street, city, state, postal_code, active)")
    .eq("customer_id", customerId)
    .eq("active", true);
  return (data ?? []).map((r: any) => ({
    propertyId: r.property_id,
    label: r.label,
    street: r.property?.street ?? null,
    city: r.property?.city ?? null,
    state: r.property?.state ?? null,
    postalCode: r.property?.postal_code ?? null,
    isPrimary: !!r.is_primary,
    relationshipType: r.relationship_type,
    active: !!r.active && !!r.property?.active,
  }));
}

/** Auth check: is this property one of the customer's active linked properties? */
export async function customerOwnsProperty(
  supabase: SB,
  customerId: string,
  propertyId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("customer_properties")
    .select("id")
    .eq("customer_id", customerId)
    .eq("property_id", propertyId)
    .eq("active", true)
    .maybeSingle();
  return !!data;
}

/** Attach a property to the current conversation + quote session. Only
 *  succeeds if the property is linked to the resolved customer. */
export async function selectConversationProperty(
  supabase: SB,
  args: { conversationId: string; quoteSessionId?: string | null; customerId: string; propertyId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await customerOwnsProperty(supabase, args.customerId, args.propertyId))) {
    return { ok: false, error: "property_not_linked_to_customer" };
  }
  await supabase.from("chat_conversations")
    .update({ property_id: args.propertyId })
    .eq("id", args.conversationId);
  if (args.quoteSessionId) {
    await supabase.from("quote_sessions")
      .update({ property_id: args.propertyId })
      .eq("id", args.quoteSessionId);
  }
  return { ok: true };
}

// -- facts ------------------------------------------------------------------

export async function getPropertyProfile(
  supabase: SB,
  propertyId: string,
): Promise<CurrentFact[]> {
  const { data } = await supabase
    .from("property_facts_current")
    .select("fact_type, value_numeric, value_text, unit, source, verification_status, last_verified_at")
    .eq("property_id", propertyId);
  return (data ?? []).map((r: any) => ({
    factType: r.fact_type,
    value: r.value_numeric ?? r.value_text,
    unit: r.unit,
    source: r.source,
    verificationStatus: r.verification_status,
    lastVerifiedAt: r.last_verified_at,
    stale: isStale(r.fact_type as FactType, r.last_verified_at),
  }));
}

export async function getReusableQuoteInputs(
  supabase: SB,
  args: { propertyId: string; service: ServiceKind },
): Promise<AutofillReport> {
  const facts = await getPropertyProfile(supabase, args.propertyId);
  const allowed = facts.filter((f) => isFactAllowedForService(args.service, f.factType as FactType));
  const reusable: CurrentFact[] = [];
  const stale: CurrentFact[] = [];
  const confirmRequired: CurrentFact[] = [];
  for (const f of allowed) {
    if (f.verificationStatus === "conflicting" || f.verificationStatus === "needs_review") {
      confirmRequired.push(f);
    } else if (f.stale) {
      stale.push(f);
    } else {
      reusable.push(f);
    }
  }
  const have = new Set(reusable.map((f) => f.factType));
  const missing = requiredFactsForService(args.service).filter((t) => !have.has(t));
  return { reusable, stale, missing, confirmRequired };
}

// -- fact writes ------------------------------------------------------------

const HIGH_TRUST = new Set(["technician", "admin", "jobber"]);

export interface ProposeFactInput {
  propertyId: string;
  factType: FactType;
  valueNumeric?: number | null;
  valueText?: string | null;
  unit?: string | null;
  source: "customer_provided" | "ai_inferred" | "prior_quote" | "booking" | "imported";
  sourceRecordId?: string | null;
  createdByType?: string;
  createdById?: string | null;
}

/** Stage a new value. Never overwrites; always inserts a new row. Callers
 *  use `confirmPropertyFact` to actually make it the current value. */
export async function proposePropertyFact(
  supabase: SB,
  input: ProposeFactInput,
): Promise<{ ok: boolean; conflict?: boolean; existing?: CurrentFact | null; id?: string }> {
  const existing = await currentFact(supabase, input.propertyId, input.factType);
  const conflict = !!existing && conflictsWith(existing, input);
  const verification = conflict && existing && HIGH_TRUST.has(existing.source)
    ? "needs_review"
    : (input.source === "ai_inferred" ? "inferred" : "customer_provided");
  const { data, error } = await supabase.from("property_facts").insert({
    property_id: input.propertyId,
    fact_type: input.factType,
    value_numeric: input.valueNumeric ?? null,
    value_text: input.valueText ?? null,
    unit: input.unit ?? null,
    source: input.source,
    source_record_id: input.sourceRecordId ?? null,
    verification_status: verification,
    observed_at: new Date().toISOString(),
    created_by_type: input.createdByType ?? "system",
    created_by_id: input.createdById ?? null,
  }).select("id").single();
  if (error) return { ok: false };
  return { ok: true, conflict, existing, id: data.id };
}

/** Controlled write: only proceeds when the value would not silently
 *  overwrite a technician/admin/jobber fact. */
export async function confirmPropertyFact(
  supabase: SB,
  input: ProposeFactInput & { confirmedByType?: string; confirmedById?: string | null },
): Promise<{ ok: boolean; needsReview?: boolean; error?: string }> {
  const existing = await currentFact(supabase, input.propertyId, input.factType);
  if (existing && HIGH_TRUST.has(existing.source) && conflictsWith(existing, input)) {
    // Do not overwrite; log a needs_review candidate for admin.
    await proposePropertyFact(supabase, input);
    return { ok: false, needsReview: true, error: "high_trust_conflict" };
  }
  // Supersede prior rows of this fact_type for this property.
  await supabase.from("property_facts")
    .update({ superseded_at: new Date().toISOString() })
    .eq("property_id", input.propertyId)
    .eq("fact_type", input.factType)
    .is("superseded_at", null);
  const { error } = await supabase.from("property_facts").insert({
    property_id: input.propertyId,
    fact_type: input.factType,
    value_numeric: input.valueNumeric ?? null,
    value_text: input.valueText ?? null,
    unit: input.unit ?? null,
    source: input.source,
    source_record_id: input.sourceRecordId ?? null,
    verification_status: "customer_provided",
    observed_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    created_by_type: input.confirmedByType ?? input.createdByType ?? "system",
    created_by_id: input.confirmedById ?? input.createdById ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function currentFact(supabase: SB, propertyId: string, factType: string): Promise<CurrentFact | null> {
  const { data } = await supabase
    .from("property_facts_current")
    .select("fact_type, value_numeric, value_text, unit, source, verification_status, last_verified_at")
    .eq("property_id", propertyId)
    .eq("fact_type", factType)
    .maybeSingle();
  if (!data) return null;
  return {
    factType: data.fact_type,
    value: data.value_numeric ?? data.value_text,
    unit: data.unit,
    source: data.source,
    verificationStatus: data.verification_status,
    lastVerifiedAt: data.last_verified_at,
    stale: isStale(data.fact_type as FactType, data.last_verified_at),
  };
}

function conflictsWith(existing: CurrentFact, incoming: ProposeFactInput): boolean {
  if (incoming.valueNumeric !== undefined && incoming.valueNumeric !== null) {
    const oldNum = typeof existing.value === "number" ? existing.value : Number(existing.value);
    if (!Number.isFinite(oldNum)) return true;
    // Numeric conflict if delta > 5% and > 25 (avoid rounding noise).
    const delta = Math.abs(oldNum - incoming.valueNumeric);
    return delta > 25 && delta / Math.max(oldNum, 1) > 0.05;
  }
  if (incoming.valueText !== undefined && incoming.valueText !== null) {
    return String(existing.value ?? "").toLowerCase().trim() !==
      String(incoming.valueText).toLowerCase().trim();
  }
  return false;
}

// -- property upsert (used by backfill + AI when creating a new property) --

export async function upsertPropertyByAddress(
  supabase: SB,
  raw: string,
): Promise<{ ok: boolean; propertyId?: string; created?: boolean; error?: string }> {
  const parsed = parseAddress(raw);
  if (!parsed.normalized) return { ok: false, error: "empty_address" };
  const { data: existing } = await supabase
    .from("properties").select("id").eq("normalized_address", parsed.normalized).maybeSingle();
  if (existing?.id) return { ok: true, propertyId: existing.id, created: false };
  const { data, error } = await supabase.from("properties").insert({
    normalized_address: parsed.normalized,
    street: parsed.street || raw,
    city: parsed.city || null,
    state: parsed.state || null,
    postal_code: parsed.postalCode || null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, propertyId: data.id, created: true };
}

export async function linkCustomerToProperty(
  supabase: SB,
  args: { customerId: string; propertyId: string; isPrimary?: boolean; relationshipType?: string; label?: string | null },
): Promise<void> {
  const { data: existing } = await supabase
    .from("customer_properties").select("id, is_primary")
    .eq("customer_id", args.customerId).eq("property_id", args.propertyId).maybeSingle();
  if (existing?.id) return;
  // Only claim primary if the customer has none yet.
  let isPrimary = !!args.isPrimary;
  if (isPrimary) {
    const { data: hasPrimary } = await supabase
      .from("customer_properties").select("id")
      .eq("customer_id", args.customerId).eq("is_primary", true).maybeSingle();
    if (hasPrimary) isPrimary = false;
  }
  await supabase.from("customer_properties").insert({
    customer_id: args.customerId,
    property_id: args.propertyId,
    relationship_type: args.relationshipType ?? "owner",
    label: args.label ?? null,
    is_primary: isPrimary,
  });
}