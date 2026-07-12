import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jobber-hmac-sha256",
};

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// Convert Headers to plain object for logging
function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

// Truncate string to max length
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `...[truncated, total ${str.length} chars]`;
}

// ========== PAYLOAD PARSING ==========
// Jobber sends payloads in nested format:
// { "data": { "webHookEvent": { "topic": "VISIT_UPDATE", "itemId": "...", "occurredAt": "..." } } }
// But we also support root-level format for compatibility

interface ParsedWebhookEvent {
  topic: string | null;
  itemId: string | null;
  occurredAt: string | null;
  appId: string | null;
  accountId: string | null;
  rawPayload: unknown;
}

function parseJobberPayload(payload: unknown): ParsedWebhookEvent {
  const p = payload as Record<string, unknown>;
  
  // Try nested structure first (Jobber's actual format)
  const nested = (p?.data as Record<string, unknown>)?.webHookEvent as Record<string, unknown> | undefined;
  
  // Extract fields with fallback chain
  const topic = nested?.topic ?? p?.webHookEvent ?? p?.topic ?? p?.event ?? p?.type ?? null;
  const itemId = nested?.itemId ?? p?.itemId ?? p?.id ?? null;
  const occurredAt = nested?.occurredAt ?? p?.occurredAt ?? p?.timestamp ?? null;
  const appId = nested?.appId ?? p?.appId ?? null;
  const accountId = nested?.accountId ?? p?.accountId ?? null;
  
  return {
    topic: topic as string | null,
    itemId: itemId as string | null,
    occurredAt: occurredAt as string | null,
    appId: appId as string | null,
    accountId: accountId as string | null,
    rawPayload: payload,
  };
}

// ========== TOPIC NORMALIZATION ==========
// Map Jobber's topic names to our internal event names
function normalizeJobberTopic(topic: string | null): string {
  if (!topic) return 'unknown';
  
  const topicMap: Record<string, string> = {
    // Jobber sends these
    'VISIT_UPDATE': 'VISIT_UPDATED',
    'VISIT_CREATE': 'VISIT_SCHEDULED',
    'VISIT_DESTROY': 'VISIT_DELETED',
    'VISIT_COMPLETE': 'VISIT_COMPLETED',
    'JOB_UPDATE': 'JOB_UPDATED',
    'JOB_CREATE': 'JOB_CREATED',
    'JOB_DESTROY': 'JOB_CANCELLED',
    'JOB_COMPLETE': 'JOB_COMPLETED',
    // Already normalized names (pass through)
    'VISIT_UPDATED': 'VISIT_UPDATED',
    'VISIT_SCHEDULED': 'VISIT_SCHEDULED',
    'VISIT_RESCHEDULED': 'VISIT_RESCHEDULED',
    'VISIT_DELETED': 'VISIT_DELETED',
    'VISIT_CANCELLED': 'VISIT_CANCELLED',
    'VISIT_COMPLETED': 'VISIT_COMPLETED',
    'JOB_UPDATED': 'JOB_UPDATED',
    'JOB_CREATED': 'JOB_CREATED',
    'JOB_CANCELLED': 'JOB_CANCELLED',
    'JOB_COMPLETED': 'JOB_COMPLETED',
  };
  
  return topicMap[topic] ?? topic;
}

// ========== HMAC VERIFICATION ==========
// Jobber sends x-jobber-hmac-sha256 header with HMAC-SHA256 of the raw body
async function verifyJobberHmac(rawBody: string, providedHmac: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(rawBody);
    
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const computedHmac = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    // Timing-safe comparison
    if (computedHmac.length !== providedHmac.length) return false;
    let result = 0;
    for (let i = 0; i < computedHmac.length; i++) {
      result |= computedHmac.charCodeAt(i) ^ providedHmac.charCodeAt(i);
    }
    return result === 0;
  } catch (e) {
    console.error(`[Webhook] ❌ HMAC verification error:`, e);
    return false;
  }
}

