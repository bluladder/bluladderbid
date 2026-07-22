// ============================================================================
// postServiceSweeps.ts — Slice C sweeps.
//
// Two lightweight cron-driven sweeps, both idempotent and campaign-safe:
//
//   1. runPostServiceEducationSweep: for every booking whose work is complete
//      and whose completion is now old enough per service_education_content,
//      raise a `service_completed` campaign event (once per booking+service_key,
//      via a deterministic idempotencyKey).
//
//   2. runMaintenanceOpportunitySweep: for every booking whose service window
//      has passed the configured maintenance interval, raise a `maintenance_due`
//      event and stamp bookings.maintenance_last_notified_at so we do not
//      re-emit for the same rebooking window.
//
// Neither sweep sends any message directly. Delivery only happens when an
// admin activates a matching campaign. Pure helpers are exposed for tests.
// ============================================================================
import { emitCampaignEvent } from "./campaignEmitter.ts";

// deno-lint-ignore no-explicit-any
type S = any;

export interface EducationRow {
  service_key: string;
  send_after_days: number;
  channel: string;
  is_active: boolean;
}

export interface MaintenanceRow {
  service_key: string;
  interval_days: number;
  is_active: boolean;
}

export interface BookingLite {
  id: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  service_completed_at?: string | null;
  scheduled_start_at?: string | null;
  maintenance_last_notified_at?: string | null;
  service_types?: string[] | null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function educationDueKeys(
  booking: BookingLite,
  contents: EducationRow[],
  now: Date,
): string[] {
  const completed = booking.service_completed_at ? new Date(booking.service_completed_at) : null;
  if (!completed || isNaN(completed.getTime())) return [];
  const active = new Map(contents.filter((c) => c.is_active).map((c) => [c.service_key, c] as const));
  const bookingServices = Array.isArray(booking.service_types) ? booking.service_types : [];
  const out: string[] = [];
  for (const key of bookingServices) {
    const cfg = active.get(key);
    if (!cfg) continue;
    if (daysBetween(now, completed) >= cfg.send_after_days) out.push(key);
  }
  return out;
}

export function maintenanceDueKeys(
  booking: BookingLite,
  intervals: MaintenanceRow[],
  now: Date,
): string[] {
  const anchor = booking.service_completed_at
    ? new Date(booking.service_completed_at)
    : booking.scheduled_start_at
      ? new Date(booking.scheduled_start_at)
      : null;
  if (!anchor || isNaN(anchor.getTime())) return [];
  const alreadyNotified = booking.maintenance_last_notified_at
    ? new Date(booking.maintenance_last_notified_at)
    : null;
  const active = new Map(intervals.filter((c) => c.is_active).map((c) => [c.service_key, c] as const));
  const bookingServices = Array.isArray(booking.service_types) ? booking.service_types : [];
  const out: string[] = [];
  for (const key of bookingServices) {
    const cfg = active.get(key);
    if (!cfg) continue;
    if (daysBetween(now, anchor) < cfg.interval_days) continue;
    if (alreadyNotified && daysBetween(now, alreadyNotified) < cfg.interval_days) continue;
    out.push(key);
  }
  return out;
}

const SUPABASE_URL = () => Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export async function runPostServiceEducationSweep(supabase: S): Promise<{ emitted: number }> {
  const now = new Date();
  const { data: contents } = await supabase
    .from("service_education_content")
    .select("service_key, send_after_days, channel, is_active")
    .eq("is_active", true);
  if (!contents || contents.length === 0) return { emitted: 0 };
  const cutoff = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, customer_email, customer_phone, service_completed_at, service_types")
    .not("service_completed_at", "is", null)
    .gte("service_completed_at", cutoff)
    .limit(200);
  let emitted = 0;
  for (const b of bookings ?? []) {
    const due = educationDueKeys(b as BookingLite, contents as EducationRow[], now);
    for (const key of due) {
      const res = await emitCampaignEvent({
        eventName: "service_completed",
        idempotencyKey: `service_completed:${b.id}:${key}`,
        source: "post_service_education_sweep",
        email: b.customer_email ?? null,
        phone: b.customer_phone ?? null,
        supabaseUrl: SUPABASE_URL(),
        serviceKey: SERVICE_KEY(),
        metadata: { booking_id: b.id, service_key: key },
        recoverySupabase: supabase,
      });
      if (res?.ok) emitted++;
    }
  }
  return { emitted };
}

export async function runMaintenanceOpportunitySweep(supabase: S): Promise<{ emitted: number }> {
  const now = new Date();
  const { data: intervals } = await supabase
    .from("service_maintenance_intervals")
    .select("service_key, interval_days, is_active")
    .eq("is_active", true);
  if (!intervals || intervals.length === 0) return { emitted: 0 };
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, customer_email, customer_phone, service_completed_at, scheduled_start_at, maintenance_last_notified_at, service_types")
    .not("service_types", "is", null)
    .order("scheduled_start_at", { ascending: false })
    .limit(500);
  let emitted = 0;
  for (const b of bookings ?? []) {
    const due = maintenanceDueKeys(b as BookingLite, intervals as MaintenanceRow[], now);
    if (due.length === 0) continue;
    const notifiedTag = new Date().toISOString().slice(0, 10);
    for (const key of due) {
      const res = await emitCampaignEvent({
        eventName: "maintenance_due",
        idempotencyKey: `maintenance_due:${b.id}:${key}:${notifiedTag}`,
        source: "maintenance_opportunity_sweep",
        email: b.customer_email ?? null,
        phone: b.customer_phone ?? null,
        supabaseUrl: SUPABASE_URL(),
        serviceKey: SERVICE_KEY(),
        metadata: { booking_id: b.id, service_key: key },
        recoverySupabase: supabase,
      });
      if (res?.ok) emitted++;
    }
    await supabase
      .from("bookings")
      .update({ maintenance_last_notified_at: now.toISOString() })
      .eq("id", b.id);
  }
  return { emitted };
}