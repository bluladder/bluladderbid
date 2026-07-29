import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ServiceAreaInterventionInput {
  requestFingerprint: string;
  source: "public_one_time_booking" | "public_recurring_plan";
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  propertyAddress: string;
  services: unknown;
  total: number | null;
  reasonCode: string;
}

export type ServiceAreaInterventionResult =
  | { status: "recorded"; interventionId: string; deduplicated: boolean }
  | { status: "failed" };

export async function recordServiceAreaIntervention(
  supabase: SupabaseClient,
  input: ServiceAreaInterventionInput,
): Promise<ServiceAreaInterventionResult> {
  const requestKey = `service_area_review:${input.requestFingerprint}`;
  const row = {
    request_key: requestKey,
    source: input.source,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone,
    property_address: input.propertyAddress,
    services: input.services,
    total: input.total,
    appointment_status: "service_area_manual_review",
    note: `Structured reason: ${input.reasonCode}`,
    owner_notification_status: "pending",
  };
  const { data, error } = await supabase
    .from("contact_requests")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (!error && data?.id) {
    return {
      status: "recorded",
      interventionId: String(data.id),
      deduplicated: false,
    };
  }
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabase
      .from("contact_requests")
      .select("id")
      .eq("request_key", requestKey)
      .maybeSingle();
    if (!existingError && existing?.id) {
      return {
        status: "recorded",
        interventionId: String(existing.id),
        deduplicated: true,
      };
    }
  }
  return { status: "failed" };
}
