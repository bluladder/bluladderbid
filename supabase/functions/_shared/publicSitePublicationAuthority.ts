import { CANONICAL_PRODUCTION_APP_URL } from "./appUrl.ts";
import { DFW_ORGANIZATION_ID } from "./organizationRouting.ts";
import {
  type PublishedPublicContact,
  resolvePublishedPublicContacts,
} from "./publicContactPublicationAuthority.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type PublicSiteAccessMode = "customer" | "compliance_only";

export type PublicSitePublicationAuthority =
  | {
    status: "resolved";
    organizationId: string;
    tenantKey: string;
    hostname: string;
    publicName: string;
    tagline: string;
    accessMode: PublicSiteAccessMode;
    publicContactReady: boolean;
    publicContacts: PublishedPublicContact[];
    source: "exact_dfw_compatibility" | "published_customer_site";
  }
  | {
    status: "blocked";
    code:
      | "missing_origin"
      | "invalid_origin"
      | "site_unavailable"
      | "ambiguous_site"
      | "organization_inactive"
      | "settings_unavailable";
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DFW_HOSTNAME = new URL(CANONICAL_PRODUCTION_APP_URL).hostname;

function normalizeOrigin(rawOrigin: string | null):
  | { ok: true; hostname: string }
  | { ok: false; code: "missing_origin" | "invalid_origin" } {
  if (!rawOrigin) return { ok: false, code: "missing_origin" };
  try {
    const url = new URL(rawOrigin);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash ||
      !HOSTNAME_PATTERN.test(hostname) ||
      /lovable\.(?:app|dev)$/i.test(hostname)
    ) {
      return { ok: false, code: "invalid_origin" };
    }
    return { ok: true, hostname };
  } catch {
    return { ok: false, code: "invalid_origin" };
  }
}

function publicText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized || normalized.length > maxLength ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  return normalized;
}

function taglineFromBranding(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return publicText((value as Record<string, unknown>).tagline, 120);
}

/**
 * Resolve the public presentation boundary for one exact HTTPS Origin.
 *
 * Unlike portalOrganizationAuthority, this resolver may return
 * `compliance_only` when a site is deliberately published while customer
 * traffic remains disabled. That mode is presentation-only: it does not grant
 * portal, quote, booking, chat, messaging, or contact-write authority.
 */
export async function resolvePublicSitePublicationAuthority(
  supabase: SB,
  req: Request,
): Promise<PublicSitePublicationAuthority> {
  const origin = normalizeOrigin(req.headers.get("origin"));
  if (!origin.ok) return { status: "blocked", code: origin.code };

  if (origin.hostname === DFW_HOSTNAME) {
    return {
      status: "resolved",
      organizationId: DFW_ORGANIZATION_ID,
      tenantKey: "bluladder-dfw",
      hostname: DFW_HOSTNAME,
      publicName: "BluLadder",
      tagline: "Next Level Clean",
      accessMode: "customer",
      publicContactReady: false,
      publicContacts: [],
      source: "exact_dfw_compatibility",
    };
  }

  if (!supabase || typeof supabase.from !== "function") {
    return { status: "blocked", code: "site_unavailable" };
  }

  try {
    const { data: siteRows, error: siteError } = await supabase
      .from("organization_customer_sites")
      .select(
        "organization_id,tenant_key,canonical_hostname,mapping_status,runtime_routing_enabled,site_published,customer_traffic_allowed",
      )
      .eq("canonical_hostname", origin.hostname)
      .limit(2);
    if (siteError) return { status: "blocked", code: "site_unavailable" };
    const sites = Array.isArray(siteRows) ? siteRows : [];
    if (sites.length > 1) return { status: "blocked", code: "ambiguous_site" };
    if (sites.length !== 1) {
      return { status: "blocked", code: "site_unavailable" };
    }

    const site = sites[0] as Record<string, unknown>;
    const organizationId = typeof site.organization_id === "string"
      ? site.organization_id.toLowerCase()
      : "";
    const tenantKey = publicText(site.tenant_key, 100);
    if (
      !UUID_PATTERN.test(organizationId) || !tenantKey ||
      site.canonical_hostname !== origin.hostname ||
      site.mapping_status !== "active" ||
      site.runtime_routing_enabled !== true ||
      site.site_published !== true ||
      typeof site.customer_traffic_allowed !== "boolean"
    ) {
      return { status: "blocked", code: "site_unavailable" };
    }

    const [organizationResult, settingsResult] = await Promise.all([
      supabase.from("organizations")
        .select("id,status")
        .eq("id", organizationId)
        .limit(2),
      supabase.from("organization_settings")
        .select("organization_id,public_name,branding")
        .eq("organization_id", organizationId)
        .limit(2),
    ]);
    if (organizationResult.error) {
      return { status: "blocked", code: "organization_inactive" };
    }
    if (settingsResult.error) {
      return { status: "blocked", code: "settings_unavailable" };
    }
    const organizations = Array.isArray(organizationResult.data)
      ? organizationResult.data
      : [];
    const settings = Array.isArray(settingsResult.data)
      ? settingsResult.data
      : [];
    if (organizations.length > 1 || settings.length > 1) {
      return { status: "blocked", code: "ambiguous_site" };
    }
    if (
      organizations.length !== 1 || organizations[0]?.id !== organizationId ||
      organizations[0]?.status !== "active"
    ) {
      return { status: "blocked", code: "organization_inactive" };
    }
    if (
      settings.length !== 1 || settings[0]?.organization_id !== organizationId
    ) {
      return { status: "blocked", code: "settings_unavailable" };
    }
    const publicName = publicText(settings[0]?.public_name, 120);
    const tagline = taglineFromBranding(settings[0]?.branding);
    if (!publicName || !tagline) {
      return { status: "blocked", code: "settings_unavailable" };
    }

    const contactAuthority = await resolvePublishedPublicContacts(
      supabase,
      organizationId,
    );

    return {
      status: "resolved",
      organizationId,
      tenantKey,
      hostname: origin.hostname,
      publicName,
      tagline,
      accessMode: site.customer_traffic_allowed
        ? "customer"
        : "compliance_only",
      publicContactReady: contactAuthority.status === "resolved",
      publicContacts: contactAuthority.status === "resolved"
        ? contactAuthority.contacts
        : [],
      source: "published_customer_site",
    };
  } catch {
    return { status: "blocked", code: "site_unavailable" };
  }
}
