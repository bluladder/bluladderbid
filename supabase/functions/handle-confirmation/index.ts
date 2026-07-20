import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ConfirmationRequest {
  token: string;
  action?: 'accept' | 'decline' | 'fetch'; // 'fetch' returns data without modifying
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { token, action = 'fetch' }: ConfirmationRequest = await req.json();

    if (!token) {
      throw new Error("Missing token");
    }

    // Validate token format (basic sanitization)
    if (typeof token !== 'string' || token.length < 10 || token.length > 200) {
      throw new Error("Invalid token format");
    }

    // Fetch pending confirmation using the token as a secret lookup key
    const { data: confirmation, error: fetchError } = await supabase
      .from('pending_confirmations')
      .select(`
        id,
        booking_id,
        change_type,
        old_values,
        new_values,
        admin_note,
        show_price_change,
        expires_at,
        status,
        booking:bookings(
          id, 
          reference_number, 
          status, 
          scheduled_start, 
          scheduled_end,
          services_json,
          total
        )
      `)
      .eq('token', token)
      .single();

    if (fetchError || !confirmation) {
      console.error("Confirmation lookup failed:", fetchError);
      throw new Error("Confirmation not found or invalid token");
    }

    // Check if already processed
    if (confirmation.status !== 'pending') {
      return new Response(JSON.stringify({
        error: `This change has already been ${confirmation.status}.`,
        alreadyProcessed: true,
        status: confirmation.status,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check expiry
    if (new Date(confirmation.expires_at) < new Date()) {
      await supabase
        .from('pending_confirmations')
        .update({ status: 'expired' })
        .eq('id', confirmation.id);
      
      return new Response(JSON.stringify({
        error: "This confirmation link has expired. Please contact us for assistance.",
        expired: true,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // If action is 'fetch', just return the confirmation data (for display)
    if (action === 'fetch') {
      // Return data WITHOUT the token (never expose it back)
      return new Response(JSON.stringify({
        success: true,
        confirmation: {
          id: confirmation.id,
          booking_id: confirmation.booking_id,
          change_type: confirmation.change_type,
          old_values: confirmation.old_values,
          new_values: confirmation.new_values,
          admin_note: confirmation.admin_note,
          show_price_change: confirmation.show_price_change,
          expires_at: confirmation.expires_at,
          status: confirmation.status,
          booking: confirmation.booking,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Process accept/decline action
    if (action !== 'accept' && action !== 'decline') {
      throw new Error("Invalid action. Must be 'accept', 'decline', or 'fetch'.");
    }

    const bookingId = confirmation.booking_id;

    if (action === 'accept') {
      // Apply the changes
      const newValues = confirmation.new_values as Record<string, unknown>;
      
      // Build update object based on change type
      const updateData: Record<string, unknown> = {
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      };

      if (confirmation.change_type === 'reschedule') {
        if (newValues.scheduled_start) updateData.scheduled_start = newValues.scheduled_start;
        if (newValues.scheduled_end) updateData.scheduled_end = newValues.scheduled_end;
        if (newValues.technician_id) updateData.technician_id = newValues.technician_id;
      } else if (confirmation.change_type === 'services_modified') {
        if (newValues.services_json) updateData.services_json = newValues.services_json;
        if (newValues.subtotal) updateData.subtotal = newValues.subtotal;
        if (newValues.total) updateData.total = newValues.total;
      } else if (confirmation.change_type === 'cancelled') {
        // Route customer-confirmation-driven cancellations through the
        // canonical helper so version/slot/emit semantics stay consistent
        // with the portal/admin/webhook paths.
        try {
          const { finalizeBookingCancellation } = await import("../_shared/bookingCancellation.ts");
          const outcome = await finalizeBookingCancellation(supabase, {
            bookingId,
            source: "customer_confirmation",
            reason: "customer_confirmed_cancellation",
            jobberOutcome: "reconciled",
          });
          console.log("[HandleConfirmation] canonical cancel outcome", outcome);
        } catch (e) {
          console.error("[HandleConfirmation] canonical cancel failed:", e instanceof Error ? e.message : e);
        }
        // Skip the local UPDATE below — the helper already set authoritative
        // fields (status, version, slot release, cancelled_at, etc).
        updateData.__handled_by_canonical__ = true;
      }

      // Only run the local UPDATE for non-canonical change types.
      if (!(updateData as Record<string, unknown>).__handled_by_canonical__) {
        const { error: updateError } = await supabase
          .from('bookings')
          .update(updateData)
          .eq('id', bookingId);

        if (updateError) {
          throw new Error(`Failed to update booking: ${updateError.message}`);
        }
      }

      // Log audit entry
      await supabase.from('booking_audit_log').insert({
        booking_id: bookingId,
        action: `${confirmation.change_type}_confirmed`,
        old_values: confirmation.old_values,
        new_values: newValues,
        changed_by: 'customer',
        is_admin_override: false,
      });

    } else {
      // Decline - revert to original status
      await supabase
        .from('bookings')
        .update({ 
          status: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      // Log audit entry
      await supabase.from('booking_audit_log').insert({
        booking_id: bookingId,
        action: `${confirmation.change_type}_declined`,
        old_values: confirmation.old_values,
        new_values: { declined: true },
        changed_by: 'customer',
        is_admin_override: false,
      });
    }

    // Update confirmation status
    await supabase
      .from('pending_confirmations')
      .update({
        status: action === 'accept' ? 'accepted' : 'declined',
        responded_at: new Date().toISOString(),
      })
      .eq('id', confirmation.id);

    // Update notification event
    await supabase
      .from('notification_events')
      .update({
        customer_action: action === 'accept' ? 'accepted' : 'declined',
        customer_action_at: new Date().toISOString(),
      })
      .eq('booking_id', bookingId)
      .eq('customer_action', 'pending');

    return new Response(JSON.stringify({
      success: true,
      action,
      message: action === 'accept' 
        ? 'Changes have been confirmed!' 
        : 'Changes have been declined. Your appointment remains unchanged.',
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (error) {
    console.error("Error in handle-confirmation:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
