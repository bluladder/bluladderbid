// Loads the LIVE pricing_config from the database and the current pricing rule
// version. There is deliberately NO hard-coded price fallback: if the config
// cannot be loaded or a required key is missing, the caller must fail safely
// (return "manual_review_required" / "pricing_unavailable"), never guess.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PricingConfig } from "./pricingEngine.ts";

const REQUIRED_KEYS = [
  "window_cleaning",
  "window_addons",
  "house_wash",
  "gutter_cleaning",
  "roof_cleaning",
  "driveway_cleaning",
  "pressure_washing",
  "solar_panel_cleaning",
  "screen_repair",
];

export interface LoadedPricing {
  ok: boolean;
  pricing: PricingConfig | null;
  ruleVersion: number | null;
  missingKeys: string[];
  error?: string;
}

export async function loadPricing(supabase: SupabaseClient): Promise<LoadedPricing> {
  try {
    const { data, error } = await supabase
      .from("pricing_config")
      .select("config_key, config_value");

    if (error) {
      return { ok: false, pricing: null, ruleVersion: null, missingKeys: [], error: error.message };
    }
    if (!data || data.length === 0) {
      return { ok: false, pricing: null, ruleVersion: null, missingKeys: REQUIRED_KEYS, error: "no pricing rows" };
    }

    const map: Record<string, unknown> = {};
    for (const row of data) map[row.config_key] = row.config_value;

    const missingKeys = REQUIRED_KEYS.filter((k) => !(k in map) || map[k] == null);
    if (missingKeys.length > 0) {
      return { ok: false, pricing: null, ruleVersion: null, missingKeys };
    }

    let ruleVersion: number | null = null;
    try {
      const { data: v } = await supabase.rpc("current_pricing_version");
      if (typeof v === "number") ruleVersion = v;
    } catch {
      // version stamp is best-effort; a missing version does not block pricing
    }

    return { ok: true, pricing: map as unknown as PricingConfig, ruleVersion, missingKeys: [] };
  } catch (e) {
    return {
      ok: false,
      pricing: null,
      ruleVersion: null,
      missingKeys: [],
      error: e instanceof Error ? e.message : "unknown error loading pricing",
    };
  }
}