// Generate a STABLE event ID so redelivered webhooks dedupe against the unique
// event_id constraint. Prefer Jobber's occurredAt; only fall back to a
// timestamp when it is absent (keeps older behaviour for malformed payloads).
function generateEventId(topic: string, itemId: string | null, occurredAt: string | null): string {
  const stamp = occurredAt ? occurredAt : `t${Date.now()}`;
  return `${topic}-${itemId || 'no-item'}-${stamp}`;
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
        assignedUsers(first: 10) {
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
): Promise<{ inserted: number; errors: number; ghostsCancelled: number }> {
  const assignees = visit.assignedUsers?.nodes || [];
  let inserted = 0;
  let errors = 0;
  let ghostsCancelled = 0;
  const currentCrewIds = assignees.map((a) => a.id);
  
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
      .upsert(blockData, { onConflict: 'jobber_visit_id,crew_id' });

    if (error) {
      console.error(`[Webhook] ❌ Upsert failed for ${assignee.id}:`, error.message);
      errors++;
    } else {
      console.log(`[Webhook] ✅ Upserted block for ${assignee.id}`);
      inserted++;
    }
  }

  // ===== Ghost-appointment removal =====
  // Cancel any existing active blocks for THIS visit that belong to technicians
  // who are no longer assigned (reassignment) — otherwise the old crew keeps a
  // phantom calendar block. If the visit has no assignees at all, every block
  // for the visit is cancelled.
  {
    const { data: existing, error: fetchErr } = await supabase
      .from("jobber_busy_blocks")
      .select("id, crew_id")
      .eq("jobber_visit_id", visit.id)
      .in("status", ["scheduled", "in_progress"]);
    if (fetchErr) {
      console.error(`[Webhook] ❌ Ghost cleanup fetch failed:`, fetchErr.message);
    } else {
      const staleIds = (existing || [])
        .filter((b: { crew_id: string }) => !currentCrewIds.includes(b.crew_id))
        .map((b: { id: string }) => b.id);
      if (staleIds.length > 0) {
        const { error: cancelErr } = await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .in("id", staleIds);
        if (cancelErr) {
          console.error(`[Webhook] ❌ Ghost cleanup update failed:`, cancelErr.message);
        } else {
          ghostsCancelled = staleIds.length;
          console.log(`[Webhook] 👻 Cancelled ${staleIds.length} ghost assignment(s) for reassigned/updated visit ${visit.id}`);
        }
      }
    }
  }

  return { inserted, errors, ghostsCancelled };
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

  // NOTE: HMAC verification is ALWAYS enforced. The former JOBBER_WEBHOOK_DEBUG
  // and JOBBER_SKIP_HMAC bypass switches have been removed so no environment
  // value can disable signature verification in production.

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
    return new Response(
      JSON.stringify({ error: "Failed to read body" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  // Try to parse JSON
  let parsedJson: unknown = null;
  let parsedEvent: ParsedWebhookEvent = {
    topic: null,
    itemId: null,
    occurredAt: null,
    appId: null,
    accountId: null,
    rawPayload: null,
  };
  
  try {
    parsedJson = JSON.parse(rawBody);
    parsedEvent = parseJobberPayload(parsedJson);
    console.log(`[Webhook] ✅ JSON parsed successfully`);
    console.log(`[Webhook] 📦 Extracted: topic=${parsedEvent.topic} | itemId=${parsedEvent.itemId} | occurredAt=${parsedEvent.occurredAt}`);
  } catch (e) {
    console.log(`[Webhook] ⚠️ JSON parse failed (might be form data or other format)`);
  }

  // Normalize topic to our internal event names
  const normalizedTopic = normalizeJobberTopic(parsedEvent.topic);
  console.log(`[Webhook] 🏷️ Normalized topic: ${parsedEvent.topic} → ${normalizedTopic}`);

  // Initialize Supabase with service role for DB writes
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error(`[Webhook] ❌ Missing Supabase credentials`);
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ========== ALWAYS STORE EVENT FIRST (debug or production) ==========
  const eventId = generateEventId(normalizedTopic, parsedEvent.itemId, parsedEvent.occurredAt);
  console.log(`[Webhook] 🆔 Generated event ID: ${eventId}`);
  
  const { error: insertError } = await supabase
    .from("jobber_webhook_events")
    .insert({
      event_id: eventId,
      topic: normalizedTopic,
      received_at: receivedAt,
      headers: headersObj,
      raw_body: truncate(rawBody, 20000),
      payload: parsedJson,
    });

  if (insertError?.code === '23505') {
    console.log(`[Webhook] ⚠️ Duplicate event detected - already stored`);
  } else if (insertError) {
    console.error(`[Webhook] ❌ Failed to store event:`, insertError.message);
  } else {
    console.log(`[Webhook] ✅ Event stored: ${eventId}`);
  }

  // ======== HMAC verification + processing (always enforced) ========
  
  if (req.method !== "POST") {
    console.log(`[Webhook] ❌ Method not allowed: ${req.method}`);
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  // Verify Jobber HMAC signature (x-jobber-hmac-sha256). Always enforced.
  const webhookSecret = Deno.env.get("JOBBER_WEBHOOK_SECRET");
  const providedHmac = req.headers.get("x-jobber-hmac-sha256");

  console.log(`[Webhook] 🔐 HMAC verification:`);
  console.log(`[Webhook]    Secret configured: ${!!webhookSecret}`);
  console.log(`[Webhook]    HMAC header present: ${!!providedHmac}`);

  // Fail closed: without a configured secret we cannot verify authenticity.
  if (!webhookSecret) {
    console.error(`[Webhook] ❌ JOBBER_WEBHOOK_SECRET not configured - rejecting`);
    await supabase
      .from("jobber_webhook_events")
      .update({ processing_error: "Webhook secret not configured" })
      .eq("event_id", eventId);
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }

  // A signature header is mandatory. Omitting it must never bypass the check.
  if (!providedHmac) {
    console.log(`[Webhook] ❌ HMAC header missing - rejecting`);
    await supabase
      .from("jobber_webhook_events")
      .update({ processing_error: "Missing HMAC signature header" })
      .eq("event_id", eventId);
    return new Response(
      JSON.stringify({ error: "Unauthorized - missing signature" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }

  const isValid = await verifyJobberHmac(rawBody, providedHmac, webhookSecret);
  if (!isValid) {
    console.log(`[Webhook] ❌ HMAC verification failed - rejecting`);
    await supabase
      .from("jobber_webhook_events")
      .update({ processing_error: "HMAC verification failed" })
      .eq("event_id", eventId);
    return new Response(
      JSON.stringify({ error: "Unauthorized - invalid signature" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
    );
  }
  console.log(`[Webhook] ✅ HMAC verified`);

  // Validate we have the required fields
  if (!parsedEvent.topic || !parsedEvent.itemId) {
    console.log(`[Webhook] ❌ Missing required fields (topic: ${parsedEvent.topic}, itemId: ${parsedEvent.itemId})`);
    
    await supabase
      .from("jobber_webhook_events")
      .update({ processing_error: "Missing required fields (topic or itemId)" })
      .eq("event_id", eventId);
    
    return new Response(
      JSON.stringify({ error: "Missing required fields" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  console.log(`[Webhook] 📦 Processing event:`);
  console.log(`[Webhook]    Topic: ${normalizedTopic}`);
  console.log(`[Webhook]    Item ID: ${parsedEvent.itemId}`);

  let processingError: string | null = null;
  let result: { action: string; inserted?: number; errors?: number; ghostsCancelled?: number } = { action: 'none' };

  try {
    console.log(`[Webhook] 🔄 Processing: ${normalizedTopic}`);
    
    switch (normalizedTopic) {
      case "VISIT_SCHEDULED":
      case "VISIT_RESCHEDULED":
      case "VISIT_UPDATED": {
        console.log(`[Webhook] 📅 Visit schedule event - fetching details...`);
        const visit = await fetchVisitDetails(parsedEvent.itemId);
        
        if (visit) {
          const upsertResult = await upsertBusyBlock(supabase, visit);
          result = { action: 'upsert', ...upsertResult };
          console.log(`[Webhook] ✅ Upserted: ${upsertResult.inserted} blocks, ${upsertResult.errors} errors`);
        } else {
          console.log(`[Webhook] ⚠️ Could not fetch visit details - no blocks updated`);
          result = { action: 'fetch_failed' };
          processingError = "Failed to fetch visit details from Jobber";
        }
        break;
      }

      case "VISIT_COMPLETED": {
        console.log(`[Webhook] ✅ Visit completed - updating status`);
        const { error, count } = await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq("jobber_visit_id", parsedEvent.itemId);
        
        result = { action: 'complete', inserted: count || 0 };
        
        if (error) {
          console.error(`[Webhook] ❌ Update failed:`, error.message);
          processingError = error.message;
        } else {
          console.log(`[Webhook] ✅ Marked ${count} block(s) as completed`);
        }
        
        await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_visit_id", parsedEvent.itemId);
        break;
      }

      case "VISIT_CANCELLED":
      case "VISIT_DELETED": {
        console.log(`[Webhook] 🗑️ Visit cancelled/deleted`);
        await markBusyBlockCancelled(supabase, parsedEvent.itemId);
        result = { action: 'cancel' };
        
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_visit_id", parsedEvent.itemId);
        break;
      }

      case "JOB_CREATED":
      case "JOB_UPDATED": {
        console.log(`[Webhook] 📋 Job event - updating bookings`);
        await supabase
          .from("bookings")
          .update({ updated_at: new Date().toISOString() })
          .eq("jobber_job_id", parsedEvent.itemId);
        result = { action: 'job_update' };
        break;
      }

      case "JOB_COMPLETED": {
        console.log(`[Webhook] ✅ Job completed - marking all visits complete`);
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq("jobber_job_id", parsedEvent.itemId);
        
        await supabase
          .from("bookings")
          .update({ status: "completed" })
          .eq("jobber_job_id", parsedEvent.itemId);
        result = { action: 'job_complete' };
        break;
      }

      case "JOB_CANCELLED": {
        console.log(`[Webhook] 🗑️ Job cancelled - marking all visits cancelled`);
        await supabase
          .from("jobber_busy_blocks")
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq("jobber_job_id", parsedEvent.itemId);
        
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("jobber_job_id", parsedEvent.itemId);
        result = { action: 'job_cancel' };
        break;
      }

      default:
        console.log(`[Webhook] ⚠️ Unhandled event type: ${normalizedTopic}`);
        result = { action: 'unhandled' };
    }
  } catch (error) {
    processingError = error instanceof Error ? error.message : String(error);
    console.error(`[Webhook] ❌ Processing error:`, processingError);
    result = { action: 'error' };
  }

  // Update event with processing result
  await supabase
    .from("jobber_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_error: processingError,
    })
    .eq("event_id", eventId);

  console.log(`[Webhook] 📝 SUMMARY: topic=${normalizedTopic} | itemId=${parsedEvent.itemId} | action=${result.action}`);
  console.log(`[Webhook] ═══════════════════════════════════════\n`);

  return new Response(
    JSON.stringify({
      received: true,
      eventId,
      topic: normalizedTopic,
      itemId: parsedEvent.itemId,
      result,
      processingError,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
