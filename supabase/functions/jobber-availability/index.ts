import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { blockOverlapsDay, slotHasConflict, effectiveWorkDays, isBusinessDay } from "./availability-core.ts";
import { getMirrorFreshness, unavailableCustomerMessage } from "../_shared/scheduleFreshness.ts";
import {
  compactSlots,
  computeMinViableGap,
  DEFAULT_COMPACTION_CONFIG,
  type ResolvedCompactionConfig,
} from "./scheduleCompaction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ServicePrice {
  service: string;
  price: number;
}

interface AvailabilityRequest {
  services: ServicePrice[];
  startDate?: string;
  daysToCheck?: number;
  timezone?: string;
  customerAddress?: string;
  includeExcluded?: boolean;
  mode?: 'recommended' | 'dayGrid';
  preference?: 'AM' | 'PM' | 'none';
  selectedDate?: string;
  numStories?: number;
}

interface BufferTier {
  min_drive: number;
  max_drive: number;
  buffer: number;
}

interface DriveTimeConfig {
  base_buffer_minutes: number;
  buffer_tiers: BufferTier[];
  max_drive_time_minutes: number;
  allow_long_first_drive: boolean;
  earliest_start_hour: number;
  latest_start_hour: number;
  last_job_buffer_minutes: number;
  no_long_last_drive: boolean;
  office_address: string | null;
}

interface BigJobSettings {
  big_job_value_threshold: number;
  big_job_solo_hours_threshold: number | null;
  auto_assign_two_techs: boolean;
  crew_efficiency_factor: number;
  workday_start_time: string;
  workday_end_time: string;
  workday_length_hours: number;
  min_buffer_minutes: number;
  big_job_trigger_mode: 'PRICE_ONLY' | 'HOURS_ONLY' | 'PRICE_OR_HOURS' | 'FITS_IN_DAY';
  pairing_mode: 'AUTO_PAIR' | 'RESTRICTED' | 'PREFER_LIST';
}

interface ExclusionReason {
  code: 'OVERLAP' | 'DRIVE_TIME' | 'BUFFER' | 'BOUNDARY' | 'LAST_JOB' | 'GAP_PENALTY' | 'COMPACTION';
  message: string;
  details?: string;
}

interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  displayTime?: string;
  durationMinutes: number;
  isRecommended?: boolean;
  estimatedDriveMinutes?: number;
  isFirstJob?: boolean;
  isLongFirstDrive?: boolean;
  routeDensityScore?: number;
  routeDensityLabel?: string;
  nearbyJobCount?: number;
  excluded?: boolean;
  exclusionReason?: ExclusionReason;
  gapMinutes?: number;
  gapScore?: number;
  gapEfficiencyLabel?: string;
  routeBonus?: number;
  skillMultiplier?: number;
  preferenceBonus?: number;
  discouragedPenalty?: number;
  technicianScore?: number;
  whyLabel?: string;
  // Schedule-compaction fields (populated after the compaction pass). These are
  // internal ranking/debug aids; customer UIs simply ignore the extra fields.
  freeBlockStartMs?: number;
  freeBlockEndMs?: number;
  gapBeforeMinutes?: number;
  gapAfterMinutes?: number;
  minViableGapMinutes?: number;
  compactionScore?: number;
  packsStart?: boolean;
  packsEnd?: boolean;
  compactionShown?: boolean;
  compactionFilterReason?: string | null;
  // Team booking fields
  isTeamJob?: boolean;
  crewSize?: number;
  teamTechnicianIds?: string[];
  teamTechnicianNames?: string[];
  estimatedTeamHours?: number;
  estimatedSoloHours?: number;
  teamTriggerReason?: 'price' | 'hours' | 'fits_in_day';
}

interface RecommendedDay {
  date: string;
  dayOfWeek: string;
  label: string;
  reason: string;
  jobCount: number;
  availableSlots: number;
  efficiencyScore: number;
}

interface DayMetrics {
  date: Date;
  dateStr: string;
  totalSlots: number;
  bookedJobs: number;
  avgDriveEfficiency: number;
  capacityUtilization: number;
  jobAddresses: string[];
  hasAnySlot: boolean;
}

interface BusyBlock {
  id: string;
  crew_id: string;
  start_at: string;
  end_at: string;
  jobber_visit_id: string | null;
  status: string;
  client_address: string | null;
}

interface DriveCacheEntry {
  origin_hash: string;
  dest_hash: string;
  drive_minutes: number;
}

const DEFAULT_BUSINESS_HOURS = {
  startHour: 9,
  endHour: 17,
  workDays: [1, 2, 3, 4, 5],
  timezone: "America/Chicago",
};

const DEFAULT_DRIVE_TIME_CONFIG: DriveTimeConfig = {
  base_buffer_minutes: 10,
  buffer_tiers: [
    { min_drive: 0, max_drive: 10, buffer: 10 },
    { min_drive: 10, max_drive: 25, buffer: 20 },
    { min_drive: 25, max_drive: 45, buffer: 30 },
  ],
  max_drive_time_minutes: 45,
  allow_long_first_drive: true,
  earliest_start_hour: 9,
  latest_start_hour: 16,
  last_job_buffer_minutes: 0,
  no_long_last_drive: true,
  office_address: null,
};

const DEFAULT_BIG_JOB_SETTINGS: BigJobSettings = {
  big_job_value_threshold: 900,
  big_job_solo_hours_threshold: 8,
  auto_assign_two_techs: true,
  crew_efficiency_factor: 1.8,
  workday_start_time: '09:00',
  workday_end_time: '17:00',
  workday_length_hours: 8,
  min_buffer_minutes: 30,
  big_job_trigger_mode: 'FITS_IN_DAY',
  pairing_mode: 'RESTRICTED',
};

// Configurable slot generation settings
const SLOT_GENERATION_CONFIG = {
  internalIncrementMinutes: 15,
  displayIncrementMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
};

// Schedule-compaction defaults. Overridable per-business via the
// pricing_config row keyed "schedule_compaction" (values below are the fallback
// when that row is absent or partial). See scheduleCompaction.ts for the math.
const DEFAULT_COMPACTION_SETTINGS: ResolvedCompactionConfig = {
  ...DEFAULT_COMPACTION_CONFIG,
};
// Whether a customer's specific time request that fails compaction may be
// escalated for manual review (an admin/human agent can still override — the AI
// never overrides the rule on its own).
const DEFAULT_ALLOW_TIME_REQUEST_ESCALATION = true;

// Gap-scoring constants
const GAP_SCORING = {
  idealGapMax: 15,
  goodGapMax: 30,
  microGapThreshold: 60,
  longJobMinutes: 480,
  mediumJobMinutes: 240,
  routeProximityBonus: 15,
  routeProximityThreshold: 12,
};

// Debug logging helper for admin visibility
interface SlotScoreDebug {
  techName: string;
  slotTime: string;
  gapMinutes: number;
  gapScore: number;
  driveMinutes: number;
  routeScore: number;
  routeBonus: number;
  preferenceMatch: boolean;
  finalScore: number;
  whyRejected?: string;
}

interface BusinessHoursConfig {
  startHour: number;
  endHour: number;
  workDays: number[];
  timezone?: string;
}

// Helper to create a date in a specific timezone
function createDateInTimezone(date: Date, hour: number, minute: number, timezone: string): Date {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hourStr = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');
  
  const localDateStr = `${year}-${month}-${day}T${hourStr}:${minStr}:00`;
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  let testDate = new Date(`${localDateStr}Z`);
  
  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(testDate);
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const localDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    
    const hourDiff = hour - localHour;
    const dayDiff = parseInt(day) - localDay;
    
    testDate = new Date(testDate.getTime() + (hourDiff * 60 * 60 * 1000) + (dayDiff * 24 * 60 * 60 * 1000));
  }
  
  return testDate;
}

function getHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  return parseInt(parts.find(p => p.type === 'hour')?.value || '0');
}

function getMinutesInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  return parseInt(parts.find(p => p.type === 'minute')?.value || '0');
}

function formatDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function getWeekdayInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  });
  return formatter.format(date);
}

function extractZone(address: string | null): string {
  if (!address) return 'unknown';
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    return parts[1].toLowerCase();
  }
  return parts[0].toLowerCase().substring(0, 20);
}

function calculateProximityScore(addr1: string | null, addr2: string | null): number {
  if (!addr1 || !addr2) return 50;
  
  const zone1 = extractZone(addr1);
  const zone2 = extractZone(addr2);
  
  if (zone1 === zone2) return 100;
  
  const words1 = zone1.split(/\s+/);
  const words2 = zone2.split(/\s+/);
  const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
  
  if (commonWords.length > 0) return 75;
  
  return 30;
}

// Hash function for drive time cache keys
function hashAddress(address: string | null): string {
  if (!address) return 'null';
  // Normalize: lowercase, remove extra spaces, common abbreviations
  const normalized = address
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\broad\b/g, 'rd')
    .trim();
  
  // Simple hash
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `addr_${Math.abs(hash).toString(36)}`;
}

// Fallback drive time estimation (used when no cache or API)
function estimateDriveTimeFallback(fromAddress: string | null, toAddress: string | null): number {
  if (!fromAddress || !toAddress) {
    return 15;
  }
  
  const proximity = calculateProximityScore(fromAddress, toAddress);
  if (proximity >= 100) return 8;
  if (proximity >= 75) return 18;
  
  const hash = (fromAddress + toAddress).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return 15 + Math.abs(hash % 30);
}

