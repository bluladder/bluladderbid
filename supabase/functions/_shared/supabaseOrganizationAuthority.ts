import type {
  OrganizationAuthorityRepository,
  OrganizationLookupResult,
  OrganizationResolutionKeyType,
  OrganizationResourceSelector,
} from "./organizationAuthority.ts";
import type { OrganizationSignal } from "./organizationResolver.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const RESOURCE_TABLES: Record<
  OrganizationResourceSelector["kind"],
  string
> = {
  conversation: "chat_conversations",
  quote_session: "quote_sessions",
  customer: "customers",
  property: "properties",
  quote: "quotes",
  booking: "bookings",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validOrganizationSignal(signal: OrganizationSignal): boolean {
  return UUID_PATTERN.test(signal.organizationId);
}

export function createSupabaseOrganizationAuthorityRepository(
  supabase: SB,
): OrganizationAuthorityRepository {
  return {
    async findResourceSignals(selectors) {
      const signals: OrganizationSignal[] = [];
      for (const selector of selectors) {
        const table = RESOURCE_TABLES[selector.kind];
        const { data, error } = await supabase.from(table)
          .select("organization_id")
          .eq("id", selector.id)
          .limit(2);
        if (error) return { ok: false, reason: "lookup_unavailable" };
        if ((data ?? []).length > 1) return { ok: false, reason: "ambiguous" };
        const organizationId = data?.[0]?.organization_id;
        if (typeof organizationId === "string") {
          signals.push({
            organizationId,
            source: "resource",
            evidence: `resource:${selector.kind}`,
          });
        }
      }
      return validSignals(signals);
    },

    async findMembershipSignals(args) {
      let query = supabase.from("organization_memberships")
        .select("organization_id")
        .eq("user_id", args.authenticatedUserId)
        .eq("status", "active")
        .limit(2);
      if (args.requestedOrganizationId) {
        query = query.eq("organization_id", args.requestedOrganizationId);
      }
      const { data, error } = await query;
      if (error) return { ok: false, reason: "lookup_unavailable" };
      if ((data ?? []).length > 1 && !args.requestedOrganizationId) {
        return { ok: false, reason: "ambiguous" };
      }
      return validSignals(
        (data ?? []).map((row: { organization_id: string }) => ({
          organizationId: row.organization_id,
          source: "membership" as const,
          evidence: "membership:active",
        })),
      );
    },

    async findMappedSignals(selectors) {
      const signals: OrganizationSignal[] = [];
      for (const selector of selectors) {
        const { data, error } = await supabase
          .from("organization_resolution_keys")
          .select("organization_id")
          .eq("key_type", selector.keyType)
          .eq("key_hash", selector.keyHash)
          .eq("status", "active")
          .limit(2);
        if (error) return { ok: false, reason: "lookup_unavailable" };
        if ((data ?? []).length > 1) return { ok: false, reason: "ambiguous" };
        const organizationId = data?.[0]?.organization_id;
        if (typeof organizationId === "string") {
          signals.push({
            organizationId,
            source: selector.source,
            evidence: `mapped:${selector.keyType}`,
          });
        }
      }
      return validSignals(signals);
    },

    async findOrganizationStatuses(organizationIds) {
      if (!organizationIds.length) return { ok: true, statuses: {} };
      if (organizationIds.some((id) => !UUID_PATTERN.test(id))) {
        return { ok: false, reason: "lookup_unavailable" };
      }
      const { data, error } = await supabase.from("organizations")
        .select("id,status")
        .in("id", organizationIds);
      if (error) return { ok: false, reason: "lookup_unavailable" };
      return {
        ok: true,
        statuses: Object.fromEntries(
          (data ?? []).map((row: { id: string; status: string }) => [
            row.id.toLowerCase(),
            row.status,
          ]),
        ),
      };
    },
  };
}

function validSignals(signals: OrganizationSignal[]): OrganizationLookupResult {
  return signals.every(validOrganizationSignal)
    ? { ok: true, signals }
    : { ok: false, reason: "ambiguous" };
}

export function isProviderResolutionKey(
  value: string,
): value is OrganizationResolutionKeyType {
  return [
    "jobber_account",
    "callrail_number",
    "vapi_assistant",
    "vapi_phone_number",
  ].includes(value);
}
