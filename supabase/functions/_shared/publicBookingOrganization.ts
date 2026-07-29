import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "./publicBookingServiceArea.ts";

export type PublicBookingOrganizationResolution =
  | {
    status: "resolved";
    organizationId: typeof PUBLIC_BOOKING_ORGANIZATION_ID;
    tenantFoundationAvailable: boolean;
  }
  | {
    status: "unavailable";
    code:
      | "ORGANIZATION_LOOKUP_UNAVAILABLE"
      | "ORGANIZATION_INACTIVE";
  };

export function isTenantFoundationAbsent(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*organizations.* does not exist/i.test(error.message ?? "") ||
    /could not find the table .*organizations/i.test(error.message ?? "");
}

export async function resolvePublicBookingOrganization(
  supabase: SupabaseClient,
): Promise<PublicBookingOrganizationResolution> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, status")
    .eq("id", PUBLIC_BOOKING_ORGANIZATION_ID)
    .maybeSingle();

  // Stage 7B is a separately protected hosted migration. Before it exists,
  // preserve the single-DFW schema while the canonical geocoded DFW gate
  // remains mandatory. Once the table exists, missing/inactive/failed
  // organization resolution is terminal and can never fall back.
  if (isTenantFoundationAbsent(error)) {
    return {
      status: "resolved",
      organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
      tenantFoundationAvailable: false,
    };
  }
  if (error) {
    return { status: "unavailable", code: "ORGANIZATION_LOOKUP_UNAVAILABLE" };
  }
  if (
    data?.id !== PUBLIC_BOOKING_ORGANIZATION_ID ||
    data?.status !== "active"
  ) {
    return { status: "unavailable", code: "ORGANIZATION_INACTIVE" };
  }
  return {
    status: "resolved",
    organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
    tenantFoundationAvailable: true,
  };
}
