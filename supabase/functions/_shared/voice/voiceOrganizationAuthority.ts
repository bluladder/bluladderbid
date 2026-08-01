import {
  type OrganizationAuthorityResolution,
  type OrganizationMappedSelector,
  resolveServerOrganizationAuthority,
} from "../organizationAuthority.ts";
import { createSupabaseOrganizationAuthorityRepository } from "../supabaseOrganizationAuthority.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

function stringValue(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

/** Extract only provider resource IDs that have an approved hashed mapping. */
export function extractVoiceOrganizationSelectors(
  // deno-lint-ignore no-explicit-any
  rawBody: any,
): OrganizationMappedSelector[] {
  const assistantId = stringValue(
    rawBody?.assistant?.id,
    rawBody?.assistantId,
    rawBody?.call?.assistantId,
  );
  const phoneNumberId = stringValue(
    rawBody?.phoneNumber?.id,
    rawBody?.phoneNumberId,
    rawBody?.call?.phoneNumber?.id,
    rawBody?.call?.phoneNumberId,
  );
  const selectors: OrganizationMappedSelector[] = [];
  if (assistantId) {
    selectors.push({
      source: "provider",
      keyType: "vapi_assistant",
      value: assistantId,
    });
  }
  if (phoneNumberId) {
    selectors.push({
      source: "provider",
      keyType: "vapi_phone_number",
      value: phoneNumberId,
    });
  }
  return selectors;
}

export async function resolveVoiceOrganizationAuthority(
  supabase: SB,
  args: {
    conversationId: string;
    rawBody: unknown;
  },
): Promise<OrganizationAuthorityResolution> {
  return await resolveServerOrganizationAuthority(
    createSupabaseOrganizationAuthorityRepository(supabase),
    {
      resources: [{ kind: "conversation", id: args.conversationId }],
      mapped: extractVoiceOrganizationSelectors(args.rawBody),
    },
  );
}
