import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ActionRequest {
  action: 'reschedule' | 'modify_services' | 'cancel';
  bookingId: string;
  // For reschedule
  newSlot?: {
    startTime: string;
    endTime: string;
    technicianId: string;
    technicianIds?: string[]; // For team bookings
  };
  // For modify services
  newServices?: Array<{ name: string; price: number }>;
  newSubtotal?: number;
  newTotal?: number;
  newDurationMinutes?: number;
  // Admin override
  isAdminOverride?: boolean;
  adminUserId?: string;
}

interface BookingRecord {
  id: string;
  reference_number: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  duration_minutes: number;
  total: number;
  subtotal: number;
  discount_amount: number | null;
  services_json: Array<{ name: string; price: number }>;
  home_details_json: Record<string, unknown>;
  technician_id: string | null;
  jobber_visit_id: string | null;
  jobber_job_id: string | null;
  customer_id: string;
}

const LOCKOUT_HOURS = 48;

// Validate 48-hour lockout rule
function isWithinLockout(scheduledStart: string | null): boolean {
  if (!scheduledStart) return true;
  const startDate = new Date(scheduledStart);
  const now = new Date();
  const hoursUntil = (startDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  return hoursUntil < LOCKOUT_HOURS;
}

// GraphQL mutation to update a visit in Jobber
const UPDATE_VISIT_MUTATION = `
  mutation UpdateVisit($visitId: EncodedId!, $input: VisitUpdateInput!) {
    visitUpdate(visitId: $visitId, input: $input) {
      visit {
        id
        startAt
        endAt
      }
      userErrors {
        message
        path
      }
    }
  }
`;

// GraphQL mutation to cancel/delete a visit in Jobber
const DELETE_VISIT_MUTATION = `
  mutation DeleteVisit($visitId: EncodedId!) {
    visitDelete(visitId: $visitId) {
      deletedVisitId
      userErrors {
        message
        path
      }
    }
  }
`;

// Convert ISO timestamp to Jobber's LocalDateTime format
function parseToLocalDateTime(isoString: string): {
  date: string;
  time: string;
  timeZone: string;
} {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
    timeZone: "America/Chicago",
  };
}

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase: AnySupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const body: ActionRequest = await req.json();
    const { action, bookingId, isAdminOverride, adminUserId } = body;

    console.log(`[CustomerAction] Action: ${action}, BookingId: ${bookingId}, AdminOverride: ${isAdminOverride || false}`);

    // Fetch the booking
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        reference_number,
        status,
        scheduled_start,
        scheduled_end,
        duration_minutes,
        total,
        subtotal,
        discount_amount,
        services_json,
        home_details_json,
        technician_id,
        jobber_visit_id,
        jobber_job_id,
        customer_id
      `)
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(
        JSON.stringify({ error: "Booking not found", details: bookingError?.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    const typedBooking = booking as BookingRecord;

    // Check 48-hour lockout (unless admin override)
    if (!isAdminOverride && isWithinLockout(typedBooking.scheduled_start)) {
      return new Response(
        JSON.stringify({ 
          error: "Lockout period",
          code: "LOCKOUT",
          details: `Appointments cannot be modified within ${LOCKOUT_HOURS} hours. Please contact us for urgent changes.`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    // Log admin override actions
    if (isAdminOverride && adminUserId) {
      console.log(`[AdminOverride] Admin ${adminUserId} is overriding lockout for booking ${bookingId}`);
    }

    let result: Record<string, unknown> = {};

    switch (action) {
      case 'reschedule':
        result = await handleReschedule(supabase, typedBooking, body);
        break;
      case 'modify_services':
        result = await handleModifyServices(supabase, typedBooking, body);
        break;
      case 'cancel':
        result = await handleCancel(supabase, typedBooking, body);
        break;
      default:
        return new Response(
          JSON.stringify({ error: "Invalid action", details: `Unknown action: ${action}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
    }

    // Add audit log entry (best effort - don't fail if table doesn't exist)
    try {
      await supabase
        .from("booking_audit_log")
        .insert({
          booking_id: bookingId,
          action,
          old_values: {
            scheduled_start: typedBooking.scheduled_start,
            scheduled_end: typedBooking.scheduled_end,
            status: typedBooking.status,
            services_json: typedBooking.services_json,
            total: typedBooking.total,
          },
          new_values: result,
          changed_by: isAdminOverride ? 'admin' : 'customer',
          changed_by_id: adminUserId || null,
          is_admin_override: isAdminOverride || false,
        });
    } catch (auditErr) {
      console.warn("Failed to log audit entry (table may not exist):", auditErr);
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[CustomerAction] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// === RESCHEDULE HANDLER ===
async function handleReschedule(
  supabase: AnySupabaseClient,
  booking: BookingRecord,
  body: ActionRequest
): Promise<Record<string, unknown>> {
  const { newSlot } = body;

  if (!newSlot) {
    throw new Error("newSlot is required for reschedule action");
  }

  console.log(`[Reschedule] Moving booking ${booking.reference_number} from ${booking.scheduled_start} to ${newSlot.startTime}`);

  // Get technician Jobber user IDs
  const techIds = newSlot.technicianIds || [newSlot.technicianId];
  const { data: technicians, error: techError } = await supabase
    .from("technicians")
    .select("id, jobber_user_id, name")
    .in("id", techIds);

  if (techError || !technicians?.length) {
    throw new Error(`Technician lookup failed: ${techError?.message}`);
  }

  const techList = technicians as Array<{ id: string; jobber_user_id: string; name: string }>;
  const jobberUserIds = techList.map(t => t.jobber_user_id);
  const technicianNames = techList.map(t => t.name).join(" + ");

  // Update in Jobber if we have a visit ID
  let jobberSynced = false;
  if (booking.jobber_visit_id) {
    console.log(`[Reschedule] Updating Jobber visit: ${booking.jobber_visit_id}`);
    
    const visitInput = {
      schedule: {
        startAt: parseToLocalDateTime(newSlot.startTime),
        endAt: parseToLocalDateTime(newSlot.endTime),
        teamMemberIdsToAssign: jobberUserIds,
      },
    };

    const jobberResult = await jobberGraphQL<{
      visitUpdate: {
        visit: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(UPDATE_VISIT_MUTATION, {
      visitId: booking.jobber_visit_id,
      input: visitInput,
    });

    if (jobberResult.throttled) {
      throw new Error("Scheduling system is busy. Please try again in a few minutes.");
    }

    if (jobberResult.errors?.length || jobberResult.data?.visitUpdate?.userErrors?.length) {
      const errorMsg = jobberResult.errors?.[0]?.message || 
                       jobberResult.data?.visitUpdate?.userErrors?.[0]?.message ||
                       "Unknown Jobber error";
      console.error("[Reschedule] Jobber update failed:", errorMsg);
      throw new Error(`Failed to sync with scheduling system: ${errorMsg}`);
    }

    jobberSynced = true;
    console.log(`[Reschedule] Jobber visit updated successfully`);
  }

  // Update local database
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      scheduled_start: newSlot.startTime,
      scheduled_end: newSlot.endTime,
      technician_id: newSlot.technicianId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }

  // Update local busy blocks if they exist
  if (booking.jobber_visit_id) {
    await supabase
      .from("jobber_busy_blocks")
      .update({
        start_at: newSlot.startTime,
        end_at: newSlot.endTime,
        crew_id: jobberUserIds[0],
        updated_at: new Date().toISOString(),
      })
      .eq("jobber_visit_id", booking.jobber_visit_id);
  }

  return {
    action: 'reschedule',
    previousStart: booking.scheduled_start,
    previousEnd: booking.scheduled_end,
    newStart: newSlot.startTime,
    newEnd: newSlot.endTime,
    technicianName: technicianNames,
    jobberSynced,
  };
}

// === MODIFY SERVICES HANDLER ===
async function handleModifyServices(
  supabase: AnySupabaseClient,
  booking: BookingRecord,
  body: ActionRequest
): Promise<Record<string, unknown>> {
  const { newServices, newSubtotal, newTotal, newDurationMinutes } = body;

  if (!newServices || newSubtotal === undefined || newTotal === undefined) {
    throw new Error("newServices, newSubtotal, and newTotal are required for modify_services action");
  }

  console.log(`[ModifyServices] Updating services for ${booking.reference_number}`);

  const oldServices = booking.services_json;
  const oldTotal = booking.total;
  const oldDuration = booking.duration_minutes;
  const effectiveDuration = newDurationMinutes || oldDuration;

  // Check if new duration fits in current slot
  if (booking.scheduled_start && booking.scheduled_end && newDurationMinutes) {
    const slotStart = new Date(booking.scheduled_start);
    const slotEnd = new Date(booking.scheduled_end);
    const slotDurationMinutes = (slotEnd.getTime() - slotStart.getTime()) / (1000 * 60);

    if (newDurationMinutes > slotDurationMinutes) {
      return {
        action: 'modify_services',
        requiresReschedule: true,
        reason: `New services require ${Math.ceil(newDurationMinutes / 60 * 10) / 10} hours but current slot is only ${Math.ceil(slotDurationMinutes / 60 * 10) / 10} hours`,
        newServices,
        newTotal,
        newDurationMinutes,
      };
    }
  }

  // Update local database
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      services_json: newServices,
      subtotal: newSubtotal,
      total: newTotal,
      duration_minutes: effectiveDuration,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }

  return {
    action: 'modify_services',
    requiresReschedule: false,
    oldServices,
    newServices,
    oldTotal,
    newTotal,
    oldDuration,
    newDuration: effectiveDuration,
  };
}

// === CANCEL HANDLER ===
async function handleCancel(
  supabase: AnySupabaseClient,
  booking: BookingRecord,
  _body: ActionRequest
): Promise<Record<string, unknown>> {
  console.log(`[Cancel] Cancelling booking ${booking.reference_number}`);

  // Cancel in Jobber if we have a visit ID
  let jobberSynced = false;
  if (booking.jobber_visit_id) {
    console.log(`[Cancel] Deleting Jobber visit: ${booking.jobber_visit_id}`);

    const jobberResult = await jobberGraphQL<{
      visitDelete: {
        deletedVisitId: string | null;
        userErrors: Array<{ message: string }>;
      };
    }>(DELETE_VISIT_MUTATION, {
      visitId: booking.jobber_visit_id,
    });

    if (jobberResult.throttled) {
      console.warn("[Cancel] Jobber throttled - will proceed with local cancel only");
    } else if (jobberResult.errors?.length || jobberResult.data?.visitDelete?.userErrors?.length) {
      const errorMsg = jobberResult.errors?.[0]?.message || 
                       jobberResult.data?.visitDelete?.userErrors?.[0]?.message ||
                       "Unknown Jobber error";
      console.warn("[Cancel] Jobber delete failed (proceeding anyway):", errorMsg);
    } else {
      jobberSynced = true;
      console.log(`[Cancel] Jobber visit deleted successfully`);
    }
  }

  // Update local booking status
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }

  // Remove from local busy blocks
  if (booking.jobber_visit_id) {
    await supabase
      .from("jobber_busy_blocks")
      .delete()
      .eq("jobber_visit_id", booking.jobber_visit_id);
  }

  return {
    action: 'cancel',
    cancelledAt: new Date().toISOString(),
    previousStart: booking.scheduled_start,
    jobberSynced,
  };
}
