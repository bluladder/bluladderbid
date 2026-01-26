import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Get or create property for the client
    console.log("Getting property for client:", jobberClientId);
    const getClientPropertyQuery = `
      query GetClientProperty($clientId: EncodedId!) {
        client(id: $clientId) {
          id
          properties(first: 1) {
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
        properties: {
          nodes: Array<{ id: string }>;
        };
      };
    }>(getClientPropertyQuery, { clientId: jobberClientId });

    console.log("Client properties result:", JSON.stringify(propertyResult));

    let propertyId = propertyResult.data?.client?.properties?.nodes?.[0]?.id;

    if (!propertyId) {
      // Create a property for the client
      console.log("Creating property for client");
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

      const propertyInput = {
        address: {
          street: booking.customer.address || "Address TBD",
          city: "",
          province: "",
          postalCode: "",
          country: "US",
        },
      };

      const createPropertyResult = await jobberGraphQL<{
        propertyCreate: {
          property: { id: string } | null;
          userErrors: Array<{ message: string; path?: string[] }>;
        };
      }>(createPropertyMutation, { clientId: jobberClientId, input: propertyInput });

      console.log("Property creation result:", JSON.stringify(createPropertyResult));

      propertyId = createPropertyResult.data?.propertyCreate?.property?.id;

      if (!propertyId) {
        console.error("Failed to create property:", createPropertyResult);
        return new Response(
          JSON.stringify({ error: "Failed to create property in Jobber" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    console.log("Using property ID:", propertyId);

    // Build notes for the job
    const notesLines = [
      "--- BluLadder Online Booking ---",
      "",
      "Home Details:",
      JSON.stringify(booking.homeDetails, null, 2),
      "",
      "Services:",
      ...booking.services.map(s => `- ${s.name}: $${s.price.toFixed(2)}`),
      "",
      `Subtotal: $${booking.subtotal.toFixed(2)}`,
    ];

    if (booking.discountCode && booking.discountAmount) {
      notesLines.push(`Discount (${booking.discountCode}): -$${booking.discountAmount.toFixed(2)}`);
    }
    notesLines.push(`Total: $${booking.total.toFixed(2)}`);

    if (booking.notes) {
      notesLines.push("", "Customer Notes:", booking.notes);
    }

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
      instructions: notesLines.join("\n"),
      lineItems,
      invoicing: {
        invoicingType: "PER_VISIT",
        invoicingSchedule: "AFTER_COMPLETION",
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
    console.log("Creating visit for job");
    const scheduleVisitMutation = `
      mutation ScheduleVisit($jobId: EncodedId!, $input: VisitCreateInput!) {
        visitCreate(jobId: $jobId, input: $input) {
          visit {
            id
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const visitInput = {
      startAt: booking.scheduledStart,
      endAt: booking.scheduledEnd,
      assignedUserIds: [technician.jobber_user_id],
    };
    
    console.log("Visit creation input:", JSON.stringify({ jobId: jobberJobId, ...visitInput }));

    const visitResult = await jobberGraphQL<{
      visitCreate: {
        visit: { id: string } | null;
        userErrors: Array<{ message: string; path?: string[] }>;
      };
    }>(scheduleVisitMutation, { jobId: jobberJobId, input: visitInput });

    console.log("Visit creation result:", JSON.stringify(visitResult));

    const jobberVisitId = visitResult.data?.visitCreate?.visit?.id;

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
