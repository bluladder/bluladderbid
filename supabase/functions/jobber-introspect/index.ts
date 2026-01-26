import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get PropertyCreateInput and find its nested types
    const propertyInputQuery = `
      query GetAllPropertyTypes {
        propertyCreateInput: __type(name: "PropertyCreateInput") {
          name
          kind
          inputFields {
            name
            type {
              name
              kind
              ofType {
                name
                kind
                ofType {
                  name
                  kind
                  inputFields {
                    name
                    type {
                      name
                      kind
                      ofType { name kind }
                    }
                  }
                }
              }
            }
          }
        }
        addressAttributes: __type(name: "AddressAttributes") {
          name
          kind
          inputFields {
            name
            type {
              name
              kind
              ofType { name kind }
            }
          }
        }
      }
    `;
    
    const propertyInputResult = await jobberGraphQL<unknown>(propertyInputQuery, {});
    
    // Get the propertyCreate mutation signature
    const mutationQuery = `
      query GetPropertyCreateMutation {
        __schema {
          mutationType {
            fields(includeDeprecated: true) {
              name
              args {
                name
                type {
                  name
                  kind
                  ofType {
                    name
                    kind
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const mutationResult = await jobberGraphQL<unknown>(mutationQuery, {});
    
    // Filter for propertyCreate
    const allMutations = (mutationResult.data as any)?.__schema?.mutationType?.fields || [];
    const propertyMutations = allMutations.filter((f: any) => 
      f.name?.toLowerCase().includes('property')
    );

    return new Response(
      JSON.stringify({ 
        propertyCreateInput: propertyInputResult.data,
        propertyMutations,
        errors: propertyInputResult.errors 
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Introspection error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
