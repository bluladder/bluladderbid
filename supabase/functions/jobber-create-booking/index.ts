import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emitCampaignEvent } from "../_shared/campaignEmitter.ts";
import { jobberGraphQL } from "../_shared/jobberClient.ts";
import { rateLimit } from "../_shared/rateLimit.ts";
import { getBearer, isServiceRoleToken } from "../_shared/auth.ts";
import { getMirrorFreshness } from "../_shared/scheduleFreshness.ts";
import { calculateQuote, type QuoteInput } from "../_shared/pricingEngine.ts";
import { loadPricing } from "../_shared/loadPricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Configuration for local mirror staleness threshold
const MIRROR_STALE_THRESHOLD_MINUTES = 30;

interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  preset?: string;
}

interface BookingRequest {
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    address?: string;
  };
  technicianId: string;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  services: Array<{
    name: string;
    price: number;
    description?: string;
  }>;
  homeDetails: Record<string, unknown>;
  additionalServices?: Record<string, unknown>;
  /** Explicit promotion selection (e.g. the $99 window offer). */
  promotion?: { id: string; windowCount: number } | null;
  subtotal: number;
  discountAmount?: number;
  total: number;
  discountCode?: string;
  notes?: string;
  utmParams?: UtmParams;
  // Team booking fields
  isTeamJob?: boolean;
  teamTechnicianIds?: string[];
  // Concurrency / retry safety
  idempotencyKey?: string;
  sessionId?: string;
}

// Simple address parser - extracts components from a single-line address
function parseAddress(address: string): {
  street1: string;
  city: string;
  province: string;
  postalCode: string;
} {
  if (!address) {
    return { street1: "", city: "", province: "", postalCode: "" };
  }
  
  // Try to parse "123 Main St, City, ST 12345" format
  const parts = address.split(",").map(p => p.trim());
  
  if (parts.length >= 3) {
    // "123 Main St", "City", "ST 12345"
    const street1 = parts[0];
    const city = parts[1];
    const stateZip = parts[2].split(" ").filter(Boolean);
    const province = stateZip[0] || "";
    const postalCode = stateZip.slice(1).join(" ") || "";
    
    return { street1, city, province, postalCode };
  } else if (parts.length === 2) {
    // "123 Main St", "City ST 12345"
    const street1 = parts[0];
    const cityStateZip = parts[1].split(" ").filter(Boolean);
    const postalCode = cityStateZip.pop() || "";
    const province = cityStateZip.pop() || "";
    const city = cityStateZip.join(" ");
    
    return { street1, city, province, postalCode };
  }
  
  // Fallback - use whole address as street
  return { street1: address, city: "", province: "", postalCode: "" };
}

// Busy block type from database
interface BusyBlock {
  start_at: string;
  end_at: string;
  updated_at: string;
  crew_id: string;
  status: string;
}

// Check for conflicts using local busy_blocks mirror
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkLocalMirrorConflicts(
  supabase: any,
  jobberUserId: string,
  requestedStart: Date,
  requestedEnd: Date
): Promise<{ hasConflict: boolean; conflictingBlock?: { start_at: string; end_at: string }; mirrorStale: boolean; noData: boolean }> {
  
  // Get ACTIVE blocks that overlap the requested appointment window.
  // This must be overlap-based instead of filtering by start date, otherwise a
  // block that starts before the day/window but runs into it could be missed.
  const { data: blocks, error } = await supabase
    .from("jobber_busy_blocks")
    .select("start_at, end_at, updated_at, crew_id, status")
    .eq("crew_id", jobberUserId)
    .lt("start_at", requestedEnd.toISOString())
    .gt("end_at", requestedStart.toISOString())
    .in("status", ["scheduled", "in_progress"]);
  
  if (error) {
    console.error("Error querying busy_blocks:", error);
    return { hasConflict: false, mirrorStale: true, noData: true };
  }
  
  // Cast blocks to proper type
  const typedBlocks = (blocks || []) as BusyBlock[];
  
  console.log(`[LocalConflictCheck] Found ${typedBlocks.length} active overlapping blocks for tech ${jobberUserId} during ${requestedStart.toISOString()} - ${requestedEnd.toISOString()}`);
  
  // Check autosync coverage to determine if mirror is populated for this date
  const { data: autosyncConfig } = await supabase
    .from("autosync_config")
    .select("earliest_coverage_date, latest_coverage_date, updated_at")
    .eq("id", "default")
    .maybeSingle();
  
  // Determine if we have coverage for this date
  const requestedDate = requestedStart.toISOString().split('T')[0];
  const hasCoverage = autosyncConfig?.earliest_coverage_date && autosyncConfig?.latest_coverage_date &&
    requestedDate >= autosyncConfig.earliest_coverage_date &&
    requestedDate <= autosyncConfig.latest_coverage_date;
  
  if (!hasCoverage) {
    console.log(`[LocalConflictCheck] No mirror coverage for ${requestedDate} (coverage: ${autosyncConfig?.earliest_coverage_date} to ${autosyncConfig?.latest_coverage_date})`);
    return { hasConflict: false, mirrorStale: true, noData: true };
  }
  
  // Authoritative freshness: only trust the mirror when the last FULL sweep
  // completed cleanly and no sync is currently running. Otherwise force the
  // Jobber fallback (which fails closed on error).
  const freshness = await getMirrorFreshness(supabase, MIRROR_STALE_THRESHOLD_MINUTES);
  const mirrorStale = !freshness.ok;
  if (mirrorStale) {
    console.log(`[LocalConflictCheck] Mirror not fresh (reason=${freshness.reason}) — will fall back to Jobber`);
  }
  
  // Check for overlaps: (newStart < existingEnd) AND (newEnd > existingStart)
  for (const block of typedBlocks) {
    const blockStart = new Date(block.start_at);
    const blockEnd = new Date(block.end_at);
    
    const hasOverlap = requestedStart < blockEnd && requestedEnd > blockStart;
    
    if (hasOverlap) {
      console.log(`[LocalConflictCheck] CONFLICT DETECTED: ${requestedStart.toISOString()} - ${requestedEnd.toISOString()} overlaps with block ${block.start_at} - ${block.end_at} (status: ${block.status})`);
      return { 
        hasConflict: true, 
        conflictingBlock: { start_at: block.start_at, end_at: block.end_at },
        mirrorStale,
        noData: false,
      };
    }
  }
  
  // No conflicts found in local mirror
  // If no active blocks exist but we have coverage, treat as no conflict
  console.log(`[LocalConflictCheck] No conflicts found in local mirror (${typedBlocks.length} active blocks checked)`);
  return { hasConflict: false, mirrorStale, noData: false };
}

