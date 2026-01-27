import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

interface JobberWebhookPayload {
  webHookEvent: string;
  itemId: string;
  data?: Record<string, unknown>;
}

// Generate a unique event ID from the payload
function generateEventId(payload: JobberWebhookPayload): string {
  const content = JSON.stringify(payload);
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${payload.webHookEvent}-${payload.itemId}-${Math.abs(hash)}`;
}

// Fetch visit details from Jobber to get full schedule data
async function fetchVisitDetails(visitId: string) {
  const query = `
    query GetVisit($id: EncodedId!) {
      visit(id: $id) {
        id
        title
        startAt
        endAt
        status
        assignedServicers {
          nodes {
            id
            name
          }
        }
        job {
          id
          title
          property {
            address {
              street
              city
              province
              postalCode
            }
          }
          client {
            name
          }
        }
      }
    }
  `;

  const result = await jobberGraphQL<{
    visit: {
      id: string;
      title: string;
      startAt: string;
      endAt: string;
      status: string;
      assignedServicers: { nodes: Array<{ id: string; name: string }> };
      job: {
        id: string;
        title: string;
        property: {
          address: {
            street: string;
            city: string;
            province: string;
            postalCode: string;
          };
        };
        client: { name: string };
      };
    };
  }>(query, { id: visitId });

  return result.data?.visit;
}

// Upsert a busy block from visit data
async function upsertBusyBlock(
  supabase: AnySupabaseClient,
  visit: {
    id: string;
    startAt: string;
    endAt: string;
    status: string;
    assignedServicers?: { nodes: Array<{ id: string; name: string }> };
    job?: {
      id: string;
      property?: { address?: { street: string; city: string; province: string; postalCode: string } };
      client?: { name: string };
    };
  }
) {
  const assignees = visit.assignedServicers?.nodes || [];
  
  // Create a busy block for each assigned crew member
  for (const assignee of assignees) {
    const address = visit.job?.property?.address;
    const fullAddress = address 
      ? `${address.street}, ${address.city}, ${address.province} ${address.postalCode}`
      : null;

    const { error } = await supabase
      .from("jobber_busy_blocks")
      .upsert(
        {
          jobber_visit_id: visit.id,
          crew_id: assignee.id,
          start_at: visit.startAt,
          end_at: visit.endAt,
          status: visit.status?.toLowerCase() || 'scheduled',
          jobber_job_id: visit.job?.id || null,
          client_name: visit.job?.client?.name || null,
          client_address: fullAddress,
          source: 'jobber',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'jobber_visit_id' }
      );

    if (error) {
      console.error("Failed to upsert busy block:", error);
    }
  }
}

// Delete a busy block (for cancelled visits)
async function deleteBusyBlock(
  supabase: AnySupabaseClient,
  visitId: string
) {
  // Mark as cancelled (keeps history)
  const { error } = await supabase
    .from("jobber_busy_blocks")
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq("jobber_visit_id", visitId);

  if (error) {
    console.error("Failed to mark busy block as cancelled:", error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  // Verify webhook secret
  const webhookSecret = Deno.env.get("JOBBER_WEBHOOK_SECRET");
  const providedSecret = req.headers.get("x-webhook-secret");
  
  if (webhookSecret && providedSecret !== webhookSecret) {
    console.error("Invalid webhook secret");
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let payload: JobberWebhookPayload;
  
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  const eventId = generateEventId(payload);
  console.log("Received Jobber webhook:", payload.webHookEvent, payload.itemId, "eventId:", eventId);

  // Store event for deduplication and debugging
  const { error: eventError } = await supabase
    .from("jobber_webhook_events")
    .insert({
      event_id: eventId,
      topic: payload.webHookEvent,
      payload: payload,
    });

  // If duplicate, return success (already processed)
  if (eventError?.code === '23505') {
    console.log("Duplicate webhook event, skipping:", eventId);
    return new Response(
      JSON.stringify({ received: true, duplicate: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let processingError: string | null = null;

  try {
    // Handle different webhook events
    switch (payload.webHookEvent) {
      // ===== VISIT EVENTS - Mirror to busy_blocks =====
      case "VISIT_SCHEDULED":
      case "VISIT_RESCHEDULED":
      case "VISIT_UPDATED": {
        // Fetch full visit details from Jobber
        const visit = await fetchVisitDetails(payload.itemId);
        if (visit) {
          await upsertBusyBlock(supabase, visit);
          console.log("Upserted busy block for visit:", payload.itemId);
        } else {
          console.warn("Could not fetch visit details:", payload.itemId);
        }
        
        // Also update local bookings table
        if (payload.data) {
          await supabase
            .from("bookings")
            .update({
              scheduled_start: payload.data.startAt as string,
              scheduled_end: payload.data.endAt as string,
              status: "scheduled",
            })
            .eq("jobber_visit_id", payload.itemId);
        }
        break;
      }

      case "VISIT_COMPLETED": {
        // Mark as completed in busy blocks
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq("jobber_visit_id", payload.itemId);
        
        // Update bookings table
        await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_visit_id", payload.itemId);
        break;
      }

      case "VISIT_CANCELLED":
      case "VISIT_DELETED": {
        await deleteBusyBlock(supabase, payload.itemId);
        
        // Update bookings table
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_visit_id", payload.itemId);
        break;
      }

      // ===== JOB EVENTS =====
      case "JOB_CREATED":
      case "JOB_UPDATED": {
        await supabase
          .from("bookings")
          .update({ updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);
        break;
      }

      case "JOB_COMPLETED": {
        // Mark all visits for this job as completed
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);
        
        await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_job_id", payload.itemId);
        break;
      }

      case "JOB_CANCELLED": {
        // Mark all visits for this job as cancelled
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);
        
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_job_id", payload.itemId);
        break;
      }

      default:
        console.log("Unhandled webhook event:", payload.webHookEvent);
    }

    // Mark event as processed
    await supabase
      .from("jobber_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("event_id", eventId);

  } catch (error) {
    console.error("Webhook processing error:", error);
    processingError = error instanceof Error ? error.message : String(error);
    
    // Store error for debugging
    await supabase
      .from("jobber_webhook_events")
      .update({ 
        processed_at: new Date().toISOString(),
        processing_error: processingError 
      })
      .eq("event_id", eventId);
  }

  return new Response(
    JSON.stringify({ received: true, error: processingError }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
