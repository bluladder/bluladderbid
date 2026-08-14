// Organization-scoped consent is the only authoritative consent boundary for
// tenant-capable runtime paths. Callers must supply a server-derived,
// persisted organization UUID; missing or malformed authority fails closed.

type SupabaseRpcResult = PromiseLike<{
  data: unknown;
  error: { code?: string } | null;
}>;

type SupabaseLike = {
  rpc: (name: string, args: Record<string, unknown>) => SupabaseRpcResult;
};

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeConsentOrganizationId(
  value: unknown,
): string | null {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
  return ORGANIZATION_ID_PATTERN.test(normalized) ? normalized : null;
}

export interface OrganizationConsentIdentity {
  channel: "sms" | "email";
  email?: string | null;
  phone?: string | null;
}

export interface RecordOrganizationConsentInput
  extends OrganizationConsentIdentity {
  consentType: "transactional" | "requested_follow_up" | "marketing";
  status: "granted" | "revoked";
  languageShown?: string | null;
  source: string;
  customerId?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  bookingId?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordOrganizationConsent(
  supabase: SupabaseLike,
  organizationId: unknown,
  input: RecordOrganizationConsentInput,
): Promise<string> {
  const normalizedOrganizationId = normalizeConsentOrganizationId(
    organizationId,
  );
  if (!normalizedOrganizationId) {
    throw new Error("consent_organization_authority_required");
  }

  const { data, error } = await supabase.rpc("record_organization_consent", {
    p_organization_id: normalizedOrganizationId,
    p_channel: input.channel,
    p_consent_type: input.consentType,
    p_status: input.status,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
    p_language_shown: input.languageShown ?? null,
    p_source: input.source,
    p_customer_id: input.customerId ?? null,
    p_conversation_id: input.conversationId ?? null,
    p_session_id: input.sessionId ?? null,
    p_booking_id: input.bookingId ?? null,
    p_actor_id: input.actorId ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (error || typeof data !== "string" || !data) {
    throw new Error("organization_consent_write_failed");
  }
  return data;
}

export async function organizationConsentAllows(
  supabase: SupabaseLike,
  organizationId: unknown,
  input: OrganizationConsentIdentity & {
    required: "transactional" | "requested_follow_up" | "marketing";
  },
): Promise<boolean> {
  const normalizedOrganizationId = normalizeConsentOrganizationId(
    organizationId,
  );
  if (!normalizedOrganizationId) return false;

  try {
    const { data, error } = await supabase.rpc(
      "consent_allows_for_organization",
      {
        p_organization_id: normalizedOrganizationId,
        p_channel: input.channel,
        p_required: input.required,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
      },
    );
    return !error && data === true;
  } catch {
    return false;
  }
}
