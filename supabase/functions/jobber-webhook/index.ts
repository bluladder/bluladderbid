import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-debug-webhook",
};

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

interface JobberWebhookPayload {
  webHookEvent: string;
  itemId: string;
  data?: Record<string, unknown>;
}

// Convert Headers to plain object for logging
function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    // Redact sensitive headers in logs but keep for storage
    obj[key] = value;
  });
  return obj;
}

// Truncate string to max length
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `...[truncated, total ${str.length} chars]`;
}

// Generate a unique event ID from the payload
function generateEventId(payload: JobberWebhookPayload): string {
  const timestamp = Date.now();
  return `${payload.webHookEvent}-${payload.itemId}-${timestamp}`;
}

// Fetch visit details from Jobber to get full schedule data
async function fetchVisitDetails(visitId: string) {
  console.log(`[Webhook] 🔍 Fetching visit details for: ${visitId}`);
  
  const query = `
    query GetVisit($id: EncodedId!) {
      visit(id: $id) {
        id
        title
        startAt
        endAt
        assignedUsers {
          nodes {
            id
            name {
              full
            }
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
      assignedUsers: { nodes: Array<{ id: string; name: { full: string } }> };
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

  if (result.errors) {
    console.error(`[Webhook] ❌ Failed to fetch visit:`, result.errors);
    return null;
  }

  const visit = result.data?.visit;
  if (visit) {
    console.log(`[Webhook] ✅ Got visit: ${visit.title}, ${visit.startAt} - ${visit.endAt}`);
    console.log(`[Webhook]    Assigned users: ${visit.assignedUsers?.nodes?.map(u => u.name?.full || u.id).join(', ') || 'none'}`);
  }
  
  return visit;
}

// Upsert a busy block from visit data
async function upsertBusyBlock(
  supabase: AnySupabaseClient,
  visit: {
    id: string;
    startAt: string;
    endAt: string;
    assignedUsers?: { nodes: Array<{ id: string; name?: { full: string } }> };
    job?: {
      id: string;
      property?: { address?: { street: string; city: string; province: string; postalCode: string } };
      client?: { name: string };
    };
  }
): Promise<{ inserted: number; errors: number }> {
  const assignees = visit.assignedUsers?.nodes || [];
  let inserted = 0;
  let errors = 0;
  
  console.log(`[Webhook] 💾 Upserting busy blocks for ${assignees.length} assignee(s)`);
  
  for (const assignee of assignees) {
    const address = visit.job?.property?.address;
    const fullAddress = address 
      ? `${address.street}, ${address.city}, ${address.province} ${address.postalCode}`
      : null;

    const blockData = {
      jobber_visit_id: visit.id,
      crew_id: assignee.id,
      start_at: visit.startAt,
      end_at: visit.endAt,
      status: 'scheduled',
      jobber_job_id: visit.job?.id || null,
      client_name: visit.job?.client?.name || null,
      client_address: fullAddress,
      source: 'webhook',
      updated_at: new Date().toISOString(),
    };

    console.log(`[Webhook]    → Crew: ${assignee.id} (${assignee.name?.full || 'unknown'})`);

    const { error } = await supabase
      .from("jobber_busy_blocks")
      .upsert(blockData, { onConflict: 'jobber_visit_id' });

    if (error) {
      console.error(`[Webhook] ❌ Upsert failed for ${assignee.id}:`, error.message);
      errors++;
    } else {
      console.log(`[Webhook] ✅ Upserted block for ${assignee.id}`);
      inserted++;
    }
  }

  return { inserted, errors };
}

// Delete/cancel a busy block
async function markBusyBlockCancelled(
  supabase: AnySupabaseClient,
  visitId: string
): Promise<boolean> {
  console.log(`[Webhook] 🗑️ Marking visit ${visitId} as cancelled`);
  
  const { error, count } = await supabase
    .from("jobber_busy_blocks")
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq("jobber_visit_id", visitId);

  if (error) {
    console.error(`[Webhook] ❌ Failed to cancel block:`, error.message);
    return false;
  }
  
  console.log(`[Webhook] ✅ Cancelled ${count || 0} block(s) for visit ${visitId}`);
  return true;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const receivedAt = new Date().toISOString();
  
  console.log(`\n[Webhook] ═══════════════════════════════════════`);
  console.log(`[Webhook] 📨 Request received (${requestId}) at ${receivedAt}`);
  console.log(`[Webhook]    Method: ${req.method}`);
  console.log(`[Webhook]    URL: ${req.url}`);

  if (req.method === "OPTIONS") {
    console.log(`[Webhook] ↩️ CORS preflight`);
    return new Response(null, { headers: corsHeaders });
  }

  // Check if DEBUG_MODE is enabled via environment variable
  const DEBUG_MODE = Deno.env.get("JOBBER_WEBHOOK_DEBUG") === "true";
  console.log(`[Webhook] 🔧 DEBUG_MODE (env): ${DEBUG_MODE}`);

  // Capture all headers for logging
  const headersObj = headersToObject(req.headers);
  console.log(`[Webhook] 📋 Headers received:`, JSON.stringify(headersObj, null, 2));

  // Read raw body
  let rawBody = "";
  try {
    rawBody = await req.text();
    console.log(`[Webhook] 📦 Raw body length: ${rawBody.length} chars`);
    console.log(`[Webhook] 📦 Raw body preview: ${truncate(rawBody, 500)}`);
  } catch (e) {
    console.error(`[Webhook] ❌ Failed to read body:`, e);
    // In debug mode, still return 200 to keep Jobber happy
    if (DEBUG_MODE) {
      return new Response(
        JSON.stringify({ ok: true, debug: true, error: "Failed to read body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to read body" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  // Try to parse JSON
  let parsedJson: unknown = null;
  let eventType: string | null = null;
  
  try {
    parsedJson = JSON.parse(rawBody);
    // Try to extract event type from various possible fields
    const p = parsedJson as Record<string, unknown>;
    eventType = (p.webHookEvent || p.event || p.topic || p.type || 
                 (p.data as Record<string, unknown>)?.type || null) as string | null;
    console.log(`[Webhook] ✅ JSON parsed successfully, event_type: ${eventType}`);
  } catch (e) {
    console.log(`[Webhook] ⚠️ JSON parse failed (might be form data or other format)`);
  }

  // Initialize Supabase with service role for DB writes
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error(`[Webhook] ❌ Missing Supabase credentials`);
    return new Response(
      JSON.stringify({ ok: DEBUG_MODE, error: "Server configuration error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: DEBUG_MODE ? 200 : 500 }
    );
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ======== DEBUG MODE: Log everything, accept all, return 200 ========
  if (DEBUG_MODE) {
    console.log(`[Webhook] 🧪 DEBUG MODE ACTIVE - skipping verification, logging all`);
    
    // Store in jobber_webhook_events for debugging
    const debugEventId = `debug-${requestId}-${Date.now()}`;
    const { error: insertError } = await supabase
      .from("jobber_webhook_events")
      .insert({
        event_id: debugEventId,
        topic: eventType || 'unknown',
        received_at: receivedAt,
        headers: headersObj,
        raw_body: truncate(rawBody, 20000),
        payload: parsedJson,
      });

    if (insertError) {
      console.error(`[Webhook] ❌ Failed to store debug event:`, insertError.message);
    } else {
      console.log(`[Webhook] ✅ Debug event stored with ID: ${debugEventId}`);
    }

    // Log summary line for easy grep
    const payloadId = parsedJson ? ((parsedJson as Record<string, unknown>).itemId || 
                                     (parsedJson as Record<string, unknown>).id || 'no-id') : 'no-parse';
    console.log(`[Webhook] 📝 SUMMARY: event_type=${eventType} | received_at=${receivedAt} | payload_id=${payloadId}`);
    
    console.log(`[Webhook] ═══════════════════════════════════════\n`);
    
    // Always return 200 in debug mode
    return new Response(
      JSON.stringify({ 
        ok: true, 
        debug: true,
        requestId,
        eventType,
        receivedAt,
        stored: !insertError,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  // ======== PRODUCTION MODE: Normal verification + processing ========
  
  if (req.method !== "POST") {
    console.log(`[Webhook] ❌ Method not allowed: ${req.method}`);
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  // Verify webhook secret (production only)
  const webhookSecret = Deno.env.get("JOBBER_WEBHOOK_SECRET");
  const providedSecret = req.headers.get("x-webhook-secret");
  
  console.log(`[Webhook] 🔐 Secret verification:`);
  console.log(`[Webhook]    Expected secret configured: ${!!webhookSecret}`);
  console.log(`[Webhook]    Provided secret present: ${!!providedSecret}`);
  
  if (webhookSecret && providedSecret !== webhookSecret) {
    console.log(`[Webhook] ❌ Secret mismatch - rejecting`);
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }
  
  if (webhookSecret && providedSecret === webhookSecret) {
    console.log(`[Webhook] ✅ Secret verified`);
  } else if (!webhookSecret) {
    console.log(`[Webhook] ⚠️ No secret configured - accepting all requests`);
  }

  // Validate payload structure
  if (!parsedJson) {
    console.log(`[Webhook] ❌ Invalid JSON payload`);
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  const payload = parsedJson as JobberWebhookPayload;
  
  if (!payload.webHookEvent || !payload.itemId) {
    console.log(`[Webhook] ❌ Missing required fields (webHookEvent, itemId)`);
    return new Response(
      JSON.stringify({ error: "Missing required fields" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  console.log(`[Webhook] 📦 Payload parsed:`);
  console.log(`[Webhook]    Event: ${payload.webHookEvent}`);
  console.log(`[Webhook]    Item ID: ${payload.itemId}`);
  console.log(`[Webhook]    Data keys: ${payload.data ? Object.keys(payload.data).join(', ') : 'none'}`);

  const eventId = generateEventId(payload);
  console.log(`[Webhook] 🆔 Generated event ID: ${eventId}`);

  // Store event for deduplication and debugging
  console.log(`[Webhook] 💾 Storing event in jobber_webhook_events...`);
  const { error: eventError } = await supabase
    .from("jobber_webhook_events")
    .insert({
      event_id: eventId,
      topic: payload.webHookEvent,
      payload: payload,
      headers: headersObj,
      raw_body: truncate(rawBody, 20000),
    });

  if (eventError?.code === '23505') {
    console.log(`[Webhook] ⚠️ Duplicate event detected - skipping`);
    return new Response(
      JSON.stringify({ received: true, duplicate: true, eventId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } else if (eventError) {
    console.log(`[Webhook] ⚠️ Event storage error (continuing): ${eventError.message}`);
  } else {
    console.log(`[Webhook] ✅ Event stored`);
  }

  let processingError: string | null = null;
  let result: { action: string; inserted?: number; errors?: number } = { action: 'none' };

  try {
    console.log(`[Webhook] 🔄 Processing event: ${payload.webHookEvent}`);
    
    switch (payload.webHookEvent) {
      case "VISIT_SCHEDULED":
      case "VISIT_RESCHEDULED":
      case "VISIT_UPDATED": {
        console.log(`[Webhook] 📅 Visit schedule event - fetching details...`);
        const visit = await fetchVisitDetails(payload.itemId);
        
        if (visit) {
          const upsertResult = await upsertBusyBlock(supabase, visit);
          result = { action: 'upsert', ...upsertResult };
          console.log(`[Webhook] ✅ Upserted: ${upsertResult.inserted} blocks, ${upsertResult.errors} errors`);
        } else {
          console.log(`[Webhook] ⚠️ Could not fetch visit details - no blocks updated`);
          result = { action: 'fetch_failed' };
        }
        
        if (payload.data?.startAt || payload.data?.endAt) {
          console.log(`[Webhook] 📝 Updating bookings table...`);
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
        console.log(`[Webhook] ✅ Visit completed - updating status`);
        const { error, count } = await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq("jobber_visit_id", payload.itemId);
        
        result = { action: 'complete', inserted: count || 0 };
        
        if (error) {
          console.error(`[Webhook] ❌ Update failed:`, error.message);
        } else {
          console.log(`[Webhook] ✅ Marked ${count} block(s) as completed`);
        }
        
        await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_visit_id", payload.itemId);
        break;
      }

      case "VISIT_CANCELLED":
      case "VISIT_DELETED": {
        console.log(`[Webhook] 🗑️ Visit cancelled/deleted`);
        await markBusyBlockCancelled(supabase, payload.itemId);
        result = { action: 'cancel' };
        
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_visit_id", payload.itemId);
        break;
      }

      case "JOB_CREATED":
      case "JOB_UPDATED": {
        console.log(`[Webhook] 📋 Job event - updating bookings`);
        await supabase
          .from("bookings")
          .update({ updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);
        result = { action: 'job_update' };
        break;
      }

      case "JOB_COMPLETED": {
        console.log(`[Webhook] ✅ Job completed - marking all visits complete`);
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);
        
        await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_job_id", payload.itemId);
        result = { action: 'job_complete' };
        break;
      }

      case "JOB_CANCELLED": {
        console.log(`[Webhook] 🗑️ Job cancelled - marking all visits cancelled`);
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq("jobber_job_id", payload.itemId);
        
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_job_id", payload.itemId);
        result = { action: 'job_cancel' };
        break;
      }

      default:
        console.log(`[Webhook] ⚠️ Unhandled event type: ${payload.webHookEvent}`);
        result = { action: 'unhandled' };
    }

    console.log(`[Webhook] 📝 Marking event as processed...`);
    await supabase
      .from("jobber_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("event_id", eventId);

  } catch (error) {
    console.error(`[Webhook] ❌ Processing error:`, error);
    processingError = error instanceof Error ? error.message : String(error);
    
    await supabase
      .from("jobber_webhook_events")
      .update({ 
        processed_at: new Date().toISOString(),
        processing_error: processingError 
      })
      .eq("event_id", eventId);
  }

  console.log(`[Webhook] ═══════════════════════════════════════`);
  console.log(`[Webhook] 🏁 Complete: ${result.action}${processingError ? ' (with error)' : ''}`);
  console.log(`[Webhook] ═══════════════════════════════════════\n`);

  return new Response(
    JSON.stringify({ 
      received: true, 
      eventId,
      result,
      error: processingError 
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
