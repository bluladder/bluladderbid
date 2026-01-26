import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ServiceRequestPayload {
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    address?: string;
  };
  selectedPlan: {
    tier: string;
    name: string;
    label: string;
    monthlyPayment: number;
    annualTotal: number;
  };
  services: Array<{
    name: string;
    price: number;
    frequency?: string;
  }>;
  homeDetails: Record<string, unknown>;
  notes?: string;
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
  
  const parts = address.split(",").map(p => p.trim());
  
  if (parts.length >= 3) {
    const street1 = parts[0];
    const city = parts[1];
    const stateZip = parts[2].split(" ").filter(Boolean);
    const province = stateZip[0] || "";
    const postalCode = stateZip.slice(1).join(" ") || "";
    return { street1, city, province, postalCode };
  } else if (parts.length === 2) {
    const street1 = parts[0];
    const cityStateZip = parts[1].split(" ").filter(Boolean);
    const postalCode = cityStateZip.pop() || "";
    const province = cityStateZip.pop() || "";
    const city = cityStateZip.join(" ");
    return { street1, city, province, postalCode };
  }
  
  return { street1: address, city: "", province: "", postalCode: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== Starting recurring service request ===");
    
    const payload: ServiceRequestPayload = await req.json();
    console.log("Received service request:", JSON.stringify({
      customerEmail: payload.customer?.email,
      selectedPlan: payload.selectedPlan?.name,
    }));

    // Validate required fields
    if (!payload.customer?.email || !payload.selectedPlan) {
      console.error("Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find or create customer in Supabase
    console.log("Looking up customer by email:", payload.customer.email.toLowerCase());
    let { data: customer } = await supabase
      .from("customers")
      .select("*")
      .eq("email", payload.customer.email.toLowerCase())
      .maybeSingle();

    if (!customer) {
      console.log("Customer not found, creating new customer record");
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          email: payload.customer.email.toLowerCase(),
          first_name: payload.customer.firstName,
          last_name: payload.customer.lastName,
          phone: payload.customer.phone,
          address: payload.customer.address,
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
      }>(searchQuery, { email: payload.customer.email });

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

        const phoneInput = payload.customer.phone
          ? [{ number: payload.customer.phone, primary: true }]
          : undefined;

        const clientInput = {
          firstName: payload.customer.firstName,
          lastName: payload.customer.lastName,
          emails: [{ address: payload.customer.email, primary: true }],
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

    // Create property if address provided
    let propertyId: string | null = null;
    if (payload.customer.address) {
      console.log("Checking for existing property");
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

      propertyId = propertyResult.data?.client?.clientProperties?.nodes?.[0]?.id || null;

      if (!propertyId) {
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

        const addressParts = parseAddress(payload.customer.address);
        
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
        
        const createPropertyResult = await jobberGraphQL<{
          propertyCreate: {
            properties: Array<{ id: string }>;
            userErrors: Array<{ message: string; path?: string[] }>;
          };
        }>(createPropertyMutation, { clientId: jobberClientId, input: propertyInput });
        
        propertyId = createPropertyResult.data?.propertyCreate?.properties?.[0]?.id || null;
        console.log("Property created:", propertyId);
      } else {
        console.log("Using existing property:", propertyId);
      }
    }

    // Build line items for the quote with service details and frequencies
    const lineItems = payload.services.map(service => {
      const frequency = service.frequency || '1x per year';
      return {
        name: service.name,
        description: `${frequency} - Annual service as part of ${payload.selectedPlan.name} (${payload.selectedPlan.label}) plan`,
        quantity: 1,
        unitPrice: service.price,
      };
    });

    // Build quote message with home details and notes
    const homeDetailsLines = [
      `Home Details:`,
      `• Square Footage: ${(payload.homeDetails.squareFootage as number)?.toLocaleString() || 'N/A'} sq ft`,
      `• Stories: ${payload.homeDetails.stories || 1}`,
    ];
    
    if (payload.homeDetails.condition) {
      homeDetailsLines.push(`• Condition: ${payload.homeDetails.condition}`);
    }
    if (payload.homeDetails.drivewaySize) {
      homeDetailsLines.push(`• Driveway: ${payload.homeDetails.drivewaySize}`);
    }
    if (payload.homeDetails.drivewaySurface) {
      homeDetailsLines.push(`• Surface: ${payload.homeDetails.drivewaySurface}`);
    }

    const quoteMessage = [
      `${payload.selectedPlan.name} (${payload.selectedPlan.label}) - Annual Service Plan`,
      ``,
      `Monthly Payment: $${payload.selectedPlan.monthlyPayment}/month`,
      `Annual Total: $${payload.selectedPlan.annualTotal}/year`,
      ``,
      ...homeDetailsLines,
      payload.notes ? `\nCustomer Notes: ${payload.notes}` : null,
    ].filter(Boolean).join("\n");

    // Create quote in Jobber
    console.log("Creating quote in Jobber");
    const createQuoteMutation = `
      mutation CreateQuote($clientId: EncodedId!, $input: QuoteCreateInput!) {
        quoteCreate(clientId: $clientId, input: $input) {
          quote {
            id
            quoteNumber
            title
          }
          userErrors {
            message
            path
          }
        }
      }
    `;

    const quoteInput = {
      title: `${payload.selectedPlan.name} - Annual Service Plan`,
      message: quoteMessage,
      lineItems: lineItems,
      ...(propertyId && { propertyId }),
    };

    console.log("Quote creation input:", JSON.stringify(quoteInput));

    const quoteResult = await jobberGraphQL<{
      quoteCreate: {
        quote: { id: string; quoteNumber: number; title: string } | null;
        userErrors: Array<{ message: string; path?: string[] }>;
      };
    }>(createQuoteMutation, { clientId: jobberClientId, input: quoteInput });

    console.log("Quote creation result:", JSON.stringify(quoteResult));

    if (quoteResult.errors?.length) {
      console.error("Jobber quote GraphQL errors:", quoteResult.errors);
      return new Response(
        JSON.stringify({ error: "Failed to create quote in Jobber", details: quoteResult.errors.map(e => e.message).join(", ") }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (quoteResult.data?.quoteCreate?.userErrors?.length) {
      console.error("Jobber quote creation errors:", quoteResult.data.quoteCreate.userErrors);
      return new Response(
        JSON.stringify({ error: "Failed to create quote in Jobber", details: quoteResult.data.quoteCreate.userErrors.map(e => e.message).join(", ") }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const quoteId = quoteResult.data?.quoteCreate?.quote?.id;
    const quoteNumber = quoteResult.data?.quoteCreate?.quote?.quoteNumber;

    console.log("=== Service request completed successfully ===");
    console.log("Created quote:", quoteId, "Number:", quoteNumber);

    return new Response(
      JSON.stringify({
        success: true,
        quoteId,
        quoteNumber,
        customerId: customer.id,
        jobberClientId,
        message: "Service plan request submitted successfully",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Service request error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
