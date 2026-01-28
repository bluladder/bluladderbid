import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  mode?: 'recommended' | 'dayGrid'; // New mode param
  preference?: 'AM' | 'PM' | 'none'; // Time preference
  selectedDate?: string; // For dayGrid mode
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

interface ExclusionReason {
  code: 'OVERLAP' | 'DRIVE_TIME' | 'BUFFER' | 'BOUNDARY' | 'LAST_JOB' | 'GAP_PENALTY';
  message: string;
  details?: string;
}

interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  displayTime?: string; // 30-min snapped time for UI
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
  // Scoring/dispatch fields
  gapMinutes?: number;
  gapScore?: number;
  gapEfficiencyLabel?: string; // "Optimal timing", "Efficient", "Close to prior job"
  routeBonus?: number;
  whyLabel?: string; // "soonest_available", "minimizes_gaps", "alternative"
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
  hasAnySlot: boolean; // Track if ANY slot fits
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

// Configurable slot generation settings
const SLOT_GENERATION_CONFIG = {
  internalIncrementMinutes: 15, // Generate at 15-min resolution
  displayIncrementMinutes: 30,  // Display snapped to 30-min
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
};

// Gap-scoring constants (configurable dispatch-smart settings)
const GAP_SCORING = {
  idealGapMax: 15,            // 0-15 min gap is ideal (score 100)
  goodGapMax: 30,             // 16-30 min gap is still good (score 85)
  microGapThreshold: 60,      // < 60 min gap is "micro" and penalized
  longJobMinutes: 480,        // 8 hours - must start AM
  mediumJobMinutes: 240,      // 4 hours - strongly prefer AM
  routeProximityBonus: 15,    // Bonus for <12 min drive from previous job
  routeProximityThreshold: 12, // Minutes - if drive < this, apply bonus
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

// Snap time to 30-min display increments
function snapTo30Min(date: Date, timezone: string): string {
  const hour = getHourInTimezone(date, timezone);
  const minutes = getMinutesInTimezone(date, timezone);
  const snappedMinutes = Math.round(minutes / 30) * 30;
  
  let displayHour = hour;
  let displayMin = snappedMinutes;
  
  if (snappedMinutes >= 60) {
    displayHour = hour + 1;
    displayMin = 0;
  }
  
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

    const businessTimezone = BUSINESS_HOURS.timezone || DEFAULT_BUSINESS_HOURS.timezone;
    console.log(`[Availability] Mode: ${mode}, Preference: ${preference}, Timezone: ${businessTimezone}`);

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

    // Get all active technicians with their rates
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

    // Calculate duration for each technician
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
    }> = [];

    for (const tech of technicians) {
      let totalDuration = 0;
      let canPerformAll = true;

      for (const svc of services) {
        const serviceType = serviceTypeMap[svc.service] || svc.service;
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
        const startingAddress = tech.location_type === 'home' 
          ? tech.starting_address 
          : DRIVE_TIME_CONFIG.office_address;
        
        const workDays = (tech.work_days as number[]) || BUSINESS_HOURS.workDays;
          
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
        });
        
        console.log(`[Tech] ${tech.name}: duration=${totalDuration}min, hours=${tech.schedule_start_hour || BUSINESS_HOURS.startHour}-${tech.schedule_end_hour || BUSINESS_HOURS.endHour}, days=${JSON.stringify(workDays)}`);
      }
    }

    if (eligibleTechs.length === 0) {
      return new Response(
        JSON.stringify({ error: "No technicians can perform all selected services", slots: [], recommendations: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate date range
    const now = new Date();
    const fromDate = startDate ? new Date(startDate) : now;
    const toDate = new Date(fromDate.getTime() + effectiveDaysToCheck * 24 * 60 * 60 * 1000);

    // For dayGrid mode with specific date, narrow the range
    let filterToDate: Date | null = null;
    if (mode === 'dayGrid' && selectedDate) {
      const selDate = new Date(selectedDate);
      filterToDate = new Date(selDate.getTime() + 24 * 60 * 60 * 1000);
    }

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

        const todayBusyTimes = techBusyTimes.filter(
          bt => bt.start >= dayStart && bt.start < dayEnd
        );
        
        const dayJobAddresses = jobsByDate[currentDateStr] || [];
        const hasEarlierJobToday = todayBusyTimes.some(bt => bt.start < effectiveStart);

        let slotStart = new Date(effectiveStart);
        const slotIncrementMs = SLOT_GENERATION_CONFIG.internalIncrementMinutes * 60 * 1000;
        
        while (slotStart.getTime() + tech.durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + tech.durationMinutes * 60 * 1000);
          const slotEndWithBuffer = new Date(slotEnd.getTime() + SLOT_GENERATION_CONFIG.bufferAfterMinutes * 60 * 1000);
          
          const slotHour = getHourInTimezone(slotStart, businessTimezone);
          
          // Check overlap
          const hasConflict = todayBusyTimes.some(bt => 
            (slotStart.getTime() < bt.expandedEnd.getTime() && slotEndWithBuffer.getTime() > bt.expandedStart.getTime())
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

    // Calculate fully booked days (no slots available for any tech)
    const fullyBookedDays: string[] = [];
    for (const [dateStr, metrics] of dayMetrics) {
      if (!metrics.hasAnySlot) {
        fullyBookedDays.push(dateStr);
      }
    }

    console.log(`[Availability] Generated ${allSlots.length} valid slots, ${fullyBookedDays.length} fully booked days`);

    // Build response based on mode
    if (mode === 'dayGrid') {
      // Return all slots for the selected date, snapped to 30-min display
      const deduped = new Map<string, TimeSlot>();
      
      for (const slot of allSlots) {
        // Dedupe by display time + technician
        const key = `${slot.displayTime}|${slot.technicianId}`;
        const existing = deduped.get(key);
        
        if (!existing || (slot.gapScore || 0) > (existing.gapScore || 0)) {
          deduped.set(key, slot);
        }
      }
      
      const dayGridSlots = Array.from(deduped.values()).sort((a, b) => {
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
      
      return new Response(
        JSON.stringify({
          mode: 'dayGrid',
          slots: dayGridSlots,
          totalAvailable: dayGridSlots.length,
          fullyBookedDays,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Recommended mode: return top 3 candidates
    // Score and sort all slots
    const scoredSlots = allSlots.map(slot => {
      const slotDate = new Date(slot.startTime);
      const daysSinceNow = (slotDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      
      // Combined score: gap minimization + recency + route density
      const recencyScore = Math.max(0, 100 - daysSinceNow * 5); // Prefer sooner
      const gapScore = slot.gapScore || 50;
      const routeScore = slot.routeDensityScore || 50;
      
      const totalScore = (gapScore * 0.4) + (recencyScore * 0.35) + (routeScore * 0.25);
      
      return { ...slot, totalScore };
    });
    
    scoredSlots.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    
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
    }
    console.log(`[ADMIN DEBUG] ══════════════════════════════`);

    return new Response(
      JSON.stringify({
        mode: 'recommended',
        recommendations,
        fullyBookedDays,
        totalAvailable: allSlots.length,
        eligibleTechnicians: eligibleTechs.map(t => ({ 
          id: t.id, 
          name: t.name, 
          durationMinutes: t.durationMinutes 
        })),
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
