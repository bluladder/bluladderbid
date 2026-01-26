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
    // Query for jobCreate mutation input type
    const introspectionQuery = `
      query IntrospectJobCreate {
        __schema {
          mutationType {
            fields {
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

    const result = await jobberGraphQL<unknown>(introspectionQuery, {});
    
    // Also try to get input types
    const inputTypesQuery = `
      query GetInputTypes {
        __schema {
          types {
            name
            kind
            inputFields {
              name
              type {
                name
                kind
              }
            }
          }
        }
      }
    `;
    
    const inputTypesResult = await jobberGraphQL<unknown>(inputTypesQuery, {});
    
    // Filter for Job-related types
    const allTypes = (inputTypesResult.data as any)?.__schema?.types || [];
    const jobTypes = allTypes.filter((t: any) => 
      t.name?.toLowerCase().includes('job') && t.kind === 'INPUT_OBJECT'
    );

    return new Response(
      JSON.stringify({ 
        mutations: result.data,
        jobInputTypes: jobTypes,
        errors: result.errors 
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
