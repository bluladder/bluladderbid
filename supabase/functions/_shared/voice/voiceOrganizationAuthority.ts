import {
  type OrganizationAuthorityResolution,
  type OrganizationMappedSelector,
  resolveServerOrganizationAuthority,
} from "../organizationAuthority.ts";
import { createSupabaseOrganizationAuthorityRepository } from "../supabaseOrganizationAuthority.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

function stringValues(...candidates: unknown[]): string[] {
  const values = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      values.add(candidate.trim());
    }
  }
  return [...values];
}

/** Extract only provider resource IDs that have an approved hashed mapping. */
export function extractVoiceOrganizationSelectors(
  // deno-lint-ignore no-explicit-any
  rawBody: any,
): OrganizationMappedSelector[] {
  const assistantIds = stringValues(
    rawBody?.assistant?.id,
    rawBody?.assistantId,
    rawBody?.call?.assistantId,
    rawBody?.message?.assistant?.id,
    rawBody?.message?.assistantId,
    rawBody?.message?.call?.assistantId,
  );
  const phoneNumberIds = stringValues(
    rawBody?.phoneNumber?.id,
    rawBody?.phoneNumberId,
    rawBody?.call?.phoneNumber?.id,
    rawBody?.call?.phoneNumberId,
    rawBody?.message?.phoneNumber?.id,
    rawBody?.message?.phoneNumberId,
    rawBody?.message?.call?.phoneNumber?.id,
    rawBody?.message?.call?.phoneNumberId,
  );
  const selectors: OrganizationMappedSelector[] = [];
  for (const assistantId of assistantIds) {
    selectors.push({
      source: "provider",
      keyType: "vapi_assistant",
      value: assistantId,
    });
  }
  for (const phoneNumberId of phoneNumberIds) {
    selectors.push({
      source: "provider",
      keyType: "vapi_phone_number",
      value: phoneNumberId,
    });
  }
  return selectors;
}

/**
 * Resolve the provider mapping before any tenant-owned conversation is read
 * or created. At least one approved Vapi resource is mandatory, and the
 * canonical resolver requires every presented resource to map and agree.
 */
export async function resolveVoiceProviderOrganizationAuthority(
  supabase: SB,
  rawBody: unknown,
): Promise<OrganizationAuthorityResolution> {
  const mapped = extractVoiceOrganizationSelectors(rawBody);
  if (!mapped.length) {
    return { status: "blocked", code: "missing_authority" };
  }
  return await resolveServerOrganizationAuthority(
    createSupabaseOrganizationAuthorityRepository(supabase),
    { mapped },
  );
}

export async function resolveVoiceOrganizationAuthority(
  supabase: SB,
  args: {
    conversationId: string;
    rawBody: unknown;
  },
): Promise<OrganizationAuthorityResolution> {
  const mapped = extractVoiceOrganizationSelectors(args.rawBody);
  if (!mapped.length) {
    return { status: "blocked", code: "missing_authority" };
  }
  return await resolveServerOrganizationAuthority(
    createSupabaseOrganizationAuthorityRepository(supabase),
    {
      resources: [{ kind: "conversation", id: args.conversationId }],
      mapped,
    },
  );
}
