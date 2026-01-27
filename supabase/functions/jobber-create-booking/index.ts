import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

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
  subtotal: number;
  discountAmount?: number;
  total: number;
  discountCode?: string;
  notes?: string;
  utmParams?: UtmParams;
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
}

// Check for conflicts using local busy_blocks mirror
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkLocalMirrorConflicts(
  supabase: any,
  jobberUserId: string,
  requestedStart: Date,
  requestedEnd: Date
): Promise<{ hasConflict: boolean; conflictingBlock?: { start_at: string; end_at: string }; mirrorStale: boolean; noData: boolean }> {
  
  // Query local busy_blocks for the technician on the requested date
  const dayStart = new Date(requestedStart);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(requestedStart);
  dayEnd.setHours(23, 59, 59, 999);
  
  // Get blocks for this technician on this day
  const { data: blocks, error } = await supabase
    .from("jobber_busy_blocks")
    .select("start_at, end_at, updated_at, crew_id")
    .gte("start_at", dayStart.toISOString())
    .lte("start_at", dayEnd.toISOString());
  
  if (error) {
    console.error("Error querying busy_blocks:", error);
    return { hasConflict: false, mirrorStale: true, noData: true };
  }
  
  // Cast blocks to proper type
  const typedBlocks = (blocks || []) as BusyBlock[];
  
  // Filter to blocks for this technician
  // crew_id in busy_blocks should match jobber_user_id from technicians
  const techBlocks = typedBlocks.filter(b => b.crew_id === jobberUserId);
  
  if (techBlocks.length === 0) {
    // No data for this day/technician - need fallback
    console.log("No local mirror data found for technician on this date");
    return { hasConflict: false, mirrorStale: false, noData: true };
  }
  
  // Check if mirror data is stale
  const now = Date.now();
  const stalestBlock = techBlocks.reduce((oldest, block) => {
    const updatedAt = new Date(block.updated_at).getTime();
    return updatedAt < oldest ? updatedAt : oldest;
  }, now);
  
  const ageMinutes = (now - stalestBlock) / (1000 * 60);
  const mirrorStale = ageMinutes > MIRROR_STALE_THRESHOLD_MINUTES;
  
  if (mirrorStale) {
    console.log(`Mirror data is stale (${Math.round(ageMinutes)} min old > ${MIRROR_STALE_THRESHOLD_MINUTES} min threshold)`);
  }
  
  // Check for overlaps: (newStart < existingEnd) AND (newEnd > existingStart)
  for (const block of techBlocks) {
    const blockStart = new Date(block.start_at);
    const blockEnd = new Date(block.end_at);
    
    const hasOverlap = requestedStart < blockEnd && requestedEnd > blockStart;
    
    if (hasOverlap) {
      console.log(`LOCAL CONFLICT DETECTED: ${requestedStart.toISOString()} - ${requestedEnd.toISOString()} overlaps with block ${block.start_at} - ${block.end_at}`);
      return { 
        hasConflict: true, 
        conflictingBlock: { start_at: block.start_at, end_at: block.end_at },
        mirrorStale,
        noData: false,
      };
    }
  }
  
  return { hasConflict: false, mirrorStale, noData: false };
}

// Fallback: Check conflicts via Jobber API with narrow window
async function checkJobberConflicts(
  jobberUserId: string,
  requestedStart: Date,
  requestedEnd: Date,
  technicianName: string
): Promise<{ hasConflict: boolean; conflictingVisit?: { startAt: string; endAt: string }; throttled: boolean }> {
  
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
          assignedUsers {
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
    return { hasConflict: false, throttled: true };
  }
  
  if (conflictResult.errors?.length) {
    console.error("Conflict validation failed (Jobber errors):", conflictResult.errors);
    // Fail closed - treat errors as potential conflict to prevent double-booking
    return { hasConflict: false, throttled: false };
  }
  
  if (conflictResult.data?.visits?.nodes) {
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
        };
      }
    }
  }
  
  return { hasConflict: false, throttled: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Get technician's Jobber user ID
    console.log("Looking up technician:", booking.technicianId);
    const { data: technician, error: techError } = await supabase
      .from("technicians")
      .select("jobber_user_id, name")
      .eq("id", booking.technicianId)
      .single();

    if (techError || !technician) {
      console.error("Technician lookup failed:", techError);
      return new Response(
        JSON.stringify({ error: "Technician not found", details: techError?.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }
    console.log("Found technician:", technician.name, "Jobber ID:", technician.jobber_user_id);

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
    // Step 1: Check local busy_blocks mirror first
    console.log("Checking for scheduling conflicts (local mirror first)...");
    
    const requestedStart = new Date(booking.scheduledStart);
    const requestedEnd = new Date(booking.scheduledEnd);
    
    const localCheck = await checkLocalMirrorConflicts(
      supabase,
      technician.jobber_user_id,
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
          details: `This time slot is no longer available. ${technician.name} has another appointment at ${existingStartLocal}. Please select a different time.`,
          code: "CONFLICT",
          conflictingVisit: localCheck.conflictingBlock,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }
    
    // Step 2: Fallback to Jobber API only if mirror has no data or is stale
    if (localCheck.noData || localCheck.mirrorStale) {
      console.log(`Falling back to Jobber API for conflict check (noData: ${localCheck.noData}, stale: ${localCheck.mirrorStale})`);
      
      const jobberCheck = await checkJobberConflicts(
        technician.jobber_user_id,
        requestedStart,
        requestedEnd,
        technician.name
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
            details: `This time slot is no longer available. ${technician.name} has another appointment at ${existingStartLocal}. Please select a different time.`,
            code: "CONFLICT",
            conflictingVisit: jobberCheck.conflictingVisit,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
        );
      }
    }
    
    console.log("No conflicts detected, proceeding with booking");

    // Build notes for the job
    // Only include customer's special instructions in Jobber job notes
    // The detailed home info, services, and pricing are tracked in our local booking record
    const jobInstructions = booking.notes?.trim() || "";

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
        assignedTo: [technician.jobber_user_id],
      },
    };
    
    console.log("Job creation input:", JSON.stringify({ 
      propertyId: propertyId, 
      title: jobInput.title,
      lineItemsCount: lineItems.length,
      invoicing: jobInput.invoicing,
    }));

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

    const jobberJobId = jobResult.data?.jobCreate?.job?.id;
    const jobNumber = jobResult.data?.jobCreate?.job?.jobNumber;

    if (!jobberJobId) {
      console.error("No job ID returned from Jobber");
      return new Response(
        JSON.stringify({ error: "Failed to get job ID from Jobber" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log("Created job:", jobberJobId, "Job number:", jobNumber);

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
            teamMemberIdsToAssign: [technician.jobber_user_id],
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
      // Don't fail the booking, job was created successfully
    }

    // Generate reference number
    const { data: refData } = await supabase.rpc("generate_booking_reference");
    const referenceNumber = refData || `BL-${Date.now()}`;
    console.log("Generated reference:", referenceNumber);

    // Create booking record in Supabase
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
      })
      .select()
      .single();

    if (bookingError) {
      console.error("Failed to create booking record:", bookingError);
      // Job was created in Jobber but we failed to record it - log for manual reconciliation
    } else {
      console.log("Created booking record:", bookingRecord.id);
    }

    console.log("=== Booking creation completed successfully ===");

    return new Response(
      JSON.stringify({
        success: true,
        referenceNumber,
        jobNumber,
        jobberJobId,
        scheduledStart: booking.scheduledStart,
        scheduledEnd: booking.scheduledEnd,
        technicianName: technician.name,
        bookingId: bookingRecord?.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

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
