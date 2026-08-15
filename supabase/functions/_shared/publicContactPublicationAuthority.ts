// deno-lint-ignore no-explicit-any
type SB = any;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PublishedPublicContact {
  channel: "phone" | "sms" | "email";
  label: string;
  value: string;
}

export type PublicContactPublicationAuthority =
  | { status: "resolved"; contacts: PublishedPublicContact[] }
  | {
    status: "blocked";
    code:
      | "invalid_organization"
      | "contact_unavailable"
      | "contact_missing"
      | "contact_ambiguous"
      | "contact_invalid";
  };

function publicLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (
    value !== label || !label || label.length > 80 ||
    [...label].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) return null;
  return label;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRow(
  row: Record<string, unknown>,
  organizationId: string,
): PublishedPublicContact | null {
  const label = publicLabel(row.label);
  const ownerApprovedAt = timestamp(row.owner_approved_at);
  const verifiedAt = timestamp(row.verified_at);
  const publishedAt = timestamp(row.published_at);
  if (
    row.organization_id !== organizationId || row.status !== "published" ||
    !label || ownerApprovedAt === null || verifiedAt === null ||
    publishedAt === null || publishedAt < ownerApprovedAt ||
    publishedAt < verifiedAt ||
    typeof row.owner_approval_reference_hash !== "string" ||
    !SHA256_PATTERN.test(row.owner_approval_reference_hash) ||
    !Number.isInteger(row.configuration_version) ||
    Number(row.configuration_version) <= 0 ||
    typeof row.destination !== "string"
  ) return null;

  if (row.channel === "phone" && E164_PATTERN.test(row.destination)) {
    return { channel: "phone", label, value: row.destination };
  }
  if (row.channel === "sms" && E164_PATTERN.test(row.destination)) {
    return { channel: "sms", label, value: row.destination };
  }
  if (
    row.channel === "email" &&
    row.destination === row.destination.toLowerCase() &&
    row.destination.length <= 254 && EMAIL_PATTERN.test(row.destination)
  ) {
    return { channel: "email", label, value: row.destination };
  }
  return null;
}

/**
 * Resolve public display contacts only after a caller has already established
 * exact server-side site and organization publication authority. This helper
 * never reads internal organization_contacts rows and never returns database
 * identifiers or approval provenance.
 */
export async function resolvePublishedPublicContacts(
  supabase: SB,
  organizationId: string,
): Promise<PublicContactPublicationAuthority> {
  const normalizedOrganizationId = organizationId.toLowerCase();
  if (!UUID_PATTERN.test(normalizedOrganizationId)) {
    return { status: "blocked", code: "invalid_organization" };
  }
  if (!supabase || typeof supabase.from !== "function") {
    return { status: "blocked", code: "contact_unavailable" };
  }

  try {
    const { data, error } = await supabase
      .from("organization_public_contacts")
      .select(
        "organization_id,channel,label,destination,status,owner_approved_at,owner_approval_reference_hash,verified_at,published_at,configuration_version",
      )
      .eq("organization_id", normalizedOrganizationId)
      .eq("status", "published")
      .limit(4);
    if (error) return { status: "blocked", code: "contact_unavailable" };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return { status: "blocked", code: "contact_missing" };
    }
    if (rows.length > 3) {
      return { status: "blocked", code: "contact_ambiguous" };
    }

    const contacts = rows.map((row) =>
      normalizeRow(row as Record<string, unknown>, normalizedOrganizationId)
    );
    if (contacts.some((contact) => contact === null)) {
      return { status: "blocked", code: "contact_invalid" };
    }
    const resolved = contacts as PublishedPublicContact[];
    if (
      new Set(resolved.map((contact) => contact.channel)).size !==
        resolved.length
    ) {
      return { status: "blocked", code: "contact_ambiguous" };
    }
    resolved.sort((left, right) =>
      ["phone", "sms", "email"].indexOf(left.channel) -
      ["phone", "sms", "email"].indexOf(right.channel)
    );
    return { status: "resolved", contacts: resolved };
  } catch {
    return { status: "blocked", code: "contact_unavailable" };
  }
}
