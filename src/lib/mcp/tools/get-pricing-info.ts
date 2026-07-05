import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

// Reads the public pricing configuration so an assistant can explain how
// BluLadder prices its services. This table is public/read-only; no private
// customer data is exposed.
function publicSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export default defineTool({
  name: "get_pricing_info",
  title: "Get pricing info",
  description:
    "Return BluLadder's public pricing configuration (base rates, multipliers, minimums, and add-ons). Optionally filter by a config key such as 'window_base_rates' or 'story_multipliers'.",
  inputSchema: {
    config_key: z
      .string()
      .optional()
      .describe("Optional exact config key to return a single configuration entry."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ config_key }) => {
    const supabase = publicSupabase();
    let query = supabase
      .from("pricing_config")
      .select("config_key, config_value, description");
    if (config_key) query = query.eq("config_key", config_key);

    const { data, error } = await query;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { pricing: data },
    };
  },
});
