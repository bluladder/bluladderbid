import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ConfirmationRequest {
  token: string;
  action: 'accept' | 'decline';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { token, action }: ConfirmationRequest = await req.json();

    if (!token || !action) {
      throw new Error("Missing token or action");
    }

    // Fetch pending confirmation
    const { data: confirmation, error: fetchError } = await supabase
      .from('pending_confirmations')
      .select(`
        *,
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
      .eq('status', 'pending')
      .single();

    if (fetchError || !confirmation) {
      throw new Error("Confirmation not found or already processed");
    }

    // Check expiry
    if (new Date(confirmation.expires_at) < new Date()) {
      await supabase
        .from('pending_confirmations')
        .update({ status: 'expired' })
        .eq('id', confirmation.id);
      throw new Error("This confirmation link has expired");
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
        updateData.status = 'cancelled';
      }

      // Update booking
      const { error: updateError } = await supabase
        .from('bookings')
        .update(updateData)
        .eq('id', bookingId);

      if (updateError) {
        throw new Error(`Failed to update booking: ${updateError.message}`);
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