function getBufferForDriveTime(driveMinutes: number, config: DriveTimeConfig): number {
  for (const tier of config.buffer_tiers) {
    if (driveMinutes >= tier.min_drive && driveMinutes < tier.max_drive) {
      return tier.buffer;
    }
  }
  const lastTier = config.buffer_tiers[config.buffer_tiers.length - 1];
  return lastTier?.buffer || config.base_buffer_minutes;
}

function calculateRouteDensityScore(
  slotStart: Date,
  customerAddress: string | null,
  dayJobAddresses: string[],
  previousJobAddress: string | null,
  nextJobAddress: string | null
): { score: number; label: string; nearbyJobCount: number } {
  if (!customerAddress || dayJobAddresses.length === 0) {
    return { score: 50, label: '', nearbyJobCount: 0 };
  }
  
  const customerZone = extractZone(customerAddress);
  const nearbyJobs = dayJobAddresses.filter(addr => {
    const jobZone = extractZone(addr);
    return jobZone === customerZone;
  });
  
  let score = 50;
  score += Math.min(nearbyJobs.length * 15, 40);
  
  if (previousJobAddress) {
    const prevProximity = calculateProximityScore(customerAddress, previousJobAddress);
    score += (prevProximity - 50) * 0.2;
  }
  if (nextJobAddress) {
    const nextProximity = calculateProximityScore(customerAddress, nextJobAddress);
    score += (nextProximity - 50) * 0.2;
  }
  
  score = Math.max(0, Math.min(100, score));
  
  let label = '';
  if (score >= 85) {
    label = 'Best fit for your area';
  } else if (score >= 70) {
    label = 'Recommended';
  } else if (nearbyJobs.length >= 2) {
    label = 'Good route fit';
  }
  
  return { score, label, nearbyJobCount: nearbyJobs.length };
}

// Format the exact appointment start time shown to customers/admins.
// Do not round this value: the selected slot's ISO start time is what gets
// booked in Jobber, so displaying a rounded label (for example showing 9:30
// for a real 9:15 slot) is misleading and can look like a scheduling bug.
function snapTo30Min(date: Date, timezone: string): string {
  const hour = getHourInTimezone(date, timezone);
  const minutes = getMinutesInTimezone(date, timezone);
  const displayHour = hour;
  const displayMin = minutes;
  
  const ampm = displayHour >= 12 ? 'PM' : 'AM';
  const displayHour12 = displayHour > 12 ? displayHour - 12 : (displayHour === 0 ? 12 : displayHour);
  
  return `${displayHour12}:${String(displayMin).padStart(2, '0')} ${ampm}`;
}

