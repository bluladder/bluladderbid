// ============================================================================
// serviceArea.ts — deterministic, geocode-based service-area validation shared
// by every channel (website chat today, voice later). It NEVER trusts typed
// city text: the address is geocoded with the server-side Google key and the
// resolved city / county / state are matched against the admin-editable
// service_area_config record. It never rejects or books — out-of-area simply
// becomes manual_review_required so the team can follow up.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordSystemIssue, resolveSystemIssue } from "./systemHealth.ts";

// Canonical connector-gateway route for Google Maps. The gateway injects the
// real Google API key server-side; we only ever hold the gateway *connection*
// key (GOOGLE_MAPS_API_KEY) plus the project LOVABLE_API_KEY. The raw Google
// key never exists in this codebase, is never logged, and is never returned to
// the browser. We never call maps.googleapis.com directly, and we NEVER use the
// browser key for server-side geocoding.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";
const GEOCODE_HEALTH_KEY = "geocoding_api";

export type ServiceAreaStatus =
  | "eligible"
  | "manual_review_required"
  | "address_incomplete"
  | "validation_unavailable";

export interface ServiceAreaResult {
  status: ServiceAreaStatus;
  city?: string;
  county?: string;
  state?: string;
  formattedAddress?: string;
  reason?: string;
  customerMessage: string;
}

interface AreaConfig {
  allowedCities: string[];
  manualReviewCounties: string[];
  stateCode: string;
  outOfAreaMessage: string;
}

function norm(s: string): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadConfig(supabase: SupabaseClient): Promise<AreaConfig | null> {
  const { data } = await supabase
    .from("service_area_config")
    .select("allowed_cities, manual_review_counties, state_code, out_of_area_message, is_configured")
    .eq("singleton", true)
    .maybeSingle();
  if (!data || !data.is_configured) return null;
  return {
    allowedCities: (Array.isArray(data.allowed_cities) ? data.allowed_cities : []).map((c: string) => norm(c)),
    manualReviewCounties: (Array.isArray(data.manual_review_counties) ? data.manual_review_counties : []).map((c: string) => norm(c)),
    stateCode: norm(data.state_code || "TX"),
    outOfAreaMessage: data.out_of_area_message || "I can pass your details to the team to confirm eligibility.",
  };
}

interface Geo {
  city?: string;
  county?: string;
  state?: string;
  formatted?: string;
  lat?: number;
  lng?: number;
  partial: boolean;
}

// Returns null when Google cannot find the address (customer typo → ask again),
// "unavailable" on a hard API/gateway failure (validation_unavailable), or a
// Geo on success. Server-side geocoding ALWAYS goes through the connector
// gateway — never a direct Google call, never the browser key.
async function geocode(address: string): Promise<Geo | null | "unavailable"> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connectionKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!lovableKey || !connectionKey) {
    console.error("[serviceArea] geocode misconfigured: missing gateway credentials");
    return "unavailable";
  }

  let resp: Response;
  try {
    // Address is URL-encoded; the customer can never inject an arbitrary URL —
    // the host, path and gateway route are fixed constants here.
    resp = await fetch(
      `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=us`,
      {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": connectionKey,
        },
      },
    );
  } catch {
    return "unavailable";
  }
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    // Never logs the key — only the sanitized gateway status/body preview.
    console.error("[serviceArea] geocode gateway error", resp.status, errBody.slice(0, 160));
    return "unavailable";
  }
  const data = await resp.json().catch(() => null);
  if (!data) return "unavailable";
  if (data.status === "ZERO_RESULTS" || data.status === "INVALID_REQUEST") return null;
  if (data.status === "REQUEST_DENIED") {
    console.error("[serviceArea] geocode REQUEST_DENIED", data.error_message || "");
    return "unavailable";
  }
  if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
    console.error("[serviceArea] geocode api status", data.status, data.error_message || "");
    return "unavailable";
  }
  const r = data.results[0];
  const comps: any[] = r.address_components || [];
  const get = (type: string) =>
    comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
  const city =
    get("locality")?.long_name ||
    get("postal_town")?.long_name ||
    get("sublocality")?.long_name ||
    get("administrative_area_level_3")?.long_name;
  const county = get("administrative_area_level_2")?.long_name?.replace(/ county$/i, "");
  const state = get("administrative_area_level_1")?.short_name;
  const hasStreet = !!get("street_number") || !!get("route") || r.geometry?.location_type === "ROOFTOP";
  return {
    city,
    county,
    state,
    formatted: r.formatted_address,
    lat: r.geometry?.location?.lat,
    lng: r.geometry?.location?.lng,
    partial: !!r.partial_match || !hasStreet,
  };
}

export async function validateServiceArea(
  supabase: SupabaseClient,
  rawAddress: string,
): Promise<ServiceAreaResult> {
  const address = (rawAddress || "").trim();
  if (address.length < 5 || !/\d/.test(address)) {
    return {
      status: "address_incomplete",
      customerMessage: "Could you share the full street address, including city and ZIP, so I can check availability?",
    };
  }

  const config = await loadConfig(supabase);
  if (!config) {
    return {
      status: "validation_unavailable",
      customerMessage: "I can't verify the service area right now — I can take your address and have the team confirm and follow up.",
    };
  }

  const geo = await geocode(address);
  if (geo === "unavailable") {
    return {
      status: "validation_unavailable",
      customerMessage: "I can't verify the address right now — I can take your details and have the team confirm eligibility.",
    };
  }
  if (geo === null) {
    return {
      status: "address_incomplete",
      customerMessage: "I couldn't find that address — could you double-check the street, city and ZIP?",
    };
  }

  const city = norm(geo.city || "");
  const county = norm(geo.county || "");
  const state = norm(geo.state || "");

  if (!city || !state) {
    return {
      status: "address_incomplete",
      city: geo.city,
      county: geo.county,
      state: geo.state,
      formattedAddress: geo.formatted,
      customerMessage: "I need a bit more of the address (city and ZIP) to check availability.",
    };
  }

  const inState = state === config.stateCode;
  const cityEligible = inState && config.allowedCities.includes(city);
  const countyManual = inState && config.manualReviewCounties.includes(county);

  if (cityEligible) {
    return {
      status: "eligible",
      city: geo.city,
      county: geo.county,
      state: geo.state,
      formattedAddress: geo.formatted,
      customerMessage: `Great news — ${geo.city} is in our service area.`,
    };
  }

  // Everything else is manual review. We NEVER auto-reject or auto-book.
  const reason = countyManual
    ? `Within ${geo.county} County but outside the named primary cities`
    : "Outside the automatically eligible primary service area";
  return {
    status: "manual_review_required",
    city: geo.city,
    county: geo.county,
    state: geo.state,
    formattedAddress: geo.formatted,
    reason,
    customerMessage: config.outOfAreaMessage,
  };
}
