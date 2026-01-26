import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobberUser {
  id: string;
  name: {
    full: string;
  };
  email: {
    raw: string;
  } | null;
}

interface UsersResponse {
  users: {
    nodes: JobberUser[];
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Get auth header from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's auth
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is admin
    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
    if (adminError || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Query Jobber for all users
    const query = `
      query GetUsers {
        users(first: 100) {
          nodes {
            id
            name {
              full
            }
            email {
              raw
            }
          }
        }
      }
    `;

    const result = await jobberGraphQL<UsersResponse>(query);

    if (result.errors) {
      console.error("Jobber API errors:", result.errors);
      return new Response(
        JSON.stringify({ error: "Failed to fetch users from Jobber", details: result.errors }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const jobberUsers = result.data?.users?.nodes || [];
    console.log(`Found ${jobberUsers.length} users in Jobber`);

    // Use service role for database operations
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get existing technicians
    const { data: existingTechs, error: fetchError } = await supabaseAdmin
      .from("technicians")
      .select("jobber_user_id");

    if (fetchError) {
      throw fetchError;
    }

    const existingIds = new Set(existingTechs?.map((t) => t.jobber_user_id) || []);

    // Find new users to sync
    const newUsers = jobberUsers.filter((u) => !existingIds.has(u.id));
    let syncedCount = 0;

    for (const user of newUsers) {
      const { error: insertError } = await supabaseAdmin.from("technicians").insert({
        jobber_user_id: user.id,
        name: user.name.full,
        email: user.email?.raw || null,
        is_active: true,
      });

      if (insertError) {
        console.error(`Failed to insert user ${user.name.full}:`, insertError);
      } else {
        syncedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalJobberUsers: jobberUsers.length,
        newUsersSynced: syncedCount,
        alreadyExisted: jobberUsers.length - newUsers.length,
        users: jobberUsers.map((u) => ({
          id: u.id,
          name: u.name.full,
          email: u.email?.raw || null,
          isNew: !existingIds.has(u.id),
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Failed to sync users", details: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
