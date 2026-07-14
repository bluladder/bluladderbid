import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrService } from "../_shared/auth.ts";
import { checkSuppression } from "../_shared/suppression.ts";
import { sendEmail } from "../_shared/emailConfig.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NotificationRequest {
  bookingId: string;
  eventType: 'scheduled' | 'rescheduled' | 'cancelled' | 'services_modified' | 'price_changed' | 'tech_reassigned';
  triggeredBy: 'customer' | 'admin' | 'system';
  triggeredById?: string;
  notifyCustomer: boolean;
  requireConfirmation: boolean;
  showPriceChange: boolean;
  adminNote?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  confirmationExpiryHours?: number;
}

const APP_URL = Deno.env.get("APP_URL") || "https://bluladderbid.lovable.app";

function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(price);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function generateEmailContent(
  eventType: string,
  booking: Record<string, unknown>,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  showPriceChange: boolean,
  adminNote?: string,
  confirmationUrl?: string
): { subject: string; html: string } {
  const customer = booking.customer as Record<string, unknown> | undefined;
  const customerName = `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Customer';
  const refNum = booking.reference_number as string;
  
  let subject = '';
  let changeDescription = '';
  let actionHtml = '';

  switch (eventType) {
    case 'scheduled':
      subject = `Appointment Confirmed - ${refNum}`;
      changeDescription = `
        <p>Your appointment has been scheduled!</p>
        <p><strong>Date & Time:</strong> ${formatDateTime(booking.scheduled_start as string)}</p>
        <p><strong>Services:</strong> ${(booking.services_json as Array<{name: string}>).map(s => s.name).join(', ')}</p>
        ${showPriceChange ? `<p><strong>Total:</strong> ${formatPrice(booking.total as number)}</p>` : ''}
      `;
      actionHtml = `<a href="${APP_URL}/my-appointments" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Appointment</a>`;
      break;

    case 'rescheduled':
      subject = `Appointment Rescheduled - ${refNum}`;
      changeDescription = `
        <p>Your appointment has been rescheduled.</p>
        <p><strong>Previous:</strong> ${oldValues.scheduled_start ? formatDateTime(oldValues.scheduled_start as string) : 'N/A'}</p>
        <p><strong>New:</strong> ${newValues.scheduled_start ? formatDateTime(newValues.scheduled_start as string) : formatDateTime(booking.scheduled_start as string)}</p>
      `;
      break;

    case 'cancelled':
      subject = `Appointment Cancelled - ${refNum}`;
      changeDescription = `
        <p>Your appointment has been cancelled.</p>
        <p><strong>Original Date:</strong> ${oldValues.scheduled_start ? formatDateTime(oldValues.scheduled_start as string) : 'N/A'}</p>
      `;
      actionHtml = `<a href="${APP_URL}/services" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Book New Appointment</a>`;
      break;

    case 'services_modified':
      subject = `Services Updated - ${refNum}`;
      const oldServices = (oldValues.services_json as Array<{name: string}>) || [];
      const newServices = (newValues.services_json as Array<{name: string; price: number}>) || (booking.services_json as Array<{name: string; price: number}>);
      changeDescription = `
        <p>The services for your appointment have been updated.</p>
        ${oldServices.length > 0 ? `<p><strong>Previous Services:</strong> ${oldServices.map(s => s.name).join(', ')}</p>` : ''}
        <p><strong>Updated Services:</strong> ${newServices.map(s => s.name).join(', ')}</p>
        ${showPriceChange && newValues.total ? `<p><strong>New Total:</strong> ${formatPrice(newValues.total as number)}</p>` : ''}
      `;
      break;

    case 'price_changed':
      subject = `Price Updated - ${refNum}`;
      changeDescription = `
        <p>The price for your appointment has been updated.</p>
        ${showPriceChange ? `
          <p><strong>Previous Total:</strong> ${formatPrice(oldValues.total as number || 0)}</p>
          <p><strong>New Total:</strong> ${formatPrice(newValues.total as number || booking.total as number)}</p>
        ` : '<p>Please contact us for details.</p>'}
      `;
      break;

    case 'tech_reassigned':
      subject = `Technician Update - ${refNum}`;
      changeDescription = `
        <p>We've updated the technician assigned to your appointment.</p>
        <p>Your appointment details remain unchanged.</p>
      `;
      break;

    default:
      subject = `Appointment Update - ${refNum}`;
      changeDescription = `<p>There has been an update to your appointment.</p>`;
  }

  if (confirmationUrl) {
    actionHtml = `
      <p style="margin-bottom: 16px;"><strong>Please review and confirm this change:</strong></p>
      <a href="${confirmationUrl}" style="background-color: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Review & Confirm</a>
    `;
  }

  if (!actionHtml && eventType !== 'cancelled') {
    actionHtml = `<a href="${APP_URL}/my-appointments" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">View Appointment</a>`;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #1e40af; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">BluLadder</h1>
      </div>
      <div style="background-color: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
        <h2 style="color: #1e40af; margin-top: 0;">${subject}</h2>
        <p>Hi ${customerName},</p>
        ${changeDescription}
        ${adminNote ? `
          <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 16px 0;">
            <strong>Note from our team:</strong>
            <p style="margin: 8px 0 0 0;">${adminNote}</p>
          </div>
        ` : ''}
        <div style="margin-top: 24px; text-align: center;">
          ${actionHtml}
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 14px; color: #6b7280;">
          If you have any questions, please contact us at support@bluladder.com
        </p>
      </div>
      <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 12px;">
        © ${new Date().getFullYear()} BluLadder. All rights reserved.
      </div>
    </body>
    </html>
  `;

  return { subject, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Sending real customer emails and flipping booking status is an
    // admin-only / internal action. Reject unauthenticated callers.
    const auth = await requireAdminOrService(req);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.warn("RESEND_API_KEY not configured - notifications will be logged only");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: NotificationRequest = await req.json();
    const {
      bookingId,
      eventType,
      triggeredBy,
      triggeredById,
      notifyCustomer,
      requireConfirmation,
      showPriceChange,
      adminNote,
      oldValues = {},
      newValues = {},
      confirmationExpiryHours = 24,
    } = body;

    // Fetch booking with customer info
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        customer:customers(first_name, last_name, email, phone)
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error(`Booking not found: ${bookingError?.message}`);
    }

    const customerEmail = booking.customer?.email;
    if (!customerEmail) {
      throw new Error("Customer email not found");
    }

    let confirmationUrl: string | undefined;
    let confirmationToken: string | undefined;

    // Create pending confirmation if required
    if (requireConfirmation && notifyCustomer) {
      confirmationToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + confirmationExpiryHours * 60 * 60 * 1000);

      const { error: confError } = await supabase
        .from('pending_confirmations')
        .insert({
          booking_id: bookingId,
          token: confirmationToken,
          change_type: eventType,
          old_values: oldValues,
          new_values: newValues,
          admin_note: adminNote,
          show_price_change: showPriceChange,
          expires_at: expiresAt.toISOString(),
          created_by: triggeredById,
        });

      if (confError) {
        console.error("Failed to create pending confirmation:", confError);
      } else {
        confirmationUrl = `${APP_URL}/confirm-change?token=${confirmationToken}`;
        
        // Update booking status to pending_confirmation
        await supabase
          .from('bookings')
          .update({ status: 'pending_confirmation' })
          .eq('id', bookingId);
      }
    }

    // Generate email content
    const { subject, html } = generateEmailContent(
      eventType,
      booking,
      oldValues,
      newValues,
      showPriceChange,
      adminNote,
      confirmationUrl
    );

    let emailSent = false;
    let emailError: string | undefined;

    // System-test suppression, checked immediately before delivery.
    const notifySuppression = await checkSuppression(supabase, { email: customerEmail });

    // Send email if notifying customer, Resend is configured, and not suppressed
    if (notifyCustomer && resendApiKey && !notifySuppression.suppressed) {
      try {
        const emailResponse = await sendEmail(resendApiKey, {
          from: FROM_EMAIL,
          to: [customerEmail],
          subject,
          html,
        });
        console.log("Email sent:", emailResponse);
        emailSent = true;
      } catch (err) {
        console.error("Failed to send email:", err);
        emailError = err instanceof Error ? err.message : String(err);
      }
    }

    // Log notification event
    const { error: logError } = await supabase
      .from('notification_events')
      .insert({
        booking_id: bookingId,
        event_type: eventType,
        triggered_by: triggeredBy,
        triggered_by_id: triggeredById,
        channel: 'email',
        sent_at: emailSent ? new Date().toISOString() : null,
        suppressed: !notifyCustomer || notifySuppression.suppressed,
        suppressed_reason: notifySuppression.suppressed
          ? `Suppressed (${notifySuppression.reason})`
          : !notifyCustomer
            ? 'Admin chose not to notify'
            : null,
        notification_content: {
          subject,
          recipient: customerEmail,
          requireConfirmation,
          confirmationToken,
          error: emailError,
        },
        customer_action: requireConfirmation ? 'pending' : null,
      });

    if (logError) {
      console.error("Failed to log notification:", logError);
    }

    return new Response(JSON.stringify({
      success: true,
      emailSent,
      confirmationRequired: requireConfirmation,
      confirmationToken,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Error in send-notification:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
