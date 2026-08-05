// ============================================================================
// Tenant-scoped phone candidate lookup for deterministic voice intake.
//
// A provider-supplied phone number is never tenant or customer authority. The
// caller must first confirm the number, then this read-only resolver may return
// one opaque same-tenant candidate. Candidate names are reduced to a
// deterministic verification token and are never returned for speech.
// ============================================================================

import { deterministicUuid } from "../deterministicUuid.ts";
import { normalizePhone } from "../quoteSession.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export interface ResolvedCustomerCandidate {
  customerId: string;
  /** Opaque comparison token; never spoken or persisted. */
  nameVerificationToken: string;
}

export type ResolveResult =
  | { kind: "resolved"; customer: ResolvedCustomerCandidate }
  | { kind: "ambiguous" }
  | { kind: "unverifiable" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function nameVerificationToken(input: {
  organizationId: string;
  customerId: string;
  phoneE164: string;
  name: string;
}): Promise<string> {
  return await deterministicUuid(
    "voice-phone-candidate-name-v1",
    input.organizationId,
    input.customerId,
    input.phoneE164,
    normalizedName(input.name),
  );
}

/** Compare caller-supplied, already-confirmed name without exposing the stored
 * candidate name outside this module. */
export async function verifiedNameMatchesCustomerCandidate(input: {
  organizationId: string;
  phoneE164: string;
  suppliedName: string;
  customer: ResolvedCustomerCandidate;
}): Promise<boolean> {
  const phone = normalizePhone(input.phoneE164);
  const name = normalizedName(input.suppliedName);
  if (!phone || !name) return false;
  const supplied = await nameVerificationToken({
    organizationId: input.organizationId,
    customerId: input.customer.customerId,
    phoneE164: phone,
    name,
  });
  return supplied === input.customer.nameVerificationToken;
}

/**
 * Resolve exactly one normalized phone candidate inside the already-resolved
 * authoritative organization. Query failures remain distinct from zero
 * matches so callers cannot mistake uncertainty for a verified customer.
 */
export async function resolveCustomerByPhone(
  supabase: SB,
  organizationId: string,
  phoneCandidate: string,
): Promise<ResolveResult> {
  const phoneE164 = normalizePhone(phoneCandidate);
  if (!organizationId.trim() || !phoneE164) return { kind: "unavailable" };
  const national = phoneE164.slice(-10);
  const variants = [
    ...new Set([
      phoneE164,
      phoneE164.slice(1),
      national,
      `1${national}`,
      `+1${national}`,
    ]),
  ];
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id, organization_id, first_name, last_name, phone")
      .eq("organization_id", organizationId)
      .in("phone", variants)
      .limit(5);
    if (error || !Array.isArray(data)) return { kind: "unavailable" };

    // Defense in depth: do not rely only on the query builder stub or RLS.
    // Every returned row must independently prove exact tenant and normalized
    // phone equality before it can participate in candidate selection.
    const unique = new Map<string, Record<string, unknown>>();
    for (const row of data) {
      if (
        !row || typeof row !== "object" ||
        row.organization_id !== organizationId ||
        normalizePhone(String(row.phone ?? "")) !== phoneE164 ||
        typeof row.id !== "string" || !row.id
      ) continue;
      unique.set(row.id, row as Record<string, unknown>);
    }
    if (unique.size === 0) return { kind: "not_found" };
    if (unique.size !== 1) return { kind: "ambiguous" };
    const only = [...unique.values()][0];
    const fullName = [only.first_name, only.last_name]
      .filter((part): part is string =>
        typeof part === "string" && part.trim().length > 0
      )
      .join(" ");
    if (!fullName || fullName.split(/\s+/).length < 2) {
      return { kind: "unverifiable" };
    }
    return {
      kind: "resolved",
      customer: {
        customerId: String(only.id),
        nameVerificationToken: await nameVerificationToken({
          organizationId,
          customerId: String(only.id),
          phoneE164,
          name: fullName,
        }),
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