// Fallback: Check conflicts via Jobber API with narrow window
async function checkJobberConflicts(
  jobberUserId: string,
  requestedStart: Date,
  requestedEnd: Date,
  technicianName: string
): Promise<{ hasConflict: boolean; conflictingVisit?: { startAt: string; endAt: string }; throttled: boolean; error: boolean }> {
  
  // Narrow window: ±6 hours around requested time
  const rangeAfter = new Date(requestedStart.getTime() - 6 * 60 * 60 * 1000);
  const rangeBefore = new Date(requestedEnd.getTime() + 6 * 60 * 60 * 1000);
  
  // Minimal query - only needed fields, smaller page size
  const conflictCheckQuery = `
    query CheckConflicts($after: ISO8601DateTime!, $before: ISO8601DateTime!) {
      visits(first: 50, filter: { startAt: { after: $after, before: $before } }) {
        nodes {
          id
          startAt
          endAt
          assignedUsers(first: 10) {
            nodes { id }
          }
        }
      }
    }
  `;
  
  const conflictResult = await jobberGraphQL<{
    visits: {
      nodes: Array<{
        id: string;
        startAt: string;
        endAt: string;
        assignedUsers?: { nodes: Array<{ id: string }> };
      }>;
    };
  }>(conflictCheckQuery, {
    after: rangeAfter.toISOString(),
    before: rangeBefore.toISOString(),
  });
  
  console.log("Jobber conflict check result:", JSON.stringify(conflictResult));
  
  // Check if throttled
  if (conflictResult.throttled) {
    console.error("Jobber conflict check was throttled");
    return { hasConflict: false, throttled: true, error: false };
  }
  
  if (conflictResult.errors?.length) {
    console.error("Conflict validation failed (Jobber errors):", conflictResult.errors);
    // FAIL CLOSED: a failed conflict query must NOT be interpreted as
    // "no conflict". Signal an error so the caller stops the booking (503).
    return { hasConflict: false, throttled: false, error: true };
  }

  // Malformed / unexpected shape: we cannot positively verify availability.
  if (!conflictResult.data?.visits?.nodes) {
    console.error("Conflict validation returned malformed/incomplete data");
    return { hasConflict: false, throttled: false, error: true };
  }

  {
    const existingVisits = conflictResult.data.visits.nodes
      .filter(v => (v.assignedUsers?.nodes ?? []).some(u => u.id === jobberUserId));
    
    for (const visit of existingVisits) {
      const existingStart = new Date(visit.startAt);
      const existingEnd = new Date(visit.endAt);
      
      const hasOverlap = requestedStart < existingEnd && requestedEnd > existingStart;
      
      if (hasOverlap) {
        console.log(`JOBBER CONFLICT DETECTED: ${requestedStart.toISOString()} - ${requestedEnd.toISOString()} overlaps with visit ${visit.id} (${visit.startAt} - ${visit.endAt})`);
        return {
          hasConflict: true,
          conflictingVisit: { startAt: visit.startAt, endAt: visit.endAt },
          throttled: false,
          error: false,
        };
      }
    }
  }
  
  return { hasConflict: false, throttled: false, error: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Booking is a public (unauthenticated) flow, but creating real Jobber jobs
  // is expensive and notifies customers. Throttle per-IP to prevent automated
  // fraudulent/bulk booking creation. Internal service-role calls are exempt.
  const callerToken = getBearer(req);
  if (!isServiceRoleToken(callerToken)) {
    const rl = rateLimit(req, { limit: 6, windowMs: 60_000 });
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many booking attempts. Please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" } },
      );
    }
  }

  try {
    console.log("=== Starting booking creation ===");
    
    const booking: BookingRequest = await req.json();
    console.log("Received booking request:", JSON.stringify({
      customerEmail: booking.customer?.email,
      technicianId: booking.technicianId,
      scheduledStart: booking.scheduledStart,
      servicesCount: booking.services?.length,
    }));

    // Validate required fields
    if (!booking.customer?.email || !booking.technicianId || !booking.scheduledStart) {
      console.error("Missing required fields:", {
        hasEmail: !!booking.customer?.email,
        hasTechId: !!booking.technicianId,
        hasStart: !!booking.scheduledStart,
      });
      return new Response(
        JSON.stringify({ error: "Missing required booking fields" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ========================================================================
    // AUTHORITATIVE SERVER-SIDE PRICING (never trust the client total).
    // When the structured selection is provided, recompute the whole quote with
    // the canonical engine, re-validate the discount, and reconcile against the
    // client-submitted total. On mismatch the SERVER values win.
    // ========================================================================
    let pricingSnapshot: {
      engineVersion: string | null;
      ruleVersion: number | null;
      inputSnapshot: unknown;
      lineItemSnapshot: unknown;
      discountSnapshot: unknown;
      promotionSnapshot?: unknown;
    } = {
      engineVersion: null,
      ruleVersion: null,
      inputSnapshot: booking.additionalServices
        ? { homeDetails: booking.homeDetails, additionalServices: booking.additionalServices }
        : null,
      lineItemSnapshot: booking.services,
      discountSnapshot: booking.discountCode
        ? { code: booking.discountCode, amount: booking.discountAmount || 0 }
        : null,
    };

    // Track promotion prep instructions so we can append them to Jobber notes.
    let promoPrepInstructions = "";
    if (booking.additionalServices || booking.promotion) {
      try {
        // Re-validate discount server-side (active / not expired / under max uses).
        let serverDiscount: QuoteInput["discount"] = null;
        if (booking.discountCode) {
          const code = String(booking.discountCode).toUpperCase().trim();
          if (/^[A-Z0-9]{3,20}$/.test(code)) {
            const { data: dc } = await supabase
              .from("discount_codes")
              .select("code, discount_type, discount_value, is_active, expires_at, usage_count, max_uses")
              .eq("code", code)
              .maybeSingle();
            const valid = dc && dc.is_active &&
              (!dc.expires_at || new Date(dc.expires_at) >= new Date()) &&
              (dc.max_uses === null || (dc.usage_count ?? 0) < dc.max_uses);
            if (valid) {
              serverDiscount = {
                type: dc.discount_type === "percentage" ? "percentage" : "fixed",
                value: Number(dc.discount_value),
                code: dc.code,
              };
            }
          }
        }

        const loaded = await loadPricing(supabase);
        if (loaded.ok && loaded.pricing) {
          const engineResult = calculateQuote(
            {
              homeDetails: booking.homeDetails as unknown as QuoteInput["homeDetails"],
              additionalServices: booking.additionalServices as unknown as QuoteInput["additionalServices"],
              discount: serverDiscount,
              promotion:
                booking.promotion && typeof booking.promotion.id === "string"
                  ? { id: booking.promotion.id, windowCount: Number(booking.promotion.windowCount) }
                  : null,
            },
            loaded.pricing,
            loaded.ruleVersion,
          );

          pricingSnapshot = {
            engineVersion: engineResult.engineVersion,
            ruleVersion: engineResult.ruleVersion,
            inputSnapshot: { homeDetails: booking.homeDetails, additionalServices: booking.additionalServices },
            lineItemSnapshot: engineResult.lineItems,
            discountSnapshot: engineResult.discount,
            // Preserve promotion id/version/terms in the booking snapshot.
            promotionSnapshot: engineResult.promotion,
          };

          if (engineResult.firm) {
            // Preserve the promotion's preparation requirement for the crew.
            if (engineResult.promotion?.prepInstructions) {
              promoPrepInstructions = engineResult.promotion.prepInstructions;
            }
            const serverTotal = engineResult.total;
            const clientTotal = Number(booking.total);
            // For promotions the Jobber line items MUST reconcile exactly with the
            // server result, so always rebuild from the engine when a promotion is
            // applied (in addition to the normal tamper/stale guard).
            const promoApplied = !!engineResult.promotion;
            if (promoApplied || Math.abs(serverTotal - clientTotal) > 1) {
              // Client total was tampered with or stale — trust the server.
              console.warn(
                `Pricing mismatch: client total ${clientTotal} vs server ${serverTotal}. Using server values.`,
              );
              booking.subtotal = engineResult.subtotal;
              booking.discountAmount = engineResult.discount?.amount ?? 0;
              booking.total = engineResult.total;
              // Rebuild Jobber line items from the authoritative engine result.
              booking.services = engineResult.lineItems.map((li) => ({
                name: li.label,
                price: li.amount,
                description:
                  li.jobberLineItem?.description ??
                  (li.adjustments.length > 0
                    ? li.adjustments.map((a) => a.label).join(", ")
                    : undefined),
              }));
            }
          } else {
            // Engine is reachable but could NOT produce a firm price for these
            // inputs (missing info / manual review). A booking must never be
            // silently confirmed at a client-supplied total in this case —
            // reject so a customer cannot craft inputs to lock in a wrong price.
            console.warn(
              `Engine returned non-firm status "${engineResult.status}" for booking; rejecting.`,
            );
            return new Response(
              JSON.stringify({
                error:
                  "This selection needs a customized quote. Our team will follow up to confirm pricing.",
                status: engineResult.status,
                missing: engineResult.missing,
              }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } else {
          console.error("Booking recompute skipped — pricing unavailable:", loaded.error);
        }
      } catch (e) {
        console.error("Server-side pricing reconciliation failed (non-fatal):", e);
      }
    }

    // Get technician's Jobber user ID (and team technicians if team booking)
    console.log("Looking up technician:", booking.technicianId);
    
    // For team bookings, get all team technician IDs
    const technicianIdsToFetch = booking.isTeamJob && booking.teamTechnicianIds 
      ? booking.teamTechnicianIds 
      : [booking.technicianId];
    
    const { data: technicians, error: techError } = await supabase
      .from("technicians")
      .select("id, jobber_user_id, name")
      .in("id", technicianIdsToFetch);

    if (techError || !technicians?.length) {
      console.error("Technician lookup failed:", techError);
      return new Response(
        JSON.stringify({ error: "Technician not found", details: techError?.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }
    
    // Primary technician (first one for display)
    const primaryTechnician = technicians[0];
    
    // All Jobber user IDs for assignment
    const allJobberUserIds = technicians.map(t => t.jobber_user_id);
    const technicianNames = technicians.map(t => t.name).join(" + ");
    
    console.log("Found technicians:", technicianNames);
    console.log("Jobber IDs:", allJobberUserIds);
    console.log("Is team job:", booking.isTeamJob || false);

    // === SLOT RESERVATION & IDEMPOTENCY (before any Jobber writes) ===
    // Atomically hold this crew's time so two customers can't race into the
    // same slot, and so retries with the same key don't create duplicate jobs.
    const requestedStart = new Date(booking.scheduledStart);
    const requestedEnd = new Date(booking.scheduledEnd);

    const idempotencyKey =
      (booking.idempotencyKey && String(booking.idempotencyKey).trim()) ||
      `${booking.customer.email.toLowerCase()}|${booking.scheduledStart}|${[...allJobberUserIds].sort().join(",")}`;

    let reservationGroupId: string | null = null;
    const releaseReservation = async () => {
      if (!reservationGroupId) return;
      try {
        await supabase.rpc("release_booking_slot", { p_group_id: reservationGroupId });
        console.log("Released slot reservation", reservationGroupId);
      } catch (e) {
        console.warn("Failed to release reservation:", e);
      }
    };

    const { data: reserveRes, error: reserveErr } = await supabase.rpc("reserve_booking_slot", {
      p_crew_ids: allJobberUserIds,
      p_start: requestedStart.toISOString(),
      p_end: requestedEnd.toISOString(),
      p_session: booking.sessionId || null,
      p_idempotency_key: idempotencyKey,
      p_ttl_minutes: 8,
    });

    if (reserveErr) {
      console.error("Reservation RPC failed:", reserveErr);
      return new Response(
        JSON.stringify({
          error: "Scheduling is busy",
          details: "We're unable to verify this appointment time right now. Please try again shortly.",
          code: "SCHEDULING_BUSY",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    // Idempotent replay: a prior identical request already fully succeeded.
    if (reserveRes?.idempotent && reserveRes?.result) {
      console.log("Idempotent replay — returning original booking result");
      return new Response(JSON.stringify(reserveRes.result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Slot already actively held/booked by someone else → conflict.
    if (reserveRes?.ok === false) {
      return new Response(
        JSON.stringify({
          error: "Time slot conflict",
          details:
            "This time slot was just reserved by another customer. Please select a different time.",
          code: "CONFLICT",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      );
    }

    reservationGroupId = reserveRes?.group_id ?? null;

    // If a previous attempt (same key) already created a Jobber job, reuse it so
    // retries never create a duplicate job.
    let existingJobId: string | null = null;
    if (reservationGroupId) {
      const { data: grp } = await supabase
        .from("slot_reservations")
        .select("jobber_job_id")
        .eq("group_id", reservationGroupId)
        .not("jobber_job_id", "is", null)
        .limit(1)
        .maybeSingle();
      existingJobId = grp?.jobber_job_id ?? null;
      if (existingJobId) console.log("Reusing existing Jobber job from prior attempt:", existingJobId);
    }

    // From here on the slot is held. Any failure/return must release the hold
    // (unless we deliberately keep it), so wrap the rest in try/finally.
    let reservationSettled = false;
    try {
    // Find or create customer in Supabase
    console.log("Looking up customer by email:", booking.customer.email.toLowerCase());
    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("email", booking.customer.email.toLowerCase())
      .maybeSingle();

    if (!customer) {
      console.log("Customer not found, creating new customer record");
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          email: booking.customer.email.toLowerCase(),
          first_name: booking.customer.firstName,
          last_name: booking.customer.lastName,
          phone: booking.customer.phone,
          address: booking.customer.address,
        })
        .select()
        .single();

      if (customerError) {
        console.error("Failed to create customer:", customerError);
        return new Response(
          JSON.stringify({ error: "Failed to create customer", details: customerError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
      customer = newCustomer;
      console.log("Created new customer:", customer.id);
    } else {
      console.log("Found existing customer:", customer.id);
    }

    // Find or create client in Jobber
    let jobberClientId = customer.jobber_client_id;
    console.log("Existing Jobber client ID:", jobberClientId);

    if (!jobberClientId) {
      // Search for existing client by email
      console.log("Searching for existing Jobber client by email");
      const searchQuery = `
        query FindClient($email: String!) {
          clients(searchTerm: $email, first: 1) {
            nodes {
              id
              emails {
                address
              }
            }
          }
        }
      `;

      const searchResult = await jobberGraphQL<{
        clients: {
          nodes: Array<{
            id: string;
            emails: Array<{ address: string }>;
          }>;
        };
      }>(searchQuery, { email: booking.customer.email });

      console.log("Jobber client search result:", JSON.stringify(searchResult));

      const existingClient = searchResult.data?.clients?.nodes?.[0];

      if (existingClient) {
        jobberClientId = existingClient.id;
        console.log("Found existing Jobber client:", jobberClientId);
      } else {
        // Create new client in Jobber
        console.log("Creating new Jobber client");
        const createClientMutation = `
          mutation CreateClient($input: ClientCreateInput!) {
            clientCreate(input: $input) {
              client {
                id
              }
              userErrors {
                message
                path
              }
            }
          }
        `;

        // Build phone array only if phone is provided
        const phoneInput = booking.customer.phone
          ? [{ number: booking.customer.phone, primary: true }]
          : undefined;

        const clientInput = {
          firstName: booking.customer.firstName,
          lastName: booking.customer.lastName,
          emails: [{ address: booking.customer.email, primary: true }],
          ...(phoneInput && { phones: phoneInput }),
        };
        
        console.log("Client creation input:", JSON.stringify(clientInput));

        const createResult = await jobberGraphQL<{
          clientCreate: {
            client: { id: string } | null;
            userErrors: Array<{ message: string; path?: string[] }>;
          };
        }>(createClientMutation, { input: clientInput });

        console.log("Jobber client creation result:", JSON.stringify(createResult));

        if (createResult.errors?.length) {
          console.error("Jobber GraphQL errors:", createResult.errors);
          return new Response(
            JSON.stringify({ error: "Jobber API error", details: createResult.errors.map(e => e.message).join(", ") }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
          );
        }

        if (createResult.data?.clientCreate?.userErrors?.length) {
          console.error("Jobber client creation errors:", createResult.data.clientCreate.userErrors);
        }

        jobberClientId = createResult.data?.clientCreate?.client?.id;
        console.log("Created Jobber client:", jobberClientId);
      }

      // Update customer with Jobber client ID
      if (jobberClientId) {
        console.log("Updating customer with Jobber client ID");
        await supabase
          .from("customers")
          .update({ jobber_client_id: jobberClientId })
          .eq("id", customer.id);
      }
    }

    if (!jobberClientId) {
      console.error("Failed to get or create Jobber client");
      return new Response(
        JSON.stringify({ error: "Failed to create or find Jobber client" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Get property for the client - use clientProperties (a connection type)
    console.log("Getting client properties:", jobberClientId);
    const getClientPropertyQuery = `
      query GetClientProperty($clientId: EncodedId!) {
        client(id: $clientId) {
          id
          clientProperties(first: 1) {
            nodes {
              id
            }
          }
        }
      }
    `;

    const propertyResult = await jobberGraphQL<{
      client: {
        id: string;
        clientProperties: { nodes: Array<{ id: string }> };
      };
    }>(getClientPropertyQuery, { clientId: jobberClientId });

    console.log("Client properties result:", JSON.stringify(propertyResult));

    let propertyId = propertyResult.data?.client?.clientProperties?.nodes?.[0]?.id;

    if (!propertyId) {
      // PropertyCreateInput requires a 'properties' array with PropertyInput objects
      console.log("No property found, creating one for client");
      const createPropertyMutation = `
        mutation CreateProperty($clientId: EncodedId!, $input: PropertyCreateInput!) {
          propertyCreate(clientId: $clientId, input: $input) {
            properties {
              id
            }
            userErrors {
              message
              path
            }
          }
        }
      `;

      // PropertyCreateInput.properties is a list of PropertyAttributes
      // PropertyAttributes requires address: AddressAttributes
      // Parse the address or use defaults
      const addressParts = parseAddress(booking.customer.address || "");
      
      const propertyInput = {
        properties: [
          {
            address: {
              street1: addressParts.street1 || "Service Address",
              city: addressParts.city || "Austin",
              province: addressParts.province || "TX",
              postalCode: addressParts.postalCode || "78701",
              country: "US"
            }
          }
        ]
      };
      
      console.log("Property creation input:", JSON.stringify(propertyInput));

      const createPropertyResult = await jobberGraphQL<{
        propertyCreate: {
          properties: Array<{ id: string }>;
          userErrors: Array<{ message: string; path?: string[] }>;
        };
      }>(createPropertyMutation, { clientId: jobberClientId, input: propertyInput });

      console.log("Property creation result:", JSON.stringify(createPropertyResult));

      // Check userErrors for hints about what went wrong
      if (createPropertyResult.data?.propertyCreate?.userErrors?.length) {
        console.error("Property creation user errors:", createPropertyResult.data.propertyCreate.userErrors);
      }

      propertyId = createPropertyResult.data?.propertyCreate?.properties?.[0]?.id;

      // If property creation failed and no property exists, try re-querying client
      // Sometimes property might have been created asynchronously
      if (!propertyId) {
        console.log("Property creation returned empty, re-querying client");
        const retryResult = await jobberGraphQL<{
          client: {
            id: string;
            properties: { id: string } | null;
          };
        }>(getClientPropertyQuery, { clientId: jobberClientId });
        
        console.log("Retry property query result:", JSON.stringify(retryResult));
        const retryProps = retryResult.data?.client?.properties;
        if (retryProps) {
          if (Array.isArray(retryProps)) {
            propertyId = (retryProps as Array<{ id: string }>)[0]?.id;
          } else {
            propertyId = retryProps.id;
          }
        }
      }

      if (!propertyId) {
        console.error("Failed to get or create property");
        return new Response(
          JSON.stringify({ error: "Failed to get or create property in Jobber" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    console.log("Using property ID:", propertyId);

    // === CONFLICT DETECTION ===
    // Step 1: Check local busy_blocks mirror first for ALL assigned technicians
    console.log("Checking for scheduling conflicts (local mirror first)...");
    // (requestedStart / requestedEnd were computed earlier for the slot hold.)

    // Check conflicts for all assigned technicians
    for (const tech of technicians) {
      const localCheck = await checkLocalMirrorConflicts(
        supabase,
        tech.jobber_user_id,
        requestedStart,
        requestedEnd
      );
      
      // If local mirror found a conflict, return immediately
      if (localCheck.hasConflict && localCheck.conflictingBlock) {
        const existingStartLocal = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(new Date(localCheck.conflictingBlock.start_at));
        
        return new Response(
          JSON.stringify({ 
            error: "Time slot conflict", 
            details: `This time slot is no longer available. ${tech.name} has another appointment at ${existingStartLocal}. Please select a different time.`,
            code: "CONFLICT",
            conflictingVisit: localCheck.conflictingBlock,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
        );
      }
      
      // Step 2: Fallback to Jobber API only if mirror has no data or is stale
      if (localCheck.noData || localCheck.mirrorStale) {
        console.log(`Falling back to Jobber API for conflict check for ${tech.name} (noData: ${localCheck.noData}, stale: ${localCheck.mirrorStale})`);
        
        const jobberCheck = await checkJobberConflicts(
          tech.jobber_user_id,
          requestedStart,
          requestedEnd,
          tech.name
        );
        
        // Fail-soft: If Jobber is throttled, return 503 with friendly message
        if (jobberCheck.throttled) {
          return new Response(
            JSON.stringify({
              error: "Scheduling is busy",
              details: "Our scheduling system is currently busy. Please try again in 1-2 minutes.",
              code: "SCHEDULING_BUSY",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
          );
        }

        // FAIL CLOSED: if the conflict query errored or returned malformed data
        // we cannot positively verify the slot is free — stop the booking.
        if (jobberCheck.error) {
          console.error(`Conflict verification failed for ${tech.name} — refusing to book (fail closed)`);
          return new Response(
            JSON.stringify({
              error: "Unable to verify availability",
              details:
                "We're unable to verify this appointment time right now. Please select another time later or request that our team contact you.",
              code: "VERIFY_UNAVAILABLE",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
          );
        }

        if (jobberCheck.hasConflict && jobberCheck.conflictingVisit) {
          const existingStartLocal = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }).format(new Date(jobberCheck.conflictingVisit.startAt));
          
          return new Response(
            JSON.stringify({ 
              error: "Time slot conflict", 
              details: `This time slot is no longer available. ${tech.name} has another appointment at ${existingStartLocal}. Please select a different time.`,
              code: "CONFLICT",
              conflictingVisit: jobberCheck.conflictingVisit,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
          );
        }
      }
    }
    
    console.log("No conflicts detected, proceeding with booking");

    // Build notes for the job
    // Only include customer's special instructions in Jobber job notes
    // The detailed home info, services, and pricing are tracked in our local booking record
    // Promotion preparation requirements (e.g. "remove screens before arrival")
    // must travel with the job so the crew and customer both see them.
    const jobInstructions = [
      promoPrepInstructions ? `PREP REQUIRED: ${promoPrepInstructions}` : "",
      booking.notes?.trim() || "",
    ]
      .filter(Boolean)
      .join("\n\n");

    // Create job in Jobber using JobCreateAttributes
    console.log("Creating job in Jobber");
    
    const createJobMutation = `
      mutation CreateJob($input: JobCreateAttributes!) {
        jobCreate(input: $input) {
          job {
            id
            jobNumber
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const lineItems = booking.services.map(svc => ({
      name: svc.name,
      description: svc.description || "",
      unitPrice: svc.price,
      quantity: 1,
      saveToProductsAndServices: false,
    }));

    // Add discount as negative line item if applicable
    if (booking.discountAmount && booking.discountAmount > 0) {
      lineItems.push({
        name: `Discount${booking.discountCode ? ` (${booking.discountCode})` : ""}`,
        description: "Promotional discount",
        unitPrice: -booking.discountAmount,
        quantity: 1,
        saveToProductsAndServices: false,
      });
    }

    // JobCreateAttributes requires propertyId, invoicing, and optional fields
    const jobInput = {
      propertyId: propertyId,
      title: `BluLadder Services - ${booking.customer.firstName} ${booking.customer.lastName}`,
      instructions: jobInstructions,
      lineItems,
      invoicing: {
        invoicingType: "VISIT_BASED",
        invoicingSchedule: "ON_COMPLETION",
      },
      scheduling: {
        createVisits: false,
        notifyTeam: false,
        assignedTo: allJobberUserIds,
      },
    };
    
    console.log("Job creation input:", JSON.stringify({ 
      propertyId: propertyId, 
      title: jobInput.title,
      lineItemsCount: lineItems.length,
      invoicing: jobInput.invoicing,
    }));

    let jobberJobId: string | null = existingJobId;
    let jobNumber: number | null = null;

    if (existingJobId) {
      // Idempotent retry: the job was created on a previous attempt. Skip job
      // creation and go straight to (re)creating the visit.
      console.log("Skipping job creation — reusing job from prior attempt:", existingJobId);
    } else {
      const jobResult = await jobberGraphQL<{
        jobCreate: {
          job: { id: string; jobNumber: number } | null;
          userErrors: Array<{ message: string; path?: string[] }>;
        };
      }>(createJobMutation, { input: jobInput });

      console.log("Job creation result:", JSON.stringify(jobResult));

      if (jobResult.errors?.length) {
        console.error("Jobber job GraphQL errors:", jobResult.errors);
        return new Response(
          JSON.stringify({ error: "Failed to create job in Jobber", details: jobResult.errors.map(e => e.message).join(", ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      if (jobResult.data?.jobCreate?.userErrors?.length) {
        console.error("Jobber job creation errors:", jobResult.data.jobCreate.userErrors);
        return new Response(
          JSON.stringify({ error: "Failed to create job in Jobber", details: jobResult.data.jobCreate.userErrors.map(e => e.message).join(", ") }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      jobberJobId = jobResult.data?.jobCreate?.job?.id ?? null;
      jobNumber = jobResult.data?.jobCreate?.job?.jobNumber ?? null;

      if (!jobberJobId) {
        console.error("No job ID returned from Jobber");
        return new Response(
          JSON.stringify({ error: "Failed to get job ID from Jobber" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      // Persist the job id against the reservation so a later retry reuses it
      // instead of creating a duplicate Jobber job.
      if (reservationGroupId) {
        try {
          await supabase.rpc("set_reservation_job", { p_group_id: reservationGroupId, p_job_id: jobberJobId });
        } catch (e) {
          console.warn("Failed to persist job id to reservation:", e);
        }
      }

      console.log("Created job:", jobberJobId, "Job number:", jobNumber);
    }

    // Schedule a visit for the job using VisitCreateInput
    // VisitCreateInput requires a 'visits' array, and response has 'createdVisits'
    console.log("Creating visit for job");
    const scheduleVisitMutation = `
      mutation ScheduleVisit($jobId: EncodedId!, $input: VisitCreateInput!) {
        visitCreate(jobId: $jobId, input: $input) {
          createdVisits {
            id
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    // Parse the scheduled times into LocalDateTimeAttributes format
    // Jobber requires: { date: "YYYY-MM-DD", time: "HH:MM", timezone: "America/Chicago" }
    // CRITICAL: Use Intl.DateTimeFormat to convert UTC to Central time correctly
    const parseToLocalDateTime = (isoString: string) => {
      // If the incoming string has no timezone information, assume it's already local (America/Chicago)
      // and avoid accidentally treating it as UTC.
      const hasTz = /Z$|[+-]\d{2}:\d{2}$/.test(isoString);
      if (!hasTz && isoString.includes('T')) {
        const [datePart, timePartRaw] = isoString.split('T');
        const timePart = (timePartRaw || '').slice(0, 5);
        const localTime = timePart && /^\d{2}:\d{2}$/.test(timePart) ? timePart : '00:00';

        console.log(`Timezone conversion (no TZ provided; treating as local): ${isoString} -> date: ${datePart}, time: ${localTime} (America/Chicago)`);
        return {
          date: datePart,
          time: localTime,
          timezone: "America/Chicago",
        };
      }

      const date = new Date(isoString);
      
      // Use Intl.DateTimeFormat to get the correct local time in America/Chicago
      const dateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      
      // en-CA gives YYYY-MM-DD format
      const localDate = dateFormatter.format(date);
      
      // Extract HH:MM from the formatted time
      const timeParts = timeFormatter.formatToParts(date);
      const hour = timeParts.find(p => p.type === 'hour')?.value || '00';
      const minute = timeParts.find(p => p.type === 'minute')?.value || '00';
      const localTime = `${hour}:${minute}`;
      
      console.log(`Timezone conversion: ${isoString} -> date: ${localDate}, time: ${localTime} (America/Chicago)`);
      
      return {
        date: localDate,
        time: localTime,
        timezone: "America/Chicago"
      };
    };

    // VisitCreateInput.visits is an array of VisitCreateAttributes
    // VisitCreateAttributes has 'schedule' (ScheduledItemAttributes)
    // ScheduledItemAttributes has startAt/endAt as LocalDateTimeAttributes and teamMemberIdsToAssign
    const visitInput = {
      visits: [
        {
          schedule: {
            startAt: parseToLocalDateTime(booking.scheduledStart),
            endAt: parseToLocalDateTime(booking.scheduledEnd),
            teamMemberIdsToAssign: allJobberUserIds,
          },
        }
      ]
    };
    
    console.log("Visit creation input:", JSON.stringify({ jobId: jobberJobId, ...visitInput }));

    const visitResult = await jobberGraphQL<{
      visitCreate: {
        createdVisits: Array<{ id: string }> | null;
        userErrors: Array<{ message: string; path?: string[] }>;
      };
    }>(scheduleVisitMutation, { jobId: jobberJobId, input: visitInput });

    console.log("Visit creation result:", JSON.stringify(visitResult));

    const jobberVisitId = visitResult.data?.visitCreate?.createdVisits?.[0]?.id;

    if (visitResult.data?.visitCreate?.userErrors?.length) {
      console.error("Jobber visit creation errors:", visitResult.data.visitCreate.userErrors);
    }

    // Generate reference number
    const { data: refData } = await supabase.rpc("generate_booking_reference");
    const referenceNumber = refData || `BL-${Date.now()}`;
    console.log("Generated reference:", referenceNumber);

    // ===== FAIL SAFE: never confirm a booking without a Jobber visit =====
    // If the job was created but the visit was NOT, the appointment does not
    // actually exist on the calendar. Record it for manual recovery instead of
    // reporting success. The reservation is intentionally kept (not released) so
    // the slot stays protected while staff finish the visit.
    if (!jobberVisitId) {
      console.error("Visit creation failed — recording booking as needs_attention for recovery");
      const { data: naBooking } = await supabase
        .from("bookings")
        .insert({
          customer_id: customer.id,
          technician_id: booking.technicianId,
          jobber_job_id: jobberJobId,
          jobber_visit_id: null,
          reference_number: referenceNumber,
          status: "needs_attention",
          scheduled_start: booking.scheduledStart,
          scheduled_end: booking.scheduledEnd,
          duration_minutes: booking.durationMinutes,
          services_json: booking.services,
          home_details_json: booking.homeDetails,
          subtotal: booking.subtotal,
          discount_amount: booking.discountAmount || 0,
          total: booking.total,
          discount_code: booking.discountCode,
          notes: booking.notes,
          utm_params_json: booking.utmParams && Object.keys(booking.utmParams).length > 0 ? booking.utmParams : null,
          pricing_engine_version: pricingSnapshot.engineVersion,
          pricing_rule_version: pricingSnapshot.ruleVersion,
          input_snapshot: pricingSnapshot.inputSnapshot,
          line_item_snapshot: pricingSnapshot.lineItemSnapshot,
          discount_snapshot: pricingSnapshot.discountSnapshot,
        })
        .select()
        .maybeSingle();

      // Keep the reservation hold so the slot can't be double-booked during recovery.
      reservationSettled = true;
      return new Response(
        JSON.stringify({
          success: false,
          pendingManualConfirmation: true,
          code: "VISIT_CREATION_FAILED",
          referenceNumber,
          bookingId: naBooking?.id ?? null,
          error:
            "We couldn't fully confirm this appointment automatically. Our team has been notified and will confirm your time shortly — you don't need to rebook.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    }

    // Create booking record in Supabase (confirmed — visit exists)
    console.log("Creating booking record in Supabase");
    const { data: bookingRecord, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        customer_id: customer.id,
        technician_id: booking.technicianId,
        jobber_job_id: jobberJobId,
        jobber_visit_id: jobberVisitId,
        reference_number: referenceNumber,
        status: "scheduled",
        scheduled_start: booking.scheduledStart,
        scheduled_end: booking.scheduledEnd,
        duration_minutes: booking.durationMinutes,
        services_json: booking.services,
        home_details_json: booking.homeDetails,
        subtotal: booking.subtotal,
        discount_amount: booking.discountAmount || 0,
        total: booking.total,
        discount_code: booking.discountCode,
        notes: booking.notes,
        utm_params_json: booking.utmParams && Object.keys(booking.utmParams).length > 0 ? booking.utmParams : null,
        pricing_engine_version: pricingSnapshot.engineVersion,
        pricing_rule_version: pricingSnapshot.ruleVersion,
        input_snapshot: pricingSnapshot.inputSnapshot,
        line_item_snapshot: pricingSnapshot.lineItemSnapshot,
        discount_snapshot: pricingSnapshot.discountSnapshot,
      })
      .select()
      .single();

    if (bookingError) {
      console.error("Failed to create booking record:", bookingError);
      // Job + visit exist in Jobber but local record failed - log for reconciliation
    } else {
      console.log("Created booking record:", bookingRecord.id);
    }

    const successPayload = {
      success: true,
      referenceNumber,
      jobNumber,
      jobberJobId,
      jobberVisitId,
      scheduledStart: booking.scheduledStart,
      scheduledEnd: booking.scheduledEnd,
      technicianName: technicianNames,
      bookingId: bookingRecord?.id,
      isTeamJob: booking.isTeamJob || false,
      crewSize: technicians.length,
    };

    // Convert the temporary hold into a confirmed reservation and store the
    // result so any idempotent retry returns this exact outcome.
    if (reservationGroupId) {
      try {
        await supabase.rpc("confirm_booking_slot", {
          p_group_id: reservationGroupId,
          p_booking_id: bookingRecord?.id ?? null,
          p_job_id: jobberJobId,
          p_visit_id: jobberVisitId,
          p_result: successPayload,
        });
      } catch (e) {
        console.warn("Failed to confirm reservation:", e);
      }
    }
    reservationSettled = true;

    // Fire-and-forget appointment-confirmation SMS + campaign enrollment.
    if (bookingRecord?.id) {
      try {
        fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ eventType: "appointment_scheduled", bookingId: bookingRecord.id }),
        }).catch((e) => console.warn("Appointment SMS dispatch failed:", e));
      } catch (smsErr) {
        console.warn("Appointment SMS dispatch error:", smsErr);
      }
    }

    // booking_completed — emitted ONLY after a confirmed Jobber visit exists
    // (the needs_attention / visit-creation-failed paths above return earlier).
    // Idempotency is keyed on the booking id so retries never duplicate. This is
    // a STOP event for abandoned-quote nurture in the campaign engine.
    try {
      await emitCampaignEvent({
        eventName: "booking_completed",
        idempotencyKey: `booking_completed:${bookingRecord?.id ?? jobberVisitId}`,
        email: booking.customer?.email ?? null,
        phone: booking.customer?.phone ?? null,
        customerId: customer.id,
        source: "jobber-create-booking",
        subject: "One-time booking completed",
        metadata: {
          booking_status: "scheduled",
          booking_id: bookingRecord?.id ?? null,
          jobber_visit_id: jobberVisitId,
          service_types: Array.isArray(booking.services)
            ? booking.services.map((s: any) => s?.name ?? s?.service ?? s).filter(Boolean)
            : [],
        },
      });
    } catch (e) {
      console.warn("booking_completed emit failed:", e);
    }

    console.log("=== Booking creation completed successfully ===");

    return new Response(
      JSON.stringify(successPayload),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    } finally {
      // Release the hold on any failure path that didn't settle it.
      if (!reservationSettled) {
        await releaseReservation();
      }
    }

  } catch (error) {
    console.error("Booking creation error:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");
    return new Response(
      JSON.stringify({ 
        error: "Failed to create booking", 
        details: error instanceof Error ? error.message : String(error)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
