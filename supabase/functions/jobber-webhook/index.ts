import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobberWebhookPayload {
  webHookEvent: string;
  itemId: string;
  data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  try {
    const payload: JobberWebhookPayload = await req.json();
    console.log("Received Jobber webhook:", payload.webHookEvent, payload.itemId);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle different webhook events
    switch (payload.webHookEvent) {
      case "JOB_CREATED":
      case "JOB_UPDATED": {
        // Find and update our booking if it exists
        const { error } = await supabase
          .from("bookings")
          .update({ updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);

        if (error) {
          console.log("No matching booking found for job:", payload.itemId);
        }
        break;
      }

      case "JOB_COMPLETED": {
        const { error } = await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_job_id", payload.itemId);

        if (error) {
          console.error("Failed to update booking status:", error);
        }
        break;
      }

      case "VISIT_SCHEDULED":
      case "VISIT_RESCHEDULED": {
        // Update scheduled times if we have visit data
        if (payload.data) {
          const { error } = await supabase
            .from("bookings")
            .update({
              scheduled_start: payload.data.startAt as string,
              scheduled_end: payload.data.endAt as string,
              status: "scheduled",
            })
            .eq("jobber_visit_id", payload.itemId);

          if (error) {
            console.log("No matching booking found for visit:", payload.itemId);
          }
        }
        break;
      }

      case "VISIT_COMPLETED": {
        const { error } = await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_visit_id", payload.itemId);

        if (error) {
          console.log("No matching booking found for visit:", payload.itemId);
        }
        break;
      }

      case "JOB_CANCELLED": {
        const { error } = await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_job_id", payload.itemId);

        if (error) {
          console.log("No matching booking found for job:", payload.itemId);
        }
        break;
      }

      default:
        console.log("Unhandled webhook event:", payload.webHookEvent);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
