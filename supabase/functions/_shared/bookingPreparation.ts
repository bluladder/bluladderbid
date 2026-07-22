// ============================================================================
// bookingPreparation.ts — resolve per-service preparation instructions.
//
// Pure helpers (resolveServiceKey, buildPrepBlocks, renderPrepHtml) carry no
// I/O so they can be unit-tested directly. loadActivePrepConfigs is the only
// DB-touching helper and is a thin lookup against service_preparation_config.
//
// This module is the SINGLE source of the customer-facing preparation block
// appended to the BluLadder booking confirmation email. It is intentionally
// scoped: we do NOT emit a separate prep SMS, we do NOT re-send prep on
// reschedule (dedupe via bookings.prep_email_sent_at), and we never duplicate
// Jobber's own confirmation / reminders / on-my-way / review / referral
// messages.
// ============================================================================

export interface PrepConfig {
  service_key: string;
  display_name: string;
  is_active: boolean;
  instructions: string[];
  sort_order: number;
}

export interface ServiceLineLike {
  name?: string | null;
  key?: string | null;
}

// Canonical service keys used by pricing_config / engine.
const CANONICAL_KEYS = [
  "window_cleaning",
  "house_wash",
  "pressure_washing",
  "driveway_cleaning",
  "gutter_cleaning",
  "roof_cleaning",
  "christmas_lights",
] as const;

// Map a booking service line to a canonical key. Prefers explicit `.key` if
// present, otherwise fuzzy-matches on the display name.
export function resolveServiceKey(line: ServiceLineLike): string | null {
  const raw = (line.key ?? "").trim().toLowerCase();
  if (raw && (CANONICAL_KEYS as readonly string[]).includes(raw)) return raw;
  const name = (line.name ?? "").toLowerCase();
  if (!name) return null;
  if (name.includes("window")) return "window_cleaning";
  // Check specific surface keywords BEFORE generic "wash" / "pressure" so
  // "Roof soft wash" and "Driveway pressure cleaning" resolve correctly.
  if (name.includes("roof")) return "roof_cleaning";
  if (name.includes("driveway") || name.includes("flatwork")) return "driveway_cleaning";
  if (name.includes("gutter")) return "gutter_cleaning";
  if (name.includes("house wash") || name.includes("soft wash") || name.includes("house-wash")) return "house_wash";
  if (name.includes("pressure")) return "pressure_washing";
  if (name.includes("christmas") || name.includes("holiday light")) return "christmas_lights";
  return null;
}

// Deterministic ordering: preserve the order services appear on the booking,
// deduped by canonical key. Never returns configs that are inactive or empty.
export function buildPrepBlocks(
  services: ServiceLineLike[],
  configs: PrepConfig[],
): PrepConfig[] {
  const byKey = new Map<string, PrepConfig>();
  for (const c of configs) {
    if (!c.is_active) continue;
    if (!Array.isArray(c.instructions) || c.instructions.length === 0) continue;
    byKey.set(c.service_key, c);
  }
  const seen = new Set<string>();
  const out: PrepConfig[] = [];
  for (const s of services ?? []) {
    const k = resolveServiceKey(s);
    if (!k || seen.has(k)) continue;
    const cfg = byKey.get(k);
    if (!cfg) continue;
    seen.add(k);
    out.push(cfg);
  }
  return out;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

// Renders the per-service preparation block. Returns "" when nothing applies
// so the caller can fall back to a generic block or omit the section entirely.
export function renderPrepHtml(blocks: PrepConfig[]): string {
  if (blocks.length === 0) return "";
  const sections = blocks.map((b) => {
    const items = b.instructions
      .filter((i) => typeof i === "string" && i.trim().length > 0)
      .map((i) => `<li style="margin:4px 0">${escapeHtml(i)}</li>`)
      .join("");
    return `<div style="margin:10px 0">
      <div style="font-weight:600;color:#0f172a;margin-bottom:4px">${escapeHtml(b.display_name)}</div>
      <ul style="margin:0 0 0 0;padding-left:18px">${items}</ul>
    </div>`;
  }).join("");
  return `<h3 style="margin:20px 0 6px 0">How to prepare</h3>${sections}`;
}

// deno-lint-ignore no-explicit-any
export async function loadActivePrepConfigs(supabase: any): Promise<PrepConfig[]> {
  try {
    const { data } = await supabase
      .from("service_preparation_config")
      .select("service_key, display_name, is_active, instructions, sort_order")
      .eq("is_active", true)
      .order("sort_order");
    return ((data as PrepConfig[]) ?? []).map((r) => ({
      ...r,
      instructions: Array.isArray(r.instructions) ? r.instructions : [],
    }));
  } catch {
    return [];
  }
}

// deno-lint-ignore no-explicit-any
export async function hasPrepAlreadyBeenSent(supabase: any, bookingId: string): Promise<boolean> {
  if (!bookingId) return false;
  const { data } = await supabase
    .from("bookings")
    .select("prep_email_sent_at")
    .eq("id", bookingId)
    .maybeSingle();
  return !!(data && data.prep_email_sent_at);
}

// deno-lint-ignore no-explicit-any
export async function markPrepSent(supabase: any, bookingId: string): Promise<void> {
  if (!bookingId) return;
  await supabase
    .from("bookings")
    .update({ prep_email_sent_at: new Date().toISOString() })
    .eq("id", bookingId)
    .is("prep_email_sent_at", null);
}