// Calculate gap score - higher is better (dispatch-smart gap minimization)
function calculateGapScore(
  gapMinutes: number,
  preference: 'AM' | 'PM' | 'none',
  slotHour: number,
  durationMinutes: number,
  driveMinutes: number = 0
): { score: number; penalized: boolean; routeBonus: number; preferenceMatch: boolean } {
  let score = 100;
  let penalized = false;
  let routeBonus = 0;
  
  // Gap scoring with tiered thresholds
  if (gapMinutes >= 0 && gapMinutes <= GAP_SCORING.idealGapMax) {
    // Ideal: 0-15 min gap
    score = 100;
  } else if (gapMinutes > GAP_SCORING.idealGapMax && gapMinutes <= GAP_SCORING.goodGapMax) {
    // Good: 16-30 min gap
    score = 85;
  } else if (gapMinutes > GAP_SCORING.goodGapMax && gapMinutes < GAP_SCORING.microGapThreshold) {
    // Micro gap (31-59 min): penalize UNLESS PM preference
    if (preference !== 'PM') {
      score = 40; // Moderate penalty
      penalized = true;
    } else {
      score = 60; // Lighter penalty for PM preference (more gap tolerance)
    }
  } else if (gapMinutes >= GAP_SCORING.microGapThreshold) {
    // Longer gaps (60+ min): graduated decay
    score = Math.max(25, 75 - (gapMinutes - 60) * 0.4);
  }
  
  // Route continuity bonus: if drive time is short, boost score
  if (driveMinutes > 0 && driveMinutes <= GAP_SCORING.routeProximityThreshold) {
    routeBonus = GAP_SCORING.routeProximityBonus;
    score += routeBonus;
  }
  
  // AM/PM preference matching
  const isAM = slotHour < 12;
  const preferenceMatch = (preference === 'AM' && isAM) || 
                          (preference === 'PM' && !isAM) || 
                          preference === 'none';
  
  if (preference === 'AM' && isAM) {
    score += 10;
  } else if (preference === 'PM' && !isAM) {
    score += 10;
  }
  
  // Long job rule: 8+ hours MUST start AM (hard reject if PM)
  if (durationMinutes >= GAP_SCORING.longJobMinutes && !isAM) {
    score = 0;
  }
  
  // Medium job (4-8 hours): strongly prefer AM (penalty if PM)
  if (durationMinutes >= GAP_SCORING.mediumJobMinutes && durationMinutes < GAP_SCORING.longJobMinutes && !isAM) {
    score -= 25;
  }
  
  return { 
    score: Math.max(0, Math.min(115, score)), // Allow up to 115 with bonuses
    penalized, 
    routeBonus,
    preferenceMatch,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      services, 
      startDate, 
      daysToCheck = 14, 
      customerAddress,
      includeExcluded = false,
      mode = 'recommended',
      preference = 'none',
      selectedDate,
      numStories,
    }: AvailabilityRequest = await req.json();

    const requestedDaysToCheck = Number.isFinite(daysToCheck) ? Math.floor(daysToCheck) : 14;
    const effectiveDaysToCheck = includeExcluded
      ? Math.max(1, Math.min(requestedDaysToCheck, 60))
      : Math.max(1, Math.min(requestedDaysToCheck, 30));

    if (!services || services.length === 0) {
      return new Response(
        JSON.stringify({ error: "No services provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check sync state - warn if not synced
    const { data: syncState } = await supabase
      .from("jobber_sync_state")
      .select("last_backfill_at, backfill_in_progress")
      .eq("id", "default")
      .maybeSingle();

    if (!syncState?.last_backfill_at) {
      return new Response(
        JSON.stringify({
          error: "Schedule not synced yet. Please run 'Sync Jobber Schedule' in Admin → Crew settings.",
          code: "SYNC_REQUIRED",
          requiresAdminAction: true,
          slots: [],
          recommendations: [],
          fullyBookedDays: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
      );
    }

    // ===== STALE / IN-PROGRESS GUARD =====
    // Never serve availability from a schedule mirror that is stale, currently
    // syncing, or has never completed a clean full sweep. Failing closed here
    // prevents showing appointment times that may not actually be available.
    const freshness = await getMirrorFreshness(supabase);
    if (!freshness.ok) {
      console.warn(
        `[Availability] Withholding slots — mirror not usable. reason=${freshness.reason} ` +
          `ageMinutes=${freshness.ageMinutes === null ? "n/a" : Math.round(freshness.ageMinutes)} ` +
          `syncInProgress=${freshness.syncInProgress} lastComplete=${freshness.lastCompleteSyncAt ?? "never"}`,
      );
      return new Response(
        JSON.stringify({
          availability_unavailable: true,
          reason: freshness.reason,
          error: unavailableCustomerMessage(),
          message: unavailableCustomerMessage(),
          slots: [],
          recommendations: [],
          rankedSlots: [],
          fullyBookedDays: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 },
      );
    }

    // Fetch business hours
    let BUSINESS_HOURS: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS;
    
    const { data: configData } = await supabase
      .from("pricing_config")
      .select("config_value")
      .eq("config_key", "business_hours")
      .maybeSingle();

    if (configData?.config_value) {
      const cfg = configData.config_value as Record<string, unknown>;
      BUSINESS_HOURS = {
        startHour: (cfg.startHour as number) ?? DEFAULT_BUSINESS_HOURS.startHour,
        endHour: (cfg.endHour as number) ?? DEFAULT_BUSINESS_HOURS.endHour,
        workDays: (cfg.workDays as number[]) ?? DEFAULT_BUSINESS_HOURS.workDays,
        timezone: (cfg.timezone as string) ?? DEFAULT_BUSINESS_HOURS.timezone,
      };
    }

    // Fetch schedule-compaction config (additive; falls back to sane defaults).
    let COMPACTION_CONFIG: ResolvedCompactionConfig = { ...DEFAULT_COMPACTION_SETTINGS };
    let allowTimeRequestEscalation = DEFAULT_ALLOW_TIME_REQUEST_ESCALATION;
    const { data: compactionConfigData } = await supabase
      .from("pricing_config")
      .select("config_value")
      .eq("config_key", "schedule_compaction")
      .maybeSingle();
    if (compactionConfigData?.config_value) {
      const cc = compactionConfigData.config_value as Record<string, unknown>;
      COMPACTION_CONFIG = {
        minimumFillableGapMinutes:
          Number(cc.minimum_fillable_gap_minutes ?? DEFAULT_COMPACTION_SETTINGS.minimumFillableGapMinutes),
        boundaryGapToleranceMinutes:
          Number(cc.boundary_gap_tolerance_minutes ?? DEFAULT_COMPACTION_SETTINGS.boundaryGapToleranceMinutes),
        maxCompactSlotsPerBlock:
          Number(cc.max_compact_slots_per_block ?? DEFAULT_COMPACTION_SETTINGS.maxCompactSlotsPerBlock),
        shortestFillableServiceMinutes:
          cc.shortest_fillable_service_minutes == null
            ? null
            : Number(cc.shortest_fillable_service_minutes),
        transitionBufferMinutes:
          Number(cc.transition_buffer_minutes ?? DEFAULT_COMPACTION_SETTINGS.transitionBufferMinutes ?? 0),
      };
      if (typeof cc.allow_time_request_escalation === "boolean") {
        allowTimeRequestEscalation = cc.allow_time_request_escalation;
      }
    }

    // Fetch drive time config
    let DRIVE_TIME_CONFIG: DriveTimeConfig = DEFAULT_DRIVE_TIME_CONFIG;
    
    const { data: driveConfigData } = await supabase
      .from("drive_time_config")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (driveConfigData) {
      DRIVE_TIME_CONFIG = {
        base_buffer_minutes: driveConfigData.base_buffer_minutes,
        buffer_tiers: driveConfigData.buffer_tiers as BufferTier[],
        max_drive_time_minutes: driveConfigData.max_drive_time_minutes,
        allow_long_first_drive: driveConfigData.allow_long_first_drive,
        earliest_start_hour: driveConfigData.earliest_start_hour,
        latest_start_hour: driveConfigData.latest_start_hour,
        last_job_buffer_minutes: driveConfigData.last_job_buffer_minutes,
        no_long_last_drive: driveConfigData.no_long_last_drive,
        office_address: driveConfigData.office_address,
      };
    }

    // Fetch big job settings
    let BIG_JOB_SETTINGS: BigJobSettings = DEFAULT_BIG_JOB_SETTINGS;
    
    const { data: bigJobData } = await supabase
      .from("big_job_settings")
      .select("*")
      .eq("id", "default")
      .maybeSingle();

    if (bigJobData) {
      const parseTime = (t: string | null) => t ? t.substring(0, 5) : '09:00';
      BIG_JOB_SETTINGS = {
        big_job_value_threshold: bigJobData.big_job_value_threshold,
        big_job_solo_hours_threshold: bigJobData.big_job_solo_hours_threshold,
        auto_assign_two_techs: bigJobData.auto_assign_two_techs,
        crew_efficiency_factor: Number(bigJobData.crew_efficiency_factor) || 1.8,
        workday_start_time: parseTime(bigJobData.workday_start_time),
        workday_end_time: parseTime(bigJobData.workday_end_time),
        workday_length_hours: Number(bigJobData.workday_length_hours) || 8,
        min_buffer_minutes: bigJobData.min_buffer_minutes || 30,
        big_job_trigger_mode: (bigJobData.big_job_trigger_mode as BigJobSettings['big_job_trigger_mode']) || 'FITS_IN_DAY',
        pairing_mode: (bigJobData.pairing_mode as BigJobSettings['pairing_mode']) || 'RESTRICTED',
      };
    }

    const businessTimezone = BUSINESS_HOURS.timezone || DEFAULT_BUSINESS_HOURS.timezone;
    console.log(`[Availability] Mode: ${mode}, Preference: ${preference}, Timezone: ${businessTimezone}`);

    // Calculate total job price for big job detection
    const totalJobPrice = services.reduce((sum, s) => sum + s.price, 0);
    console.log(`[Availability] Total job price: $${totalJobPrice}`);

    // Map service names to service_type enum
    const serviceTypeMap: Record<string, string> = {
      "windows_exterior": "windows_exterior",
      "windows_interior": "windows_interior",
      "windowCleaning": "windows_exterior",
      "gutterCleaning": "gutters",
      "gutters": "gutters",
      "houseWashing": "house_wash",
      "house_wash": "house_wash",
      "roofCleaning": "roof_wash",
      "roof_wash": "roof_wash",
      "driveway": "driveway",
      "pressureWashing": "driveway",
    };

    // The AI-chat path passes the customer-facing line-item names emitted by the
    // pricing engine (e.g. "Window Cleaning", "Gutter Cleaning", "House Wash").
    // Those display names were NOT present in the camelCase map above, so every
    // chat availability request fell through to the raw name and matched no
    // technician ("No technicians can perform all selected services"). Add the
    // canonical display names and resolve everything through one tolerant
    // normalizer so both the API keys and the display names map correctly.
    const displayNameMap: Record<string, string> = {
      "window cleaning": "windows_exterior",
      "window cleaning (exterior)": "windows_exterior",
      "window cleaning (interior & exterior)": "windows_exterior",
      "interior window cleaning": "windows_interior",
      "house wash": "house_wash",
      "gutter cleaning": "gutters",
      "roof cleaning": "roof_wash",
      "driveway cleaning": "driveway",
      "pressure washing": "driveway",
    };

    const resolveServiceType = (raw: string): string => {
      if (!raw) return raw;
      // 1) Exact API key match (e.g. "windows_exterior", "windowCleaning").
      if (serviceTypeMap[raw]) return serviceTypeMap[raw];
      const lower = raw.trim().toLowerCase();
      // 2) Exact display-name match.
      if (displayNameMap[lower]) return displayNameMap[lower];
      // 3) Keyword fallback so promo/variant labels still resolve safely
      //    (e.g. "Exterior Window Cleaning Promotion (up to 15 windows)").
      if (lower.includes("window")) {
        return lower.includes("interior") && !lower.includes("exterior")
          ? "windows_interior"
          : "windows_exterior";
      }
      if (lower.includes("gutter")) return "gutters";
      if (lower.includes("roof")) return "roof_wash";
      if (lower.includes("driveway") || lower.includes("pressure")) return "driveway";
      if (lower.includes("house wash") || lower.includes("house washing")) return "house_wash";
      // 4) Unknown — return the raw value; it simply won't match a rate.
      return raw;
    };

    // Get all active technicians with their rates and capabilities
    const { data: technicians, error: techError } = await supabase
      .from("technicians")
      .select(`
        id,
        jobber_user_id,
        name,
        starting_address,
        location_type,
        schedule_start_hour,
        schedule_end_hour,
        work_days,
        buffer_minutes,
        max_drive_time_minutes,
        max_stories,
        service_capabilities,
        technician_service_rates (
          service_type,
          dollars_per_hour,
          buffer_minutes
        )
      `)
      .eq("is_active", true);

    if (techError || !technicians?.length) {
      console.error("Tech query error:", techError);
      return new Response(
        JSON.stringify({ error: "No technicians available", slots: [], recommendations: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Availability] Found ${technicians.length} technicians`);

    // Technician capability types
    interface ServiceCapabilities {
      can_do_windows?: boolean;
      can_do_gutters?: boolean;
      can_do_pressure?: boolean;
      has_pressure_washer?: boolean;
      has_ladder_2_story?: boolean;
      is_roof_safe?: boolean;
      requires_bundle_for_windows?: boolean;
      eligible_for_big_job_pairing?: boolean;
      skill_levels?: Record<string, number>;
      preferred_services?: string[];
      discouraged_services?: string[];
      excluded_service_types?: string[]; // Generic tag-based exclusion list
    }

    // Calculate duration and skill score for each technician
    const eligibleTechs: Array<{
      id: string;
      jobberUserId: string;
      name: string;
      durationMinutes: number;
      startingAddress: string | null;
      locationType: string;
      scheduleStartHour: number;
      scheduleEndHour: number;
      workDays: number[];
      bufferMinutes: number | null;
      maxDriveTimeMinutes: number | null;
      maxStories: number | null;
      capabilities: ServiceCapabilities | null;
      skillScore: number;
      preferenceBonus: number;
      discouragedPenalty: number;
    }> = [];

    // Extract unique service types for this booking
    const requestedServiceTypes = services.map(s => resolveServiceType(s.service));

    for (const tech of technicians) {
      let totalDuration = 0;
      let canPerformAll = true;

      for (const svc of services) {
        const serviceType = resolveServiceType(svc.service);
        const rate = tech.technician_service_rates?.find(
          (r: { service_type: string }) => r.service_type === serviceType
        );

        if (!rate || rate.dollars_per_hour <= 0) {
          canPerformAll = false;
          break;
        }

        const minutes = Math.ceil((svc.price / rate.dollars_per_hour) * 60) + rate.buffer_minutes;
        totalDuration += minutes;
      }

      if (canPerformAll && totalDuration > 0) {
        const capabilities = tech.service_capabilities as ServiceCapabilities | null;
        
        // Story-based exclusion (hard rule)
        const techMaxStories = tech.max_stories;
        if (numStories && techMaxStories && numStories > techMaxStories) {
          console.log(`[Tech] ${tech.name}: EXCLUDED - max_stories=${techMaxStories}, job requires ${numStories} stories`);
          continue; // Skip this technician entirely
        }
        
        // Equipment-based exclusion for pressure washing
        const needsPressureWasher = requestedServiceTypes.some(s => 
          ['driveway', 'pressure_wash_addon', 'house_wash'].includes(s)
        );
        if (needsPressureWasher && !capabilities?.has_pressure_washer) {
          console.log(`[Tech] ${tech.name}: EXCLUDED - requires pressure washer, tech doesn't have one`);
          continue;
        }
        
        // Roof safety check
        const needsRoofSafe = requestedServiceTypes.includes('roof_wash');
        if (needsRoofSafe && !capabilities?.is_roof_safe) {
          console.log(`[Tech] ${tech.name}: EXCLUDED - requires roof-safe certification`);
          continue;
        }
        
        // Generic capability tag exclusion (e.g., excluded_service_types: ["driveway", "house_wash"])
        const excludedTypes = capabilities?.excluded_service_types || [];
        if (excludedTypes.length > 0) {
          const blockedService = requestedServiceTypes.find(s => excludedTypes.includes(s));
          if (blockedService) {
            console.log(`[Tech] ${tech.name}: EXCLUDED - capability tag excludes service type '${blockedService}'`);
            continue;
          }
        }
        
        const startingAddress = tech.location_type === 'home' 
          ? tech.starting_address 
          : DRIVE_TIME_CONFIG.office_address;
        
        const workDays = (tech.work_days as number[]) || BUSINESS_HOURS.workDays;
        
        // Calculate skill score (average of requested service skill levels)
        const skillLevels = capabilities?.skill_levels || {};
        let totalSkill = 0;
        let skillCount = 0;
        for (const svcType of requestedServiceTypes) {
          const level = skillLevels[svcType] ?? 3; // Default to 3 (competent)
          totalSkill += level;
          skillCount++;
        }
        const avgSkill = skillCount > 0 ? totalSkill / skillCount : 3;
        // Skill multiplier: skill 5 = 1.15, skill 3 = 1.0, skill 1 = 0.85
        const skillScore = 0.85 + (avgSkill - 1) * 0.075;
        
        // Calculate preference bonus/penalty
        const preferred = capabilities?.preferred_services || [];
        const discouraged = capabilities?.discouraged_services || [];
        
        let preferenceBonus = 0;
        let discouragedPenalty = 0;
        for (const svcType of requestedServiceTypes) {
          if (preferred.includes(svcType)) preferenceBonus += 15;
          if (discouraged.includes(svcType)) discouragedPenalty += 20;
        }
          
        eligibleTechs.push({
          id: tech.id,
          jobberUserId: tech.jobber_user_id,
          name: tech.name,
          durationMinutes: totalDuration,
          startingAddress,
          locationType: tech.location_type,
          scheduleStartHour: tech.schedule_start_hour ?? BUSINESS_HOURS.startHour,
          scheduleEndHour: tech.schedule_end_hour ?? BUSINESS_HOURS.endHour,
          workDays,
          bufferMinutes: tech.buffer_minutes,
          maxDriveTimeMinutes: tech.max_drive_time_minutes,
          maxStories: tech.max_stories,
          capabilities,
          skillScore,
          preferenceBonus,
          discouragedPenalty,
        });
        
        console.log(`[Tech] ${tech.name}: duration=${totalDuration}min, skill=${avgSkill.toFixed(1)}, prefBonus=${preferenceBonus}, discPenalty=${discouragedPenalty}`);
      }
    }

    if (eligibleTechs.length === 0) {
      return new Response(
        JSON.stringify({ error: "No technicians can perform all selected services", slots: [], recommendations: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === BIG JOB DETECTION & TEAM BOOKING ===
    // Calculate solo hours for big job detection (use average of eligible tech durations)
    const avgSoloDuration = eligibleTechs.reduce((sum, t) => sum + t.durationMinutes, 0) / eligibleTechs.length;
    const estimatedSoloHours = avgSoloDuration / 60;
    
    // Determine if this is a big job based on trigger mode
    let isBigJob = false;
    let teamTriggerReason: 'price' | 'hours' | 'fits_in_day' | null = null;
    const workdayMinutes = (BIG_JOB_SETTINGS.workday_length_hours * 60) - BIG_JOB_SETTINGS.min_buffer_minutes;
    
    switch (BIG_JOB_SETTINGS.big_job_trigger_mode) {
      case 'PRICE_ONLY':
        if (totalJobPrice >= BIG_JOB_SETTINGS.big_job_value_threshold) {
          isBigJob = true;
          teamTriggerReason = 'price';
        }
        break;
      case 'HOURS_ONLY':
        if (BIG_JOB_SETTINGS.big_job_solo_hours_threshold && estimatedSoloHours >= BIG_JOB_SETTINGS.big_job_solo_hours_threshold) {
          isBigJob = true;
          teamTriggerReason = 'hours';
        }
        break;
      case 'PRICE_OR_HOURS':
        if (totalJobPrice >= BIG_JOB_SETTINGS.big_job_value_threshold) {
          isBigJob = true;
          teamTriggerReason = 'price';
        } else if (BIG_JOB_SETTINGS.big_job_solo_hours_threshold && estimatedSoloHours >= BIG_JOB_SETTINGS.big_job_solo_hours_threshold) {
          isBigJob = true;
          teamTriggerReason = 'hours';
        }
        break;
      case 'FITS_IN_DAY':
        // Big job if solo hours exceed available workday time
        if (avgSoloDuration > workdayMinutes) {
          isBigJob = true;
          teamTriggerReason = 'fits_in_day';
        }
        break;
    }

    // If auto-assign is disabled, don't use team booking
    if (!BIG_JOB_SETTINGS.auto_assign_two_techs) {
      isBigJob = false;
    }

    // Calculate team duration if big job
    let teamDurationMinutes = avgSoloDuration;
    let estimatedTeamHours = estimatedSoloHours;
    
    if (isBigJob && BIG_JOB_SETTINGS.crew_efficiency_factor > 0) {
      teamDurationMinutes = avgSoloDuration / BIG_JOB_SETTINGS.crew_efficiency_factor;
      estimatedTeamHours = teamDurationMinutes / 60;
    }

    // Filter eligible technicians for team pairing based on pairing mode
    let pairingEligibleTechs = eligibleTechs;
    if (isBigJob && BIG_JOB_SETTINGS.pairing_mode === 'RESTRICTED') {
      pairingEligibleTechs = eligibleTechs.filter(t => 
        t.capabilities?.eligible_for_big_job_pairing === true
      );
      console.log(`[Team] Restricted pairing: ${pairingEligibleTechs.length} of ${eligibleTechs.length} techs eligible`);
    }

    // Check if we have enough techs for team booking
    const canDoTeamBooking = isBigJob && pairingEligibleTechs.length >= 2;
    
    if (isBigJob && !canDoTeamBooking) {
      console.log(`[Team] Big job detected but only ${pairingEligibleTechs.length} eligible tech(s) - falling back to solo`);
    }

    console.log(`[Team] isBigJob: ${isBigJob}, trigger: ${teamTriggerReason || 'none'}, canDoTeam: ${canDoTeamBooking}, soloHours: ${estimatedSoloHours.toFixed(1)}, teamHours: ${estimatedTeamHours.toFixed(1)}`);

    // Calculate date range
    const now = new Date();
    let fromDate = startDate ? new Date(startDate) : now;

    // In dayGrid mode the client sends only `selectedDate` (no `startDate`).
    // Anchor the scan window to that day; otherwise fromDate defaults to `now`
    // and a 1-day window only ever covers today, so any future day is skipped
    // and returns zero slots. Noon UTC keeps the calendar date stable for the
    // America/Chicago business timezone.
    let filterToDate: Date | null = null;
    if (mode === 'dayGrid' && selectedDate) {
      const selectedDateStr = selectedDate.split('T')[0];
      fromDate = new Date(`${selectedDateStr}T12:00:00.000Z`);
      filterToDate = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const toDate = new Date(fromDate.getTime() + effectiveDaysToCheck * 24 * 60 * 60 * 1000);

    console.log(`[Availability] Date range: ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    // Fetch busy blocks from local mirror
    const techJobberIds = eligibleTechs.map(t => t.jobberUserId);
    const techIds = eligibleTechs.map(t => t.id);
    
    const [busyBlocksRes, scheduleBlocksRes] = await Promise.all([
      supabase
        .from("jobber_busy_blocks")
        .select("*")
        .in("crew_id", techJobberIds)
        .lt("start_at", toDate.toISOString())
        .gt("end_at", fromDate.toISOString())
        .in("status", ["scheduled", "in_progress"]),
      supabase
        .from("schedule_blocks")
        .select("*")
        .in("technician_id", techIds)
        .lt("start_at", toDate.toISOString())
        .gt("end_at", fromDate.toISOString())
    ]);

    // Active (unexpired) slot reservations temporarily hold a crew's time while
    // another customer completes checkout. Treat them as busy so two customers
    // can't be shown/booked into the same slot. Expired holds are excluded.
    const nowIso = new Date().toISOString();
    const reservationsRes = await supabase
      .from("slot_reservations")
      .select("crew_id, start_at, end_at, status, expires_at")
      .in("crew_id", techJobberIds)
      .lt("start_at", toDate.toISOString())
      .gt("end_at", fromDate.toISOString())
      .in("status", ["held", "confirmed"])
      .gt("expires_at", nowIso);
    const activeReservations = reservationsRes.data || [];
    if (reservationsRes.error) {
      console.warn("[Availability] Failed to load slot reservations:", reservationsRes.error.message);
    } else if (activeReservations.length > 0) {
      console.log(`[Availability] ${activeReservations.length} active slot reservation(s) treated as busy`);
    }

    if (busyBlocksRes.error) {
      console.error("[Availability] Failed to fetch busy blocks:", busyBlocksRes.error);
      return new Response(
        JSON.stringify({ error: "Failed to load schedule data", slots: [], recommendations: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const busyBlocks = busyBlocksRes.data || [];
    const scheduleBlocks = scheduleBlocksRes.data || [];

    console.log(`[Availability] Found ${busyBlocks.length} busy blocks, ${scheduleBlocks.length} schedule blocks`);

    // Fetch cached drive times if customer address provided
    const driveCache = new Map<string, number>();
    if (customerAddress) {
      const destHash = hashAddress(customerAddress);
      const { data: cachedTimes } = await supabase
        .from("drive_time_cache")
        .select("origin_hash, dest_hash, drive_minutes")
        .eq("dest_hash", destHash)
        .gt("expires_at", new Date().toISOString());
      
      if (cachedTimes) {
        for (const entry of cachedTimes as DriveCacheEntry[]) {
          driveCache.set(`${entry.origin_hash}|${entry.dest_hash}`, entry.drive_minutes);
        }
        console.log(`[DriveCache] Loaded ${cachedTimes.length} cached routes`);
      }
    }

    // Function to get drive time (cache or fallback)
    function getDriveTime(fromAddr: string | null, toAddr: string | null): number {
      const originHash = hashAddress(fromAddr);
      const destHash = hashAddress(toAddr);
      const cacheKey = `${originHash}|${destHash}`;
      
      if (driveCache.has(cacheKey)) {
        return driveCache.get(cacheKey)!;
      }
      
      return estimateDriveTimeFallback(fromAddr, toAddr);
    }

    // Build busy times per technician
    const busyTimesByTech: Record<string, Array<{ 
      start: Date; 
      end: Date;
      expandedStart: Date;
      expandedEnd: Date;
      address: string | null;
    }>> = {};

    const jobsByDate: Record<string, string[]> = {};

    for (const block of (busyBlocks || []) as BusyBlock[]) {
      const visitDate = formatDateInTimezone(new Date(block.start_at), businessTimezone);
      
      if (!jobsByDate[visitDate]) {
        jobsByDate[visitDate] = [];
      }
      if (block.client_address) {
        jobsByDate[visitDate].push(block.client_address);
      }

      if (!busyTimesByTech[block.crew_id]) {
        busyTimesByTech[block.crew_id] = [];
      }
      
      const blockStart = new Date(block.start_at);
      const blockEnd = new Date(block.end_at);
      
      const expandedStart = new Date(blockStart.getTime() - SLOT_GENERATION_CONFIG.bufferBeforeMinutes * 60 * 1000);
      const expandedEnd = new Date(blockEnd.getTime() + SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000);
      
      busyTimesByTech[block.crew_id].push({
        start: blockStart,
        end: blockEnd,
        expandedStart,
        expandedEnd,
        address: block.client_address,
      });
    }

    // Add admin schedule blocks (vacation, PTO, manual blocks) to busy times
    // Map tech ID to jobber user ID for consistent lookup
    const techIdToJobberId = new Map(eligibleTechs.map(t => [t.id, t.jobberUserId]));
    
    for (const block of scheduleBlocks) {
      const jobberUserId = techIdToJobberId.get(block.technician_id);
      if (!jobberUserId) continue;
      
      const visitDate = formatDateInTimezone(new Date(block.start_at), businessTimezone);
      
      if (!busyTimesByTech[jobberUserId]) {
        busyTimesByTech[jobberUserId] = [];
      }
      
      const blockStart = new Date(block.start_at);
      const blockEnd = new Date(block.end_at);
      
      // Schedule blocks have higher priority - no buffer reduction
      busyTimesByTech[jobberUserId].push({
        start: blockStart,
        end: blockEnd,
        expandedStart: blockStart, // Full block, no buffer
        expandedEnd: blockEnd,
        address: null, // No address for admin blocks
      });
      
      console.log(`[ScheduleBlock] Added ${block.block_category} block for tech ${block.technician_id}: ${block.start_at} - ${block.end_at}`);
    }

    // Merge active slot reservations (crew_id === jobber user id) as busy time.
    for (const resv of activeReservations as Array<{ crew_id: string; start_at: string; end_at: string }>) {
      if (!busyTimesByTech[resv.crew_id]) {
        busyTimesByTech[resv.crew_id] = [];
      }
      const blockStart = new Date(resv.start_at);
      const blockEnd = new Date(resv.end_at);
      const expandedStart = new Date(blockStart.getTime() - SLOT_GENERATION_CONFIG.bufferBeforeMinutes * 60 * 1000);
      const expandedEnd = new Date(blockEnd.getTime() + SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000);
      busyTimesByTech[resv.crew_id].push({
        start: blockStart,
        end: blockEnd,
        expandedStart,
        expandedEnd,
        address: null,
      });
    }

    // Track day metrics for fully-booked detection
    const dayMetrics: Map<string, DayMetrics> = new Map();
    const allSlots: TimeSlot[] = [];
    const excludedSlots: TimeSlot[] = [];

    // Generate candidates at 15-min resolution
    for (const tech of eligibleTechs) {
      const techBusyTimes = busyTimesByTech[tech.jobberUserId] || [];
      techBusyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());

      let dayOffset = 0;
      
      while (dayOffset < effectiveDaysToCheck) {
        const currentDay = new Date(fromDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const currentDateStr = formatDateInTimezone(currentDay, businessTimezone);
        
        // Skip if dayGrid mode and not the selected date
        if (mode === 'dayGrid' && selectedDate) {
          const selectedDateStr = selectedDate.split('T')[0];
          if (currentDateStr !== selectedDateStr) {
            dayOffset++;
            continue;
          }
        }
        
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: businessTimezone,
          weekday: 'short',
        });
        const weekdayStr = formatter.format(currentDay);
        const weekdayMap: Record<string, number> = {
          'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
        };
        const dayOfWeek = weekdayMap[weekdayStr] ?? 1;
        
        if (!tech.workDays.includes(dayOfWeek)) {
          dayOffset++;
          continue;
        }

        const dayStart = createDateInTimezone(currentDay, tech.scheduleStartHour, 0, businessTimezone);
        const dayEnd = createDateInTimezone(currentDay, tech.scheduleEndHour, 0, businessTimezone);

        if (dayEnd <= now) {
          dayOffset++;
          continue;
        }

        if (!dayMetrics.has(currentDateStr)) {
          dayMetrics.set(currentDateStr, {
            date: currentDay,
            dateStr: currentDateStr,
            totalSlots: 0,
            bookedJobs: jobsByDate[currentDateStr]?.length || 0,
            avgDriveEfficiency: 0,
            capacityUtilization: 0,
            jobAddresses: jobsByDate[currentDateStr] || [],
            hasAnySlot: false,
          });
        }

        let effectiveStart = new Date(dayStart);
        if (now > dayStart && now < dayEnd) {
          effectiveStart = new Date(now);
          const slotIncrement = SLOT_GENERATION_CONFIG.internalIncrementMinutes;
          const currentMinutes = effectiveStart.getMinutes();
          const roundedMinutes = Math.ceil(currentMinutes / slotIncrement) * slotIncrement;
          if (roundedMinutes === 60) {
            effectiveStart.setHours(effectiveStart.getHours() + 1, 0, 0, 0);
          } else {
            effectiveStart.setMinutes(roundedMinutes, 0, 0);
          }
        }

        // Include any block that OVERLAPS the work day, not only those that
        // start within it. Blocks beginning before the work-day start hour
        // (e.g. all-day "Day off" or early-morning jobs) must still block slots.
        const todayBusyTimes = techBusyTimes.filter(
          bt => blockOverlapsDay(bt.start, bt.end, dayStart, dayEnd)
        );
        
        const dayJobAddresses = jobsByDate[currentDateStr] || [];
        const hasEarlierJobToday = todayBusyTimes.some(bt => bt.start < effectiveStart);

        let slotStart = new Date(effectiveStart);
        const slotIncrementMs = SLOT_GENERATION_CONFIG.internalIncrementMinutes * 60 * 1000;
        
        while (slotStart.getTime() + tech.durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + tech.durationMinutes * 60 * 1000);
          const slotEndWithBuffer = new Date(slotEnd.getTime() + SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000);
          
          const slotHour = getHourInTimezone(slotStart, businessTimezone);
          
          // Check overlap (buffered slot window vs buffered busy window)
          const hasConflict = slotHasConflict(
            slotStart,
            slotEndWithBuffer,
            todayBusyTimes.map(bt => ({
              start: bt.start.getTime(),
              end: bt.end.getTime(),
              expandedStart: bt.expandedStart.getTime(),
              expandedEnd: bt.expandedEnd.getTime(),
            })),
          );

          const isFirstJob = !hasEarlierJobToday && 
            !todayBusyTimes.some(bt => bt.end <= slotStart);

          const previousAppointment = todayBusyTimes
            .filter(bt => bt.end <= slotStart)
            .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
          
          const nextAppointment = todayBusyTimes
            .filter(bt => bt.start >= slotEnd)
            .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

          const fromAddress = isFirstJob 
            ? tech.startingAddress 
            : previousAppointment?.address;
          const driveMinutes = getDriveTime(fromAddress || null, customerAddress || null);
          
          const routeDensity = calculateRouteDensityScore(
            slotStart,
            customerAddress || null,
            dayJobAddresses,
            previousAppointment?.address || null,
            nextAppointment?.address || null
          );
          
          const driveBuffer = getBufferForDriveTime(driveMinutes, DRIVE_TIME_CONFIG);
          
          // Calculate gap from previous appointment
          let gapMinutes = 0;
          if (previousAppointment) {
            const requiredStart = previousAppointment.end.getTime() + driveMinutes * 60 * 1000;
            gapMinutes = (slotStart.getTime() - requiredStart) / (60 * 1000);
          }
          
          // Gap scoring with route bonus
          const { score: gapScore, penalized, routeBonus, preferenceMatch } = calculateGapScore(
            gapMinutes, 
            preference as 'AM' | 'PM' | 'none',
            slotHour,
            tech.durationMinutes,
            driveMinutes
          );
          
          const displayTime = snapTo30Min(slotStart, businessTimezone);
          
          // Determine efficiency label based on gap score
          let gapEfficiencyLabel = '';
          if (gapScore >= 95) {
            gapEfficiencyLabel = 'Optimal timing';
          } else if (gapScore >= 80) {
            gapEfficiencyLabel = 'Efficient';
          } else if (routeBonus > 0) {
            gapEfficiencyLabel = 'Close to prior job';
          }
          
          // Calculate technician preference score
          const technicianScore = (tech.skillScore * 100) + tech.preferenceBonus - tech.discouragedPenalty;

          // Contiguous free-block bounds for schedule compaction. The block is
          // bounded by the buffered end of the previous appointment (or the
          // effective day start) and the buffered start of the next appointment
          // (or the work-day end). Slots already passed the conflict check, so
          // these bounds are consistent with the real Jobber busy windows.
          const compactionBufferAfterMs = SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000;
          const freeBlockStartMs = Math.max(
            effectiveStart.getTime(),
            previousAppointment ? previousAppointment.expandedEnd.getTime() : effectiveStart.getTime(),
          );
          const freeBlockEndMs = Math.min(
            dayEnd.getTime(),
            nextAppointment
              ? nextAppointment.expandedStart.getTime() - compactionBufferAfterMs
              : dayEnd.getTime(),
          );

          const slot: TimeSlot = {
            technicianId: tech.id,
            technicianName: tech.name,
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            displayTime,
            durationMinutes: tech.durationMinutes,
            estimatedDriveMinutes: driveMinutes,
            isFirstJob,
            routeDensityScore: routeDensity.score,
            routeDensityLabel: routeDensity.label,
            nearbyJobCount: routeDensity.nearbyJobCount,
            gapMinutes: Math.round(gapMinutes),
            gapScore,
            gapEfficiencyLabel,
            routeBonus,
            skillMultiplier: tech.skillScore,
            preferenceBonus: tech.preferenceBonus,
            discouragedPenalty: tech.discouragedPenalty,
            technicianScore,
            freeBlockStartMs,
            freeBlockEndMs,
          };

          let exclusionReason: ExclusionReason | null = null;

          // Strict AM/PM filtering - hard filter based on preference
          const isAM = slotHour < 12;
          const isPM = slotHour >= 12;
          
          if (preference === 'AM' && !isAM) {
            // Skip PM slots when AM is selected - hard filter
            slotStart = new Date(slotStart.getTime() + slotIncrementMs);
            continue;
          }
          
          if (preference === 'PM' && !isPM) {
            // Skip AM slots when PM is selected - hard filter
            slotStart = new Date(slotStart.getTime() + slotIncrementMs);
            continue;
          }

          if (hasConflict) {
            exclusionReason = {
              code: 'OVERLAP',
              message: 'Overlaps existing appointment',
            };
          } else if (slotHour < tech.scheduleStartHour) {
            exclusionReason = {
              code: 'BOUNDARY',
              message: 'Before work hours',
            };
          } else if (slotHour >= tech.scheduleEndHour - 1) {
            exclusionReason = {
              code: 'BOUNDARY',
              message: 'After work hours',
            };
          } else if (gapScore === 0) {
            exclusionReason = {
              code: 'GAP_PENALTY',
              message: 'Long job must start AM',
            };
          } else {
            const maxDriveTime = tech.maxDriveTimeMinutes ?? DRIVE_TIME_CONFIG.max_drive_time_minutes;
            
            if (driveMinutes > maxDriveTime) {
              if (isFirstJob && DRIVE_TIME_CONFIG.allow_long_first_drive) {
                slot.isLongFirstDrive = true;
              } else {
                exclusionReason = {
                  code: 'DRIVE_TIME',
                  message: 'Drive time too long',
                };
              }
            }
          }

          if (!exclusionReason && previousAppointment) {
            const actualGap = (slotStart.getTime() - previousAppointment.end.getTime()) / (60 * 1000);
            const baseBuffer = tech.bufferMinutes ?? DRIVE_TIME_CONFIG.base_buffer_minutes;
            const requiredBuffer = driveBuffer + baseBuffer;
            
            if (actualGap < requiredBuffer) {
              exclusionReason = {
                code: 'BUFFER',
                message: 'Insufficient buffer',
              };
            }
          }

          if (exclusionReason) {
            slot.excluded = true;
            slot.exclusionReason = exclusionReason;
            excludedSlots.push(slot);
          } else {
            allSlots.push(slot);
            const metrics = dayMetrics.get(currentDateStr)!;
            metrics.totalSlots++;
            metrics.hasAnySlot = true;
          }

          slotStart = new Date(slotStart.getTime() + slotIncrementMs);
        }

        dayOffset++;
      }
    }

    // === TEAM JOB SLOT GENERATION ===
    // If this is a big job and we can do team booking, generate team slots
    // Team slots require ALL assigned technicians to be free at the SAME time window
    const teamSlots: TimeSlot[] = [];
    
    if (canDoTeamBooking) {
      console.log(`[Team] Generating team slots with ${pairingEligibleTechs.length} eligible techs, teamDuration=${Math.round(teamDurationMinutes)}min`);
      
      // Create all possible pairs of eligible technicians
      const techPairs: Array<[typeof pairingEligibleTechs[0], typeof pairingEligibleTechs[0]]> = [];
      for (let i = 0; i < pairingEligibleTechs.length; i++) {
        for (let j = i + 1; j < pairingEligibleTechs.length; j++) {
          techPairs.push([pairingEligibleTechs[i], pairingEligibleTechs[j]]);
        }
      }
      
      console.log(`[Team] Generated ${techPairs.length} tech pairs`);
      
      // For each pair, find common available time windows
      for (const [tech1, tech2] of techPairs) {
        const tech1BusyTimes = busyTimesByTech[tech1.jobberUserId] || [];
        const tech2BusyTimes = busyTimesByTech[tech2.jobberUserId] || [];
        
        // Get common work days (intersection)
        const commonWorkDays = tech1.workDays.filter(d => tech2.workDays.includes(d));
        if (commonWorkDays.length === 0) {
          console.log(`[Team] ${tech1.name} + ${tech2.name}: no common work days`);
          continue;
        }
        
        // Use later start hour and earlier end hour for the pair
        const pairStartHour = Math.max(tech1.scheduleStartHour, tech2.scheduleStartHour);
        const pairEndHour = Math.min(tech1.scheduleEndHour, tech2.scheduleEndHour);
        
        if (pairEndHour - pairStartHour < teamDurationMinutes / 60) {
          console.log(`[Team] ${tech1.name} + ${tech2.name}: insufficient overlap in work hours`);
          continue;
        }
        
        let dayOffset = 0;
        
        while (dayOffset < effectiveDaysToCheck) {
          const currentDay = new Date(fromDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const currentDateStr = formatDateInTimezone(currentDay, businessTimezone);
          
          // Skip if dayGrid mode and not the selected date
          if (mode === 'dayGrid' && selectedDate) {
            const selectedDateStr = selectedDate.split('T')[0];
            if (currentDateStr !== selectedDateStr) {
              dayOffset++;
              continue;
            }
          }
          
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: businessTimezone,
            weekday: 'short',
          });
          const weekdayStr = formatter.format(currentDay);
          const weekdayMap: Record<string, number> = {
            'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
          };
          const dayOfWeek = weekdayMap[weekdayStr] ?? 1;
          
          if (!commonWorkDays.includes(dayOfWeek)) {
            dayOffset++;
            continue;
          }
          
          const dayStart = createDateInTimezone(currentDay, pairStartHour, 0, businessTimezone);
          const dayEnd = createDateInTimezone(currentDay, pairEndHour, 0, businessTimezone);
          
          if (dayEnd <= now) {
            dayOffset++;
            continue;
          }
          
          // Get busy times for both techs on this day (overlap-based so blocks
          // starting before the work-day start hour are still counted).
          const tech1DayBusy = tech1BusyTimes.filter(bt => bt.start < dayEnd && bt.end > dayStart);
          const tech2DayBusy = tech2BusyTimes.filter(bt => bt.start < dayEnd && bt.end > dayStart);
          
          let effectiveStart = new Date(dayStart);
          if (now > dayStart && now < dayEnd) {
            effectiveStart = new Date(now);
            const slotIncrement = SLOT_GENERATION_CONFIG.internalIncrementMinutes;
            const currentMinutes = effectiveStart.getMinutes();
            const roundedMinutes = Math.ceil(currentMinutes / slotIncrement) * slotIncrement;
            if (roundedMinutes === 60) {
              effectiveStart.setHours(effectiveStart.getHours() + 1, 0, 0, 0);
            } else {
              effectiveStart.setMinutes(roundedMinutes, 0, 0);
            }
          }
          
          let slotStart = new Date(effectiveStart);
          const slotIncrementMs = SLOT_GENERATION_CONFIG.internalIncrementMinutes * 60 * 1000;
          
          while (slotStart.getTime() + teamDurationMinutes * 60 * 1000 <= dayEnd.getTime()) {
            const slotEnd = new Date(slotStart.getTime() + teamDurationMinutes * 60 * 1000);
            const slotEndWithBuffer = new Date(slotEnd.getTime() + SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000);
            
            const slotHour = getHourInTimezone(slotStart, businessTimezone);
            
            // Check if BOTH technicians are free
            const tech1Conflict = tech1DayBusy.some(bt => 
              slotStart.getTime() < bt.expandedEnd.getTime() && slotEndWithBuffer.getTime() > bt.expandedStart.getTime()
            );
            const tech2Conflict = tech2DayBusy.some(bt => 
              slotStart.getTime() < bt.expandedEnd.getTime() && slotEndWithBuffer.getTime() > bt.expandedStart.getTime()
            );
            
            // AM/PM filtering for team slots
            const isAM = slotHour < 12;
            const isPM = slotHour >= 12;
            
            if ((preference === 'AM' && !isAM) || (preference === 'PM' && !isPM)) {
              slotStart = new Date(slotStart.getTime() + slotIncrementMs);
              continue;
            }
            
            // Only create slot if both techs are free
            if (!tech1Conflict && !tech2Conflict) {
              const displayTime = snapTo30Min(slotStart, businessTimezone);

              // Free-block bounds for the crew: bounded by the union of both
              // technicians' busy windows so team options are compacted too.
              const teamBufferAfterMs = SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000;
              const mergedBusy = [...tech1DayBusy, ...tech2DayBusy];
              const prevBusy = mergedBusy
                .filter((bt) => bt.end.getTime() <= slotStart.getTime())
                .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
              const nextBusy = mergedBusy
                .filter((bt) => bt.start.getTime() >= slotEnd.getTime())
                .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
              const teamFreeBlockStartMs = Math.max(
                effectiveStart.getTime(),
                prevBusy ? prevBusy.expandedEnd.getTime() : effectiveStart.getTime(),
              );
              const teamFreeBlockEndMs = Math.min(
                dayEnd.getTime(),
                nextBusy ? nextBusy.expandedStart.getTime() - teamBufferAfterMs : dayEnd.getTime(),
              );
              
              // Calculate combined skill score
              const avgSkillScore = (tech1.skillScore + tech2.skillScore) / 2;
              const combinedPrefBonus = (tech1.preferenceBonus + tech2.preferenceBonus) / 2;
              const combinedDiscPenalty = (tech1.discouragedPenalty + tech2.discouragedPenalty) / 2;
              const technicianScore = (avgSkillScore * 100) + combinedPrefBonus - combinedDiscPenalty;
              
              const teamSlot: TimeSlot = {
                technicianId: tech1.id, // Primary tech for booking
                technicianName: `${tech1.name} + ${tech2.name}`,
                startTime: slotStart.toISOString(),
                endTime: slotEnd.toISOString(),
                displayTime,
                durationMinutes: Math.round(teamDurationMinutes),
                isFirstJob: true,
                skillMultiplier: avgSkillScore,
                preferenceBonus: combinedPrefBonus,
                discouragedPenalty: combinedDiscPenalty,
                technicianScore,
                // Team booking fields
                isTeamJob: true,
                crewSize: 2,
                teamTechnicianIds: [tech1.id, tech2.id],
                teamTechnicianNames: [tech1.name, tech2.name],
                estimatedTeamHours,
                estimatedSoloHours,
                teamTriggerReason: teamTriggerReason || undefined,
                gapScore: 80, // Team jobs get a solid base score
                gapEfficiencyLabel: 'Team booking',
                freeBlockStartMs: teamFreeBlockStartMs,
                freeBlockEndMs: teamFreeBlockEndMs,
              };
              
              teamSlots.push(teamSlot);
              
              // Track for day metrics
              if (!dayMetrics.has(currentDateStr)) {
                dayMetrics.set(currentDateStr, {
                  date: currentDay,
                  dateStr: currentDateStr,
                  totalSlots: 0,
                  bookedJobs: 0,
                  avgDriveEfficiency: 0,
                  capacityUtilization: 0,
                  jobAddresses: [],
                  hasAnySlot: false,
                });
              }
              const metrics = dayMetrics.get(currentDateStr)!;
              metrics.totalSlots++;
              metrics.hasAnySlot = true;
            }
            
            slotStart = new Date(slotStart.getTime() + slotIncrementMs);
          }
          
          dayOffset++;
        }
      }
      
      console.log(`[Team] Generated ${teamSlots.length} team slots`);
      
      // For big jobs that can be team-booked, REPLACE solo slots with team slots
      // (Solo slots wouldn't fit in a workday anyway)
      if (teamSlots.length > 0) {
        allSlots.length = 0; // Clear solo slots
        allSlots.push(...teamSlots);
        console.log(`[Team] Replaced solo slots with ${teamSlots.length} team slots`);
      }
    }

    // Calculate fully booked days (no slots available for any tech)
    const fullyBookedDays: string[] = [];
    for (const [dateStr, metrics] of dayMetrics) {
      if (!metrics.hasAnySlot) {
        fullyBookedDays.push(dateStr);
      }
    }

    console.log(`[Availability] Generated ${allSlots.length} valid slots, ${fullyBookedDays.length} fully booked days`);

    // ===== SCHEDULE COMPACTION =====
    // Every slot in `allSlots` is already technically bookable (Jobber busy
    // blocks, buffers, working hours, blocked time and reservations were all
    // applied above). Compaction now decides which of those valid starts are
    // worth showing a customer so we don't surface a redundant row of near-
    // identical 15-minute starts that leave unusable schedule fragments. The
    // same compacted set is used by online booking, day/week/month browsing,
    // the AI chat (recommended mode) and rescheduling.
    const minViableGapUsed = computeMinViableGap(COMPACTION_CONFIG);
    const compactionResults = compactSlots(
      allSlots.map((s) => ({
        technicianId: s.technicianId,
        startMs: new Date(s.startTime).getTime(),
        endMs: new Date(s.endTime).getTime(),
        freeBlockStartMs: s.freeBlockStartMs ?? new Date(s.startTime).getTime(),
        freeBlockEndMs: s.freeBlockEndMs ?? new Date(s.endTime).getTime(),
        routeBonus: s.routeBonus,
        routeDensityScore: s.routeDensityScore,
      })),
      COMPACTION_CONFIG,
    );
    for (const r of compactionResults) {
      const s = allSlots[r.index];
      s.gapBeforeMinutes = r.gapBeforeMinutes;
      s.gapAfterMinutes = r.gapAfterMinutes;
      s.minViableGapMinutes = r.minViableGapMinutes;
      s.compactionScore = r.compactionScore;
      s.packsStart = r.packsStart;
      s.packsEnd = r.packsEnd;
      s.compactionShown = r.shown;
      s.compactionFilterReason = r.shown ? null : (r.filterReason ?? "redundant_interior");
    }
    // Customer-facing set (compacted) vs the valid-but-filtered set (admin only).
    const shownSlots = allSlots.filter((s) => s.compactionShown);
    const compactionFilteredSlots = allSlots.filter((s) => !s.compactionShown);
    console.log(
      `[Availability] Compaction: ${shownSlots.length} shown / ${compactionFilteredSlots.length} filtered ` +
        `(minViableGap=${minViableGapUsed}m, tolerance=${COMPACTION_CONFIG.boundaryGapToleranceMinutes}m, ` +
        `cap=${COMPACTION_CONFIG.maxCompactSlotsPerBlock}/block)`,
    );

    // Admin-only payload: raw technically-valid starts, which were shown vs
    // filtered, the filter reason, gap-before / gap-after, the minimum viable
    // gap used and the compaction score. Never returned to customers.
    const buildAdminPayload = () => {
      const toDebug = (s: TimeSlot) => ({
        technicianId: s.technicianId,
        technicianName: s.technicianName,
        startTime: s.startTime,
        endTime: s.endTime,
        displayTime: s.displayTime,
        durationMinutes: s.durationMinutes,
        shown: !!s.compactionShown,
        filterReason: s.compactionShown ? null : s.compactionFilterReason ?? null,
        gapBeforeMinutes: s.gapBeforeMinutes ?? null,
        gapAfterMinutes: s.gapAfterMinutes ?? null,
        minViableGapMinutes: s.minViableGapMinutes ?? null,
        compactionScore: s.compactionScore ?? null,
        packsStart: !!s.packsStart,
        packsEnd: !!s.packsEnd,
      });
      // Surface compaction-filtered (but technically valid) slots through the
      // existing "excluded" channel so admins can still override-book them.
      const compactionExcluded: TimeSlot[] = compactionFilteredSlots.map((s) => ({
        ...s,
        excluded: true,
        exclusionReason: {
          code: "COMPACTION",
          message: "Filtered to keep the schedule tight",
          details:
            `gapBefore ${s.gapBeforeMinutes ?? "?"}m / gapAfter ${s.gapAfterMinutes ?? "?"}m ` +
            `/ minViableGap ${s.minViableGapMinutes ?? "?"}m (${s.compactionFilterReason ?? "redundant"})`,
        },
      }));
      return {
        rawSlots: allSlots,
        excludedSlots: [...excludedSlots, ...compactionExcluded],
        compactionDebug: allSlots.map(toDebug),
        compactionConfig: {
          minimum_fillable_gap_minutes: COMPACTION_CONFIG.minimumFillableGapMinutes,
          boundary_gap_tolerance_minutes: COMPACTION_CONFIG.boundaryGapToleranceMinutes,
          max_compact_slots_per_block: COMPACTION_CONFIG.maxCompactSlotsPerBlock,
          shortest_fillable_service_minutes: COMPACTION_CONFIG.shortestFillableServiceMinutes ?? null,
          transition_buffer_minutes: COMPACTION_CONFIG.transitionBufferMinutes ?? 0,
          min_viable_gap_used_minutes: minViableGapUsed,
          allow_time_request_escalation: allowTimeRequestEscalation,
        },
      };
    };

    // Build response based on mode
    if (mode === 'dayGrid') {
      // Return only the COMPACTED slots for the selected date, deduped by
      // display time + technician (customer-facing browsing).
      const deduped = new Map<string, TimeSlot>();
      for (const slot of shownSlots) {
        const key = `${slot.displayTime}|${slot.technicianId}`;
        const existing = deduped.get(key);
        if (!existing || (slot.gapScore || 0) > (existing.gapScore || 0)) {
          deduped.set(key, slot);
        }
      }
      const dayGridSlots = Array.from(deduped.values()).sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );

      return new Response(
        JSON.stringify({
          mode: 'dayGrid',
          slots: dayGridSlots,
          totalAvailable: dayGridSlots.length,
          fullyBookedDays,
          ...(includeExcluded ? buildAdminPayload() : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Recommended mode: return top 3 candidates
    // Score and sort only the COMPACTED (customer-shown) slots so the ranked
    // recommendations, "best recommended", "next available" and the AI-chat
    // options can never surface a raw start time the website filters out.
    const scoredSlots = shownSlots.map(slot => {
      const slotDate = new Date(slot.startTime);
      const daysSinceNow = (slotDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      
      // Component scores
      const recencyScore = Math.max(0, 100 - daysSinceNow * 5); // Prefer sooner
      const gapScore = slot.gapScore || 50;
      const routeScore = slot.routeDensityScore || 50;
      const techScore = slot.technicianScore || 100; // Default to 100 (skill 3, no bonus/penalty)
      // Compaction score (schedule-efficiency): boundary-packing + route + low
      // fragmentation. Folded into ranking so "Best Recommended" prefers slots
      // that keep the overall schedule tight, not merely the chronologically
      // earliest slot when that would damage the rest of the day.
      const compactionScore = slot.compactionScore ?? 50;

      // Combined score. Compaction 30%, Gap 20%, Recency 25%, Route 10%, Tech 15%.
      const totalScore =
        (compactionScore * 0.30) +
        (gapScore * 0.20) +
        (recencyScore * 0.25) +
        (routeScore * 0.10) +
        (techScore * 0.15);

      return { ...slot, totalScore };
    });
    
    scoredSlots.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

    // ---- Surface a richer ranked view for the unified scheduler UI ----
    // De-duplicate near-identical entries (same display time + tech + day) so the
    // "best / next / more options" lists don't repeat themselves.
    const dedupedRanked: typeof scoredSlots = [];
    const seenRankKeys = new Set<string>();
    for (const slot of scoredSlots) {
      const dayStr = formatDateInTimezone(new Date(slot.startTime), businessTimezone);
      const key = `${slot.displayTime || slot.startTime}|${slot.technicianId}|${dayStr}`;
      if (seenRankKeys.has(key)) continue;
      seenRankKeys.add(key);
      dedupedRanked.push(slot);
    }

    // Best = highest combined score (gap/route/recency/tech weighted).
    const bestRecommended = dedupedRanked.length > 0
      ? { ...dedupedRanked[0], whyLabel: 'best_recommended', isRecommended: true }
      : null;

    // Next available = soonest slot by start time that still fits the service
    // (all generated slots already fit the required duration).
    const nextAvailable = dedupedRanked.length > 0
      ? (() => {
          const earliest = [...dedupedRanked].sort(
            (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
          )[0];
          return { ...earliest, whyLabel: 'soonest_available', isRecommended: true };
        })()
      : null;

    // Top ranked list (for "5 more options" without extra round-trips).
    const rankedSlots = dedupedRanked.slice(0, 12);
    
    // Get top 3 with diversity (different days/techs if possible)
    // IMPORTANT: Alternative MUST always be a different day
    const recommendations: TimeSlot[] = [];
    const usedDays = new Set<string>();
    const usedTechs = new Set<string>();
    const firstSlotDay = scoredSlots.length > 0 
      ? formatDateInTimezone(new Date(scoredSlots[0].startTime), businessTimezone)
      : null;
    
    for (const slot of scoredSlots) {
      if (recommendations.length >= 3) break;
      
      const slotDateStr = formatDateInTimezone(new Date(slot.startTime), businessTimezone);
      
      // First pick: best overall
      if (recommendations.length === 0) {
        slot.whyLabel = 'soonest_available';
        slot.isRecommended = true;
        recommendations.push(slot);
        usedDays.add(slotDateStr);
        usedTechs.add(slot.technicianId);
        continue;
      }
      
      // Second pick: try different day or tech, prioritize gap minimization
      if (recommendations.length === 1) {
        if (!usedDays.has(slotDateStr) || !usedTechs.has(slot.technicianId)) {
          slot.whyLabel = 'minimizes_gaps';
          slot.isRecommended = true;
          recommendations.push(slot);
          usedDays.add(slotDateStr);
          usedTechs.add(slot.technicianId);
          continue;
        }
      }
      
      // Third pick: alternative - MUST be a different day than the first slot
      if (recommendations.length === 2) {
        // Enforce different-day rule for alternatives
        if (slotDateStr !== firstSlotDay) {
          slot.whyLabel = 'alternative';
          slot.isRecommended = true;
          recommendations.push(slot);
          break;
        }
        // Skip same-day slots for alternative position
        continue;
      }
    }
    
    // Fill remaining if needed - but respect different-day rule for alternative
    for (const slot of scoredSlots) {
      if (recommendations.length >= 3) break;
      if (!recommendations.includes(slot)) {
        const slotDateStr = formatDateInTimezone(new Date(slot.startTime), businessTimezone);
        
        // Only add if we don't already have 2 recommendations OR it's a different day
        if (recommendations.length < 2 || slotDateStr !== firstSlotDay) {
          slot.whyLabel = 'alternative';
          slot.isRecommended = true;
          recommendations.push(slot);
        }
      }
    }
    
    console.log(`[Availability] Returning ${recommendations.length} recommendations`);
    
    // Detailed admin debug logging - score breakdown for each recommendation
    console.log(`[ADMIN DEBUG] Slot Score Breakdown:`);
    for (const rec of recommendations) {
      const recDate = formatDateInTimezone(new Date(rec.startTime), businessTimezone);
      console.log(`[ADMIN DEBUG] ──────────────────────────────`);
      console.log(`[ADMIN DEBUG] Slot: ${rec.technicianName} @ ${rec.displayTime} (${recDate})`);
      console.log(`[ADMIN DEBUG]   └─ whyLabel: ${rec.whyLabel}`);
      console.log(`[ADMIN DEBUG]   └─ gapMinutes: ${rec.gapMinutes}`);
      console.log(`[ADMIN DEBUG]   └─ gapScore: ${rec.gapScore}`);
      console.log(`[ADMIN DEBUG]   └─ driveMinutes: ${rec.estimatedDriveMinutes}`);
      console.log(`[ADMIN DEBUG]   └─ routeDensityScore: ${rec.routeDensityScore}`);
      console.log(`[ADMIN DEBUG]   └─ routeBonus: ${rec.routeBonus || 0}`);
      console.log(`[ADMIN DEBUG]   └─ gapEfficiencyLabel: ${rec.gapEfficiencyLabel || 'none'}`);
      console.log(`[ADMIN DEBUG]   └─ isFirstJob: ${rec.isFirstJob}`);
      console.log(`[ADMIN DEBUG]   └─ skillMultiplier: ${rec.skillMultiplier?.toFixed(2) || 'N/A'}`);
      console.log(`[ADMIN DEBUG]   └─ preferenceBonus: ${rec.preferenceBonus || 0}`);
      console.log(`[ADMIN DEBUG]   └─ discouragedPenalty: ${rec.discouragedPenalty || 0}`);
      console.log(`[ADMIN DEBUG]   └─ technicianScore: ${rec.technicianScore?.toFixed(1) || 'N/A'}`);
    }
    console.log(`[ADMIN DEBUG] ══════════════════════════════`);

    return new Response(
      JSON.stringify({
        mode: 'recommended',
        recommendations,
        bestRecommended,
        nextAvailable,
        rankedSlots,
        fullyBookedDays,
        totalAvailable: shownSlots.length,
        eligibleTechnicians: eligibleTechs.map(t => ({ 
          id: t.id, 
          name: t.name, 
          durationMinutes: t.durationMinutes 
        })),
        // Admin-only: customer-shown slots + raw availability + compaction
        // decisions/reasons/config (the inspector reads `slots`/`excludedSlots`).
        ...(includeExcluded ? { slots: shownSlots, ...buildAdminPayload() } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Availability error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Failed to check availability", 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
