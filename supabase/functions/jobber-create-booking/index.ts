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
    const booking: BookingRequest = await req.json();

    // Validate required fields
    if (!booking.customer?.email || !booking.technicianId || !booking.scheduledStart) {
      return new Response(
        JSON.stringify({ error: "Missing required booking fields" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get technician's Jobber user ID
    const { data: technician, error: techError } = await supabase
      .from("technicians")
      .select("jobber_user_id, name")
      .eq("id", booking.technicianId)
      .single();

    if (techError || !technician) {
      return new Response(
        JSON.stringify({ error: "Technician not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Find or create customer in Supabase
    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("email", booking.customer.email.toLowerCase())
      .maybeSingle();

    if (!customer) {
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
        return new Response(
          JSON.stringify({ error: "Failed to create customer" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
      customer = newCustomer;
    }

    // Find or create client in Jobber
    let jobberClientId = customer.jobber_client_id;

    if (!jobberClientId) {
      // Search for existing client by email
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

      const existingClient = searchResult.data?.clients?.nodes?.[0];

      if (existingClient) {
        jobberClientId = existingClient.id;
      } else {
        // Create new client in Jobber
        const createClientMutation = `
          mutation CreateClient($input: ClientCreateInput!) {
            clientCreate(input: $input) {
              client {
                id
              }
              userErrors {
                message
              }
            }
          }
        `;

        const createResult = await jobberGraphQL<{
          clientCreate: {
            client: { id: string };
            userErrors: Array<{ message: string }>;
          };
        }>(createClientMutation, {
          input: {
            firstName: booking.customer.firstName,
            lastName: booking.customer.lastName,
            emails: [{ address: booking.customer.email, primary: true }],
            phones: booking.customer.phone
              ? [{ number: booking.customer.phone, primary: true }]
              : [],
          },
        });

        if (createResult.data?.clientCreate?.userErrors?.length) {
          console.error("Jobber client creation errors:", createResult.data.clientCreate.userErrors);
        }

        jobberClientId = createResult.data?.clientCreate?.client?.id;
      }

      // Update customer with Jobber client ID
      if (jobberClientId) {
        await supabase
          .from("customers")
          .update({ jobber_client_id: jobberClientId })
          .eq("id", customer.id);
      }
    }

    if (!jobberClientId) {
      return new Response(
        JSON.stringify({ error: "Failed to create or find Jobber client" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

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

    // Create job in Jobber
    const createJobMutation = `
      mutation CreateJob($input: JobCreateInput!) {
        jobCreate(input: $input) {
          job {
            id
            jobNumber
          }
          userErrors {
            message
          }
        }
      }
    `;

    const lineItems = booking.services.map(svc => ({
      name: svc.name,
      description: svc.description || "",
      unitPrice: svc.price,
      quantity: 1,
    }));

    // Add discount as negative line item if applicable
    if (booking.discountAmount && booking.discountAmount > 0) {
      lineItems.push({
        name: `Discount${booking.discountCode ? ` (${booking.discountCode})` : ""}`,
        description: "Promotional discount",
        unitPrice: -booking.discountAmount,
        quantity: 1,
      });
    }

    const jobResult = await jobberGraphQL<{
      jobCreate: {
        job: { id: string; jobNumber: number };
        userErrors: Array<{ message: string }>;
      };
    }>(createJobMutation, {
      input: {
        clientId: jobberClientId,
        title: `BluLadder Services - ${booking.customer.firstName} ${booking.customer.lastName}`,
        instructions: notesLines.join("\n"),
        lineItems,
      },
    });

    if (jobResult.data?.jobCreate?.userErrors?.length) {
      console.error("Jobber job creation errors:", jobResult.data.jobCreate.userErrors);
      return new Response(
        JSON.stringify({ error: "Failed to create job in Jobber" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const jobberJobId = jobResult.data?.jobCreate?.job?.id;
    const jobNumber = jobResult.data?.jobCreate?.job?.jobNumber;

    if (!jobberJobId) {
      return new Response(
        JSON.stringify({ error: "Failed to get job ID from Jobber" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Schedule a visit for the job
    const scheduleVisitMutation = `
      mutation ScheduleVisit($input: VisitCreateInput!) {
        visitCreate(input: $input) {
          visit {
            id
          }
          userErrors {
            message
          }
        }
      }
    `;

    const visitResult = await jobberGraphQL<{
      visitCreate: {
        visit: { id: string };
        userErrors: Array<{ message: string }>;
      };
    }>(scheduleVisitMutation, {
      input: {
        jobId: jobberJobId,
        startAt: booking.scheduledStart,
        endAt: booking.scheduledEnd,
        assignedUserIds: [technician.jobber_user_id],
      },
    });

    const jobberVisitId = visitResult.data?.visitCreate?.visit?.id;

    if (visitResult.data?.visitCreate?.userErrors?.length) {
      console.error("Jobber visit creation errors:", visitResult.data.visitCreate.userErrors);
    }

    // Generate reference number
    const { data: refData } = await supabase.rpc("generate_booking_reference");
    const referenceNumber = refData || `BL-${Date.now()}`;

    // Create booking record in Supabase
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
    }

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
    return new Response(
      JSON.stringify({ error: "Failed to create booking" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
