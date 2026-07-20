import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";
import {
  DELETE_VISIT_MUTATION,
  interpretVisitDelete,
  type VisitDeleteResult,
} from "../_shared/jobberCancellation.ts";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  // Optional structured operational metadata for a reschedule.
  rescheduleReason?: string | null;
  rescheduleNotes?: string | null;
  // Optional structured operational metadata for a cancellation.
  cancellationReason?: string | null;
  cancellationNotes?: string | null;
  // For modify services
  newServices?: Array<{ name: string; price: number }>;
  newSubtotal?: number;
  newTotal?: number;
  newDurationMinutes?: number;
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
  booking_version?: number | null;
  quote_id?: string | null;
  customer?: { email: string };
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
// NOTE: The mutation itself lives in ../_shared/jobberCancellation.ts so the
// exact schema (plural `visitIds`, `VisitDeletePayload`) stays in one place and
// is covered by unit tests. The old singular `visitDelete(visitId:)` form with a
// `deletedVisitId` field was removed from Jobber and must never be reintroduced.

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

// Verify admin role server-side
async function verifyAdminRole(supabase: AnySupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "owner_admin", "operations_admin"])
    .maybeSingle();
  
  if (error) {
    console.error("Error checking admin role:", error);
    return false;
  }
  
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Service client for database operations
    const serviceClient: AnySupabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // Parse the request body
    const body: ActionRequest = await req.json();
    const { action, bookingId } = body;

    // Validate required fields
    if (!action || !bookingId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields", details: "action and bookingId are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // =====================================================
    // AUTHENTICATION: Verify the caller's identity
    // =====================================================
    const authHeader = req.headers.get("Authorization");
    let callerEmail: string | null = null;
    let callerUserId: string | null = null;
    let isVerifiedAdmin = false;

    if (authHeader?.startsWith("Bearer ")) {
      // Create a client with the user's auth context
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });

      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);

      if (!claimsError && claimsData?.claims) {
        callerEmail = claimsData.claims.email as string || null;
        callerUserId = claimsData.claims.sub as string || null;

        // Check if user has admin privileges (server-side verification)
        if (callerUserId) {
          isVerifiedAdmin = await verifyAdminRole(serviceClient, callerUserId);
        }
      }
    }

    console.log(`[CustomerAction] Action: ${action}, BookingId: ${bookingId}, CallerEmail: ${callerEmail || 'anonymous'}, IsAdmin: ${isVerifiedAdmin}`);

    // Fetch the booking with customer email
    const { data: booking, error: bookingError } = await serviceClient
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
        customer_id,
        booking_version,
        quote_id,
        customer:customers(email)
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

    const typedBooking = booking as unknown as BookingRecord;
    const bookingCustomerEmail = typedBooking.customer?.email?.toLowerCase();

    // =====================================================
    // AUTHORIZATION: Verify caller has permission
    // =====================================================
    // Either: 1) Verified admin, or 2) Authenticated user whose email matches booking customer
    const callerOwnsBooking = callerEmail && bookingCustomerEmail && 
                              callerEmail.toLowerCase() === bookingCustomerEmail;

    if (!isVerifiedAdmin && !callerOwnsBooking) {
      console.warn(`[CustomerAction] Unauthorized: callerEmail=${callerEmail}, bookingEmail=${bookingCustomerEmail}, isAdmin=${isVerifiedAdmin}`);
      return new Response(
        JSON.stringify({ 
          error: "Unauthorized",
          details: "You must be logged in with the email associated with this booking, or be an admin."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    // Check 48-hour lockout (admins can bypass)
    if (!isVerifiedAdmin && isWithinLockout(typedBooking.scheduled_start)) {
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
    if (isVerifiedAdmin && isWithinLockout(typedBooking.scheduled_start)) {
      console.log(`[AdminOverride] Admin ${callerUserId} is overriding lockout for booking ${bookingId}`);
    }

    let result: Record<string, unknown> = {};

    switch (action) {
      case 'reschedule':
        result = await handleReschedule(serviceClient, typedBooking, body);
        break;
      case 'modify_services':
        result = await handleModifyServices(serviceClient, typedBooking, body);
        break;
      case 'cancel':
        result = await handleCancel(
          serviceClient,
          typedBooking,
          isVerifiedAdmin ? 'admin' : 'customer',
          callerUserId,
          body,
        );
        break;
      default:
        return new Response(
          JSON.stringify({ error: "Invalid action", details: `Unknown action: ${action}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
    }

    // Add audit log entry
    try {
      await serviceClient
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
          changed_by: isVerifiedAdmin ? 'admin' : 'customer',
          changed_by_id: callerUserId || null,
          is_admin_override: isVerifiedAdmin && isWithinLockout(typedBooking.scheduled_start),
        });
    } catch (auditErr) {
      console.warn("Failed to log audit entry:", auditErr);
    }

    // Fire-and-forget transactional SMS + campaign enrollment for relevant actions.
    // For cancellations we ONLY notify when Jobber genuinely confirmed the
    // removal AND it was not an idempotent replay of an already-cancelled
    // booking. A fail-closed "needs_attention" outcome must never send a
    // "your appointment is cancelled" message.
    const cancelFreshlyConfirmed =
      action === 'cancel' && result.status === 'cancelled';
    // A reschedule no-op (customer submitted the same slot) must not emit a
    // confirmation event or send a "your appointment has been rescheduled" SMS.
    const rescheduleFreshlyConfirmed =
      action === 'reschedule' && !result.noop;
    const smsEvent =
      rescheduleFreshlyConfirmed ? 'appointment_rescheduled' :
      cancelFreshlyConfirmed ? 'appointment_cancelled' : null;
    // Canonical campaign event names for Phase 2B/2C. The `appointment_*`
    // legacy names remain ONLY as the send-sms/reminders transactional trigger
    // to preserve delivery until the seeded confirmation campaigns are
    // activated. `booking_cancelled` is the canonical lifecycle event fed to
    // the campaign engine after Jobber confirmed the removal.
    const campaignEvent =
      rescheduleFreshlyConfirmed ? 'booking_rescheduled' :
      cancelFreshlyConfirmed ? 'booking_cancelled' : null;
    if (smsEvent && campaignEvent) {
      try {
        fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ eventType: smsEvent, bookingId }),
        }).catch((e) => console.warn("[CustomerAction] SMS dispatch failed:", e));
      } catch (smsErr) {
        console.warn("[CustomerAction] SMS dispatch error:", smsErr);
      }

      // Campaign lifecycle event — emitted ONLY after Jobber confirmed the
      // change AND local persistence + booking_version bump succeeded (the
      // handler throws on either failure and we never reach this point).
      // `booking_rescheduled` idempotency is keyed on booking_id + new
      // booking_version so retries and webhook replays never duplicate.
      try {
        const visitId = typedBooking.jobber_visit_id ?? bookingId;
        const newStart = body.newSlot?.startTime ?? "";
        const APP_URL = Deno.env.get("APP_URL") || "https://bluladderbid.lovable.app";
        const manageLink = `${APP_URL}/my-appointments`;
        const bookingLink = `${APP_URL}/`;
        const bookingVersion = Number((result as Record<string, unknown>).bookingVersion ?? typedBooking.booking_version ?? 1);
        const serviceNames = Array.isArray(typedBooking.services_json)
          ? typedBooking.services_json.map((s) => s?.name).filter(Boolean) as string[] : [];
        const cancelledVersion = Number(
          (result as Record<string, unknown>).cancellationLifecycleVersion ??
          typedBooking.booking_version ?? 1,
        );
        const idempotencyKey =
          campaignEvent === 'booking_rescheduled'
            ? `booking_rescheduled:${bookingId}:v${bookingVersion}`
            : `booking_cancelled:${bookingId}:v${cancelledVersion}`;
        const serviceAddress = (typedBooking.home_details_json as Record<string, unknown> | null)?.address ?? "";
        await emitCampaignEvent({
          eventName: campaignEvent,
          idempotencyKey,
          email: typedBooking.customer?.email ?? null,
          customerId: typedBooking.customer_id,
          source: "customer-appointment-actions",
          recoverySupabase: serviceClient,
          subject:
            campaignEvent === 'booking_rescheduled'
              ? "Appointment rescheduled"
              : "Appointment cancelled",
          metadata: campaignEvent === 'booking_rescheduled' ? {
            booking_id: bookingId,
            booking_version: bookingVersion,
            quote_id: (result as Record<string, unknown>).quoteId ?? typedBooking.quote_id ?? null,
            jobber_visit_id: typedBooking.jobber_visit_id ?? null,
            booking_status: 'rescheduled',
            appointment_date: newStart || null,
            previous_appointment_date: typedBooking.scheduled_start,
            arrival_window: null,
            previous_arrival_window: null,
            service: serviceNames[0] ?? "your service",
            service_names: serviceNames,
            service_types: serviceNames,
            service_address: serviceAddress,
            booking_total: typedBooking.total,
            manage_link: manageLink,
            reschedule_link: manageLink,
            cancel_link: manageLink,
            reschedule_reason: (body.rescheduleReason ?? null),
          } : {
            // booking_cancelled — journey-scoped stop for reminders/reschedule
            // requests tied to this booking + version, plus safe merge fields.
            booking_id: bookingId,
            booking_version: cancelledVersion,
            quote_id: typedBooking.quote_id ?? null,
            jobber_visit_id: typedBooking.jobber_visit_id ?? null,
            booking_status: 'cancelled',
            previous_appointment_date: typedBooking.scheduled_start,
            previous_arrival_window: null,
            service: serviceNames[0] ?? "your service",
            service_names: serviceNames,
            service_types: serviceNames,
            service_address: serviceAddress,
            booking_total: typedBooking.total,
            cancellation_reason: (body.cancellationReason ?? null),
            manage_link: manageLink,
            booking_link: bookingLink,
          },
        });
      } catch (emitErr) {
        console.warn("[CustomerAction] campaign emit failed:", emitErr);
      }
    }

    // A cancellation that could not be verified with Jobber is returned as a
    // recoverable, non-error state so the UI can show a "we'll confirm shortly"
    // message instead of a false success or a scary failure.
    if (action === 'cancel' && result.status === 'needs_attention') {
      return new Response(
        JSON.stringify({
          success: false,
          needsAttention: true,
          status: 'needs_attention',
          message:
            "We received your cancellation request, but it still needs to be confirmed by our team. We'll contact you shortly.",
          ...result,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 }
      );
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

  // Guard: cannot reschedule a cancelled booking.
  if (booking.status === 'cancelled') {
    throw new Error("This booking has been cancelled and can no longer be rescheduled.");
  }

  // No-op guard: if the caller submitted the same slot the booking already
  // holds, do not bump the version or emit a duplicate confirmation.
  if (booking.scheduled_start === newSlot.startTime && booking.scheduled_end === newSlot.endTime) {
    return {
      action: 'reschedule',
      noop: true,
      previousStart: booking.scheduled_start,
      previousEnd: booking.scheduled_end,
      newStart: newSlot.startTime,
      newEnd: newSlot.endTime,
      bookingVersion: Number(booking.booking_version ?? 1),
      jobberSynced: false,
    };
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

  // Preferred authoritative write order:
  //   1. Validate & (implicitly) reserve the requested slot (caller responsibility)
  //   2. Update the Jobber visit  ← Jobber remains the visit system of record
  //   3. Persist local schedule + atomically bump booking_version
  //   4. Update local busy-block mirror (old-slot release)
  //   5. Emit `booking_rescheduled` (caller does this after this returns)
  //
  // Failure modes:
  //   * Jobber update fails → throw; local row + booking_version untouched;
  //     no confirmation event is emitted (caller only emits on success).
  //   * Local update fails after Jobber succeeded → throw; a webhook replay
  //     from Jobber will reconcile via the same idempotency key so no
  //     duplicate confirmation is ever emitted.
  //
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

  // Atomic booking-version bump with optimistic concurrency: the UPDATE only
  // fires when booking_version still matches what we read. A concurrent
  // reschedule race therefore fails one caller instead of silently overwriting.
  const currentVersion = Number(booking.booking_version ?? 1);
  const nextVersion = currentVersion + 1;
  const rescheduleReason = typeof body.rescheduleReason === "string"
    ? body.rescheduleReason.slice(0, 120) : null;
  const rescheduleNotes = typeof body.rescheduleNotes === "string"
    ? body.rescheduleNotes.slice(0, 500) : null;
  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update({
      scheduled_start: newSlot.startTime,
      scheduled_end: newSlot.endTime,
      technician_id: newSlot.technicianId,
      previous_scheduled_start: booking.scheduled_start,
      previous_scheduled_end: booking.scheduled_end,
      rescheduled_at: new Date().toISOString(),
      reschedule_source: 'customer_portal',
      reschedule_reason: rescheduleReason,
      reschedule_notes: rescheduleNotes,
      booking_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id)
    .eq("booking_version", currentVersion)
    .select("id, booking_version")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }
  if (!updated) {
    // Concurrent reschedule won the race — do NOT retry or overwrite. The
    // other caller's confirmation event is authoritative. Caller must skip
    // emitting a confirmation for this attempt.
    throw new Error("Booking was updated concurrently. Please refresh and try again.");
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
    bookingVersion: nextVersion,
    quoteId: booking.quote_id ?? null,
    servicesJson: booking.services_json,
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
  source: 'customer' | 'admin' | 'system',
  actorId: string | null,
  body: ActionRequest,
): Promise<Record<string, unknown>> {
  console.log(`[Cancel] Requested by ${source} for booking ${booking.reference_number} (status=${booking.status})`);

  // -------------------------------------------------------------------------
  // 1) Idempotency: an already-cancelled booking is a safe no-op. No Jobber
  //    call, no local mutation, no notifications.
  // -------------------------------------------------------------------------
  if (booking.status === 'cancelled') {
    console.log(`[Cancel] Booking ${booking.reference_number} already cancelled — idempotent no-op`);
    return {
      action: 'cancel',
      status: 'already_cancelled',
      jobberConfirmed: true,
      previousStart: booking.scheduled_start,
    };
  }

  // -------------------------------------------------------------------------
  // 2) Missing Jobber visit ID => we cannot verify anything with Jobber.
  //    This is a recoverable admin-attention case (fail closed).
  // -------------------------------------------------------------------------
  if (!booking.jobber_visit_id) {
    const reason = "No Jobber visit ID on booking — cannot verify cancellation with Jobber";
    console.warn(`[Cancel] ${reason} (${booking.reference_number})`);
    await markNeedsAttention(supabase, booking, reason);
    return {
      action: 'cancel',
      status: 'needs_attention',
      jobberConfirmed: false,
      previousStart: booking.scheduled_start,
    };
  }

  // -------------------------------------------------------------------------
  // 3) Ask Jobber to delete the visit using the correct plural mutation.
  // -------------------------------------------------------------------------
  console.log(`[Cancel] Deleting Jobber visit: ${booking.jobber_visit_id}`);
  const jobberResult = (await jobberGraphQL(DELETE_VISIT_MUTATION, {
    visitIds: [booking.jobber_visit_id],
  })) as VisitDeleteResult;

  const interpretation = interpretVisitDelete(jobberResult);
  console.log(`[Cancel] Jobber outcome: ${interpretation.outcome}${interpretation.reason ? ` (${interpretation.reason})` : ''}`);

  // -------------------------------------------------------------------------
  // 4) FAIL CLOSED: if we could not confirm removal, do NOT touch local state
  //    as if cancelled. Flag for manual attention and return a safe message.
  // -------------------------------------------------------------------------
  if (interpretation.outcome === 'failed') {
    await markNeedsAttention(supabase, booking, interpretation.reason || 'Jobber did not confirm cancellation');
    return {
      action: 'cancel',
      status: 'needs_attention',
      jobberConfirmed: false,
      previousStart: booking.scheduled_start,
    };
  }

  // interpretation.outcome is 'confirmed' or 'already_gone' — both mean the
  // visit is gone from Jobber, so it is safe to synchronize local state.
  const nowIso = new Date().toISOString();
  const cancellationReason = typeof body.cancellationReason === 'string'
    ? body.cancellationReason.slice(0, 120) : null;
  const cancellationNotes = typeof body.cancellationNotes === 'string'
    ? body.cancellationNotes.slice(0, 500) : null;
  const currentVersion = Number(booking.booking_version ?? 1);
  const nextVersion = currentVersion + 1;
  // Only stamp cancelled_by when we have a real auth uuid (customer or admin).
  // The 'system' source can pass a null actor.
  const actorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId ?? '')
    ? actorId : null;

  // 5) Mark local booking cancelled atomically with optimistic concurrency on
  // booking_version so a concurrent reschedule cannot silently overwrite the
  // cancellation (and vice versa).
  const { data: updated, error: updateError } = await supabase
    .from("bookings")
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      cancellation_source: source,
      cancellation_reason: cancellationReason,
      cancellation_notes: cancellationNotes,
      cancelled_by: actorUuid,
      cancellation_lifecycle_version: nextVersion,
      jobber_cancellation_status: interpretation.outcome,
      slot_released_at: nowIso,
      booking_version: nextVersion,
      cancellation_needs_attention_reason: null,
      updated_at: nowIso,
    })
    .eq("id", booking.id)
    .eq("booking_version", currentVersion)
    .select("id, booking_version")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Database update failed: ${updateError.message}`);
  }
  if (!updated) {
    // A concurrent write won the race — do NOT emit a confirmation for this
    // attempt. A retry can pick up whichever state now exists.
    throw new Error("Booking was updated concurrently. Please refresh and try again.");
  }

  // 6) Mark mirrored schedule blocks cancelled (keep rows for audit) so the
  //    time immediately frees up in availability.
  const { error: blockErr } = await supabase
    .from("jobber_busy_blocks")
    .update({ status: 'cancelled', updated_at: nowIso })
    .eq("jobber_visit_id", booking.jobber_visit_id);
  if (blockErr) {
    console.warn(`[Cancel] Failed to cancel busy blocks: ${blockErr.message}`);
  }

  // 7) Release any active slot reservations tied to this booking.
  const { error: resErr } = await supabase
    .from("slot_reservations")
    .update({ status: 'released', updated_at: nowIso })
    .eq("booking_id", booking.id)
    .in("status", ["held", "confirmed"]);
  if (resErr) {
    console.warn(`[Cancel] Failed to release slot reservations: ${resErr.message}`);
  }

  console.log(`[Cancel] Booking ${booking.reference_number} cancelled (${interpretation.outcome}) by ${source}${actorId ? ` [${actorId}]` : ''}`);

  return {
    action: 'cancel',
    status: 'cancelled',
    jobberConfirmed: true,
    idempotentAlreadyGone: interpretation.outcome === 'already_gone',
    cancelledAt: nowIso,
    cancellationSource: source,
    cancellationReason,
    cancellationLifecycleVersion: nextVersion,
    bookingVersion: nextVersion,
    jobberCancellationStatus: interpretation.outcome,
    previousStart: booking.scheduled_start,
  };
}

// Flag a booking that could not be confirmed-cancelled for manual admin review.
// Never overwrites an already-terminal status, and never claims cancellation.
async function markNeedsAttention(
  supabase: AnySupabaseClient,
  booking: BookingRecord,
  reason: string,
): Promise<void> {
  if (booking.status === 'cancelled' || booking.status === 'completed') return;
  const { error } = await supabase
    .from("bookings")
    .update({
      status: 'needs_attention',
      cancellation_needs_attention_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id);
  if (error) {
    console.error(`[Cancel] Failed to flag needs_attention for ${booking.reference_number}:`, error.message);
  }
}
