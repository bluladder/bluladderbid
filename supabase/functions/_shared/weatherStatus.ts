// ============================================================================
// weatherStatus.ts — single source of truth for the current weather advisory
// exposed to the AI. Admins update the row via the admin panel; the
// orchestrator loads it at prompt-assembly time and injects a directive so
// the AI relays admin-authored copy verbatim instead of guessing about the
// weather or route conditions on its own.
//
// Pure helpers (renderWeatherDirective) are unit-testable without I/O.
// ============================================================================

export type WeatherStatus = "normal" | "monitoring" | "delayed" | "paused";

export interface WeatherStatusRow {
  status: WeatherStatus;
  advisory_message: string | null;
  updated_at?: string | null;
}

// Render the customer-safe directive the AI must follow. When status is
// "normal" we return "" so the caller can skip the block entirely and leave
// the system prompt unchanged.
export function renderWeatherDirective(row: WeatherStatusRow | null | undefined): string {
  if (!row) return "";
  const status = row.status;
  if (status === "normal") return "";
  const advisory = (row.advisory_message ?? "").trim();
  const label: Record<Exclude<WeatherStatus, "normal">, string> = {
    monitoring: "Weather is being actively monitored.",
    delayed: "Some appointments may be delayed by weather.",
    paused: "Weather-related pause is in effect for outdoor appointments.",
  };
  const lead = label[status];
  const copy = advisory
    ? advisory
    : status === "paused"
      ? "Outdoor services are on hold while conditions are unsafe."
      : "The team is watching conditions and will reach out directly if a specific appointment is affected.";
  return [
    "WEATHER DIRECTIVE (admin-controlled):",
    `- Current status: ${status}. ${lead}`,
    `- If a customer asks about weather, delays, rescheduling because of weather, or whether their appointment is still on, relay ONLY this admin-approved advisory verbatim: "${copy}"`,
    "- Never invent forecast details, radar, or a specific reschedule decision. Never promise a specific new time — direct them to their booking-management link or offer to have the team reach out.",
    "- Do not use this advisory for unrelated questions.",
  ].join("\n");
}

// deno-lint-ignore no-explicit-any
export async function loadWeatherStatus(supabase: any): Promise<WeatherStatusRow | null> {
  try {
    const { data } = await supabase
      .from("weather_status")
      .select("status, advisory_message, updated_at")
      .eq("singleton", true)
      .maybeSingle();
    if (!data) return null;
    return {
      status: (data.status as WeatherStatus) ?? "normal",
      advisory_message: data.advisory_message ?? null,
      updated_at: data.updated_at ?? null,
    };
  } catch {
    return null;
  }
}