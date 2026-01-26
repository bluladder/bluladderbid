import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------- Jobber throttling + cache (fail-closed, but avoid hard downtime) ----------------
// If Jobber rate-limits us, we:
// 1) enter a short cooldown to avoid repeatedly triggering throttling
// 2) if we have a recent cached visits payload that covers the requested range, we use it
let lastJobberThrottleAtMs: number | null = null;
const JOBBER_THROTTLE_COOLDOWN_MS = 60_000; // 60s
const JOBBER_VISITS_CACHE_TTL_MS = 2 * 60_000; // 2 minutes

let lastJobberAuthErrorAtMs: number | null = null;
const JOBBER_AUTH_COOLDOWN_MS = 5 * 60_000; // 5 minutes

type JobberVisitResult = {
  visits: {
    nodes: Array<{
      id: string;
      startAt: string;
      endAt: string;
      assignedUsers: {
        nodes: Array<{ id: string }>;
      };
      job?: {
        property?: {
          address?: {
            street?: string;
            city?: string;
            province?: string;
            postalCode?: string;
          };
        };
      };
    }>;
  };
};

type JobberGraphQLError = { message: string; extensions?: { code?: string } };
type JobberGraphQLResult<T> = { data?: T; errors?: JobberGraphQLError[] };

let jobberVisitsCache: {
  fromISO: string;
  toISO: string;
  fetchedAtMs: number;
  data: JobberVisitResult;
} | null = null;

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
  includeExcluded?: boolean; // Admin mode to see hidden slots
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
  code: 'OVERLAP' | 'DRIVE_TIME' | 'BUFFER' | 'BOUNDARY' | 'LAST_JOB';
  message: string;
  details?: string;
}

interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isRecommended?: boolean;
  estimatedDriveMinutes?: number;
  isFirstJob?: boolean;
  isLongFirstDrive?: boolean;
  // Route-density scoring
  routeDensityScore?: number;
  routeDensityLabel?: string;
  nearbyJobCount?: number;
  // For admin visibility
  excluded?: boolean;
  exclusionReason?: ExclusionReason;
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
}

// Default business hours (used if not configured in database)
const DEFAULT_BUSINESS_HOURS = {
  startHour: 9,
  endHour: 17,
  workDays: [1, 2, 3, 4, 5, 6],
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

// Get hour in timezone
function getHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  return parseInt(parts.find(p => p.type === 'hour')?.value || '0');
}

// Format date string for a given timezone
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

// Get weekday name for a date in a timezone
function getWeekdayInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  });
  return formatter.format(date);
}

// Extract city from address for zone matching
function extractZone(address: string | null): string {
  if (!address) return 'unknown';
  // Simple extraction - get city or first significant part
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    return parts[1].toLowerCase(); // Usually city
  }
  return parts[0].toLowerCase().substring(0, 20);
}

// Calculate rough distance score between two addresses (0-100, 100 = same zone)
function calculateProximityScore(addr1: string | null, addr2: string | null): number {
  if (!addr1 || !addr2) return 50; // Unknown addresses get neutral score
  
  const zone1 = extractZone(addr1);
  const zone2 = extractZone(addr2);
  
  // Same city = high score
  if (zone1 === zone2) return 100;
  
  // Check if they share any significant words
  const words1 = zone1.split(/\s+/);
  const words2 = zone2.split(/\s+/);
  const commonWords = words1.filter(w => words2.includes(w) && w.length > 3);
  
  if (commonWords.length > 0) return 75;
  
  return 30; // Different zones
}

// Estimate drive time between two addresses (simplified - returns 5-45 min range)
// In production, integrate with Google Maps Distance Matrix API
function estimateDriveTime(fromAddress: string | null, toAddress: string | null): number {
  if (!fromAddress || !toAddress) {
    return 15; // Default estimate when addresses unknown
  }
  
  // Check if same zone for reduced drive time
  const proximity = calculateProximityScore(fromAddress, toAddress);
  if (proximity >= 100) return 8; // Same city
  if (proximity >= 75) return 18; // Nearby
  
  // Hash-based pseudo-random but consistent value
  const hash = (fromAddress + toAddress).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return 15 + Math.abs(hash % 30); // 15-45 minutes
}

// Get buffer for drive time based on tiers
function getBufferForDriveTime(driveMinutes: number, config: DriveTimeConfig): number {
  for (const tier of config.buffer_tiers) {
    if (driveMinutes >= tier.min_drive && driveMinutes < tier.max_drive) {
      return tier.buffer;
    }
  }
  // If beyond all tiers, use the last tier's buffer
  const lastTier = config.buffer_tiers[config.buffer_tiers.length - 1];
  return lastTier?.buffer || config.base_buffer_minutes;
}

// Calculate route density score for a slot
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
  
  // Count nearby jobs (same zone)
  const customerZone = extractZone(customerAddress);
  const nearbyJobs = dayJobAddresses.filter(addr => {
    const jobZone = extractZone(addr);
    return jobZone === customerZone;
  });
  
  let score = 50; // Base score
  
  // Boost for same-zone jobs
  score += Math.min(nearbyJobs.length * 15, 40);
  
  // Boost for adjacent job proximity
  if (previousJobAddress) {
    const prevProximity = calculateProximityScore(customerAddress, previousJobAddress);
    score += (prevProximity - 50) * 0.2;
  }
  if (nextJobAddress) {
    const nextProximity = calculateProximityScore(customerAddress, nextJobAddress);
    score += (nextProximity - 50) * 0.2;
  }
  
  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));
  
  // Determine label based on score
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
      includeExcluded = false 
    }: AvailabilityRequest = await req.json();

    if (!services || services.length === 0) {
      return new Response(
        JSON.stringify({ error: "No services provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    console.log("Using timezone:", businessTimezone);
    console.log("Drive time config:", DRIVE_TIME_CONFIG);

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

    // Get all active technicians with their rates and locations
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
        JSON.stringify({ error: "No technicians available", slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found technicians:", technicians.length);

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
        // Determine starting address
        const startingAddress = tech.location_type === 'home' 
          ? tech.starting_address 
          : DRIVE_TIME_CONFIG.office_address;
        
        // Get per-technician work days
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
      }
    }

    if (eligibleTechs.length === 0) {
      return new Response(
        JSON.stringify({ error: "No technicians can perform all selected services", slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate date range
    const now = new Date();
    const fromDate = startDate ? new Date(startDate) : now;
    const toDate = new Date(fromDate.getTime() + daysToCheck * 24 * 60 * 60 * 1000);

    // Format dates for Jobber query (ISO8601DateTime)
    const fromDateISO = fromDate.toISOString();
    const toDateISO = toDate.toISOString();
    
    console.log(`Querying Jobber visits from ${fromDateISO} to ${toDateISO}`);

    // Query Jobber for scheduled visits with property addresses
    const scheduledItemsQuery = `
      query GetScheduledItems($startDateAfter: ISO8601DateTime!, $startDateBefore: ISO8601DateTime!) {
        visits(first: 200, filter: { startAt: { after: $startDateAfter, before: $startDateBefore } }) {
          nodes {
            id
            startAt
            endAt
            assignedUsers {
              nodes {
                id
              }
            }
            job {
              property {
                address {
                  street
                  city
                  province
                  postalCode
                }
              }
            }
          }
        }
      }
    `;

    // Fetch visits from Jobber with:
    // - cooldown when throttled (reduces repeated throttle hits)
    // - short-lived in-memory cache fallback (keeps availability working without showing "all slots")
    const nowMs = Date.now();
    const cacheFresh = !!jobberVisitsCache && (nowMs - jobberVisitsCache.fetchedAtMs) < JOBBER_VISITS_CACHE_TTL_MS;
    const cacheCoversRange =
      cacheFresh &&
      !!jobberVisitsCache &&
      jobberVisitsCache.fromISO <= fromDateISO &&
      jobberVisitsCache.toISO >= toDateISO;

    const inCooldown =
      lastJobberThrottleAtMs !== null &&
      (nowMs - lastJobberThrottleAtMs) < JOBBER_THROTTLE_COOLDOWN_MS;

    const retryAfterSec = inCooldown && lastJobberThrottleAtMs !== null
      ? Math.max(1, Math.ceil((JOBBER_THROTTLE_COOLDOWN_MS - (nowMs - lastJobberThrottleAtMs)) / 1000))
      : 30;

    const inAuthCooldown =
      lastJobberAuthErrorAtMs !== null &&
      (nowMs - lastJobberAuthErrorAtMs) < JOBBER_AUTH_COOLDOWN_MS;

    let jobberResult: JobberGraphQLResult<JobberVisitResult> | null = null;

    if (inCooldown) {
      if (cacheCoversRange) {
        console.log(
          `Jobber throttling cooldown active; using cached visits (${Math.round((nowMs - jobberVisitsCache!.fetchedAtMs) / 1000)}s old)`
        );
        jobberResult = { data: jobberVisitsCache!.data };
      } else {
        console.error("Jobber throttling cooldown active and no usable cache - returning 503");
        return new Response(
          JSON.stringify({
            error: "Scheduling system is temporarily busy. Please try again in a few moments.",
            retryAfter: retryAfterSec,
            slots: [],
            recommendedDays: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
        );
      }
    } else {
      if (inAuthCooldown) {
        return new Response(
          JSON.stringify({
            error: "Scheduling connection needs admin re-authentication. Please reconnect in Admin → Jobber Integration.",
            code: "JOBBER_AUTH",
            retryAfter: Math.max(60, Math.ceil((JOBBER_AUTH_COOLDOWN_MS - (nowMs - lastJobberAuthErrorAtMs!)) / 1000)),
            requiresAdminAction: true,
            slots: [],
            recommendedDays: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
        );
      }

      console.log("Jobber API attempt 1/1");
      jobberResult = await jobberGraphQL<JobberVisitResult>(scheduledItemsQuery, {
        startDateAfter: fromDateISO,
        startDateBefore: toDateISO,
      });

      const isThrottled = jobberResult.errors?.some((e) =>
        e.extensions?.code === "THROTTLED" || e.message?.includes("Throttled")
      );

      if (isThrottled) {
        lastJobberThrottleAtMs = nowMs;
        if (cacheCoversRange) {
          console.log("Jobber throttled; falling back to cached visits");
          jobberResult = { data: jobberVisitsCache!.data };
        } else {
          console.error("Jobber API throttled and no usable cache - returning 503 to prevent conflicts");
          return new Response(
            JSON.stringify({
              error: "Scheduling system is temporarily busy. Please try again in a few moments.",
              retryAfter: Math.max(30, retryAfterSec),
              slots: [],
              recommendedDays: [],
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
          );
        }
      } else {
        // If we have any non-throttle errors, fail closed (do not show availability that could conflict)
        if (jobberResult.errors && jobberResult.errors.length > 0) {
          const isAuthError = jobberResult.errors.some((e) =>
            (e.message || "").toLowerCase().includes("no valid jobber access token") ||
            (e.message || "").toLowerCase().includes("unauthorized") ||
            (e.message || "").toLowerCase().includes("invalid")
          );

          if (isAuthError) {
            lastJobberAuthErrorAtMs = nowMs;
            console.error("Jobber auth error - admin re-authentication required:", jobberResult.errors);
            return new Response(
              JSON.stringify({
                error: "Scheduling connection needs admin re-authentication. Please reconnect in Admin → Jobber Integration.",
                code: "JOBBER_AUTH",
                retryAfter: 300,
                requiresAdminAction: true,
                slots: [],
                recommendedDays: [],
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
            );
          }

          console.error("Jobber API error (non-throttle) - failing closed:", jobberResult.errors);
          return new Response(
            JSON.stringify({
              error: "Scheduling system is temporarily unavailable. Please try again shortly.",
              code: "JOBBER_ERROR",
              retryAfter: 60,
              slots: [],
              recommendedDays: [],
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
          );
        }

        // On success, update cache (even if it is an empty array of visits)
        if (jobberResult.data?.visits?.nodes) {
          jobberVisitsCache = {
            fromISO: fromDateISO,
            toISO: toDateISO,
            fetchedAtMs: nowMs,
            data: jobberResult.data,
          };
        }
      }
    }

    // Build a map of busy times per technician with addresses
    const busyTimesByTech: Record<string, Array<{ 
      start: Date; 
      end: Date;
      address: string | null;
    }>> = {};

    // Track jobs by date for route density analysis
    const jobsByDate: Record<string, string[]> = {}; // dateStr -> addresses

    const techJobberIds = eligibleTechs.map(t => t.jobberUserId);
    console.log("Looking for Jobber User IDs:", techJobberIds);

    if (jobberResult?.data?.visits?.nodes) {
      const visits = jobberResult.data.visits.nodes;
      console.log(`Processing ${visits.length} visits for conflict detection`);
      
      for (const visit of visits) {
        const users = visit.assignedUsers?.nodes || [];
        const userIds = users.map(u => u.id);
        console.log(`Visit ${visit.id}: ${visit.startAt} - ${visit.endAt}, assigned to users: ${JSON.stringify(userIds)}`);
        
        const addr = visit.job?.property?.address;
        const address = addr 
          ? `${addr.street || ''}, ${addr.city || ''}, ${addr.province || ''} ${addr.postalCode || ''}`.trim()
          : null;
        
        // Track job addresses by date for route density
        const visitDate = formatDateInTimezone(new Date(visit.startAt), businessTimezone);
        if (!jobsByDate[visitDate]) {
          jobsByDate[visitDate] = [];
        }
        if (address) {
          jobsByDate[visitDate].push(address);
        }
          
        for (const user of users) {
          const matchesTech = techJobberIds.includes(user.id);
          if (matchesTech) {
            console.log(`  -> User ${user.id} MATCHES technician - marking as busy from ${visit.startAt} to ${visit.endAt}`);
          }
          
          if (!busyTimesByTech[user.id]) {
            busyTimesByTech[user.id] = [];
          }
          busyTimesByTech[user.id].push({
            start: new Date(visit.startAt),
            end: new Date(visit.endAt),
            address,
          });
        }
      }
      
      console.log("Busy times summary:", Object.entries(busyTimesByTech).map(([id, times]) => ({
        jobberUserId: id,
        busyCount: times.length,
        times: times.map(t => `${t.start.toISOString()} - ${t.end.toISOString()}`)
      })));
      console.log("Jobs by date:", Object.entries(jobsByDate).map(([date, addrs]) => ({
        date,
        jobCount: addrs.length
      })));
    } else {
      console.log("No visits returned from Jobber - calendar appears empty for date range");
    }

    // Track day metrics for recommended days calculation
    const dayMetrics: Map<string, DayMetrics> = new Map();

    // Generate available slots for each eligible technician
    const allSlots: TimeSlot[] = [];
    const excludedSlots: TimeSlot[] = [];

    for (const tech of eligibleTechs) {
      const techBusyTimes = busyTimesByTech[tech.jobberUserId] || [];
      techBusyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());

      let dayOffset = 0;
      
      while (dayOffset < daysToCheck) {
        const currentDay = new Date(fromDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const currentDateStr = formatDateInTimezone(currentDay, businessTimezone);
        
        // Get day of week in business timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: businessTimezone,
          weekday: 'short',
        });
        const weekdayStr = formatter.format(currentDay);
        const weekdayMap: Record<string, number> = {
          'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
        };
        const dayOfWeek = weekdayMap[weekdayStr] ?? 1;
        
        // Use per-technician work days
        if (!tech.workDays.includes(dayOfWeek)) {
          dayOffset++;
          continue;
        }

        // Use per-technician schedule hours
        const dayStart = createDateInTimezone(currentDay, tech.scheduleStartHour, 0, businessTimezone);
        const dayEnd = createDateInTimezone(currentDay, tech.scheduleEndHour, 0, businessTimezone);

        if (dayEnd <= now) {
          dayOffset++;
          continue;
        }

        // Initialize day metrics if needed
        if (!dayMetrics.has(currentDateStr)) {
          dayMetrics.set(currentDateStr, {
            date: currentDay,
            dateStr: currentDateStr,
            totalSlots: 0,
            bookedJobs: jobsByDate[currentDateStr]?.length || 0,
            avgDriveEfficiency: 0,
            capacityUtilization: 0,
            jobAddresses: jobsByDate[currentDateStr] || [],
          });
        }

        let effectiveStart = new Date(dayStart);
        if (now > dayStart && now < dayEnd) {
          effectiveStart = new Date(now);
          const currentMinutes = effectiveStart.getMinutes();
          const roundedMinutes = Math.ceil(currentMinutes / 30) * 30;
          if (roundedMinutes === 60) {
            effectiveStart.setHours(effectiveStart.getHours() + 1, 0, 0, 0);
          } else {
            effectiveStart.setMinutes(roundedMinutes, 0, 0);
          }
        }

        // Get busy times for this day
        const todayBusyTimes = techBusyTimes.filter(
          bt => bt.start >= dayStart && bt.start < dayEnd
        );
        
        // Get day's job addresses for route density
        const dayJobAddresses = jobsByDate[currentDateStr] || [];

        // Check if this is the first job of the day
        const hasEarlierJobToday = todayBusyTimes.some(bt => bt.start < effectiveStart);

        // Generate slots
        let slotStart = new Date(effectiveStart);
        
        while (slotStart.getTime() + tech.durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + tech.durationMinutes * 60 * 1000);
          const slotHour = getHourInTimezone(slotStart, businessTimezone);
          
          // Check for overlap
          const hasConflict = todayBusyTimes.some(bt => 
            (slotStart < bt.end && slotEnd > bt.start)
          );

          // Determine if this is first job
          const isFirstJob = !hasEarlierJobToday && 
            !todayBusyTimes.some(bt => bt.end <= slotStart);

          // Get previous and next appointments (for route density calculation)
          const previousAppointment = todayBusyTimes
            .filter(bt => bt.end <= slotStart)
            .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
          
          const nextAppointment = todayBusyTimes
            .filter(bt => bt.start >= slotEnd)
            .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

          // Calculate drive time
          const fromAddress = isFirstJob 
            ? tech.startingAddress 
            : previousAppointment?.address;
          const driveMinutes = estimateDriveTime(fromAddress || null, customerAddress || null);
          
    // Calculate route density score
    const routeDensity = calculateRouteDensityScore(
      slotStart,
      customerAddress || null,
      dayJobAddresses,
      previousAppointment?.address || null,
      nextAppointment?.address || null
    );
          
          // Get buffer based on drive time
          const driveBuffer = getBufferForDriveTime(driveMinutes, DRIVE_TIME_CONFIG);
          
          // Build slot object
          const slot: TimeSlot = {
            technicianId: tech.id,
            technicianName: tech.name,
            startTime: slotStart.toISOString(),
            endTime: slotEnd.toISOString(),
            durationMinutes: tech.durationMinutes,
            estimatedDriveMinutes: driveMinutes,
            isFirstJob,
            routeDensityScore: routeDensity.score,
            routeDensityLabel: routeDensity.label,
            nearbyJobCount: routeDensity.nearbyJobCount,
          };

          // Check exclusion reasons
          let exclusionReason: ExclusionReason | null = null;

          if (hasConflict) {
            exclusionReason = {
              code: 'OVERLAP',
              message: 'Overlaps existing appointment',
            };
          } else if (slotHour < tech.scheduleStartHour) {
            exclusionReason = {
              code: 'BOUNDARY',
              message: 'Before earliest start time',
              details: `Slot starts at ${slotHour}:00, earliest allowed is ${tech.scheduleStartHour}:00`,
            };
          } else if (slotHour >= tech.scheduleEndHour - 1) {
            exclusionReason = {
              code: 'BOUNDARY',
              message: 'After latest start time',
              details: `Slot starts at ${slotHour}:00, latest allowed is ${tech.scheduleEndHour - 1}:00`,
            };
          } else {
            // Use per-technician max drive time or fall back to global
            const maxDriveTime = tech.maxDriveTimeMinutes ?? DRIVE_TIME_CONFIG.max_drive_time_minutes;
            
            if (driveMinutes > maxDriveTime) {
              // Check if first job exception applies
              if (isFirstJob && DRIVE_TIME_CONFIG.allow_long_first_drive) {
                slot.isLongFirstDrive = true;
              } else {
                exclusionReason = {
                  code: 'DRIVE_TIME',
                  message: 'Exceeds drive time limit',
                  details: `${driveMinutes} min drive exceeds ${maxDriveTime} min max`,
                };
              }
            }
          }

          // Check last job rules
          const isLikelyLastJob = !todayBusyTimes.some(bt => bt.start > slotEnd);
          if (isLikelyLastJob && !exclusionReason) {
            const maxDriveTime = tech.maxDriveTimeMinutes ?? DRIVE_TIME_CONFIG.max_drive_time_minutes;
            
            if (DRIVE_TIME_CONFIG.no_long_last_drive && driveMinutes > maxDriveTime) {
              exclusionReason = {
                code: 'LAST_JOB',
                message: 'Long drive not allowed for last job',
                details: `${driveMinutes} min drive too long for last job of day`,
              };
            }
          }

          // Check buffer timing
          if (!exclusionReason && previousAppointment) {
            const gapMinutes = (slotStart.getTime() - previousAppointment.end.getTime()) / (60 * 1000);
            const baseBuffer = tech.bufferMinutes ?? DRIVE_TIME_CONFIG.base_buffer_minutes;
            const requiredBuffer = driveBuffer + baseBuffer;
            
            if (gapMinutes < requiredBuffer) {
              exclusionReason = {
                code: 'BUFFER',
                message: 'Insufficient buffer time',
                details: `${gapMinutes.toFixed(0)} min gap, need ${requiredBuffer} min (${driveMinutes} min drive + buffer)`,
              };
            }
          }

          if (exclusionReason) {
            slot.excluded = true;
            slot.exclusionReason = exclusionReason;
            excludedSlots.push(slot);
          } else {
            allSlots.push(slot);
            
            // Update day metrics
            const metrics = dayMetrics.get(currentDateStr)!;
            metrics.totalSlots++;
          }

          // Move to next 30-minute interval
          slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000);
        }

        dayOffset++;
      }
    }

    // Sort slots by:
    // 1. Date (earliest first)
    // 2. Route density score (highest first within same date)
    // 3. Start time
    allSlots.sort((a, b) => {
      const dateA = new Date(a.startTime).toDateString();
      const dateB = new Date(b.startTime).toDateString();
      
      if (dateA !== dateB) {
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }
      
      // Same date - sort by route density score (descending)
      const scoreA = a.routeDensityScore || 50;
      const scoreB = b.routeDensityScore || 50;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      
      // Same score - sort by time
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
    
    excludedSlots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Mark recommended slots (high route density score)
    let recommendedCount = 0;
    for (const slot of allSlots) {
      if ((slot.routeDensityScore || 0) >= 70 && recommendedCount < 10) {
        slot.isRecommended = true;
        recommendedCount++;
      }
    }
    
    // If no high-density slots, mark first few as recommended
    if (recommendedCount === 0 && allSlots.length > 0) {
      allSlots[0].isRecommended = true;
    }

    // Calculate recommended days
    const recommendedDays: RecommendedDay[] = [];
    const sortedDays = Array.from(dayMetrics.values())
      .filter(dm => dm.totalSlots > 0)
      .sort((a, b) => {
        // Score: combination of job density and available capacity
        const scoreA = (a.bookedJobs * 20) + (a.totalSlots > 0 ? 30 : 0);
        const scoreB = (b.bookedJobs * 20) + (b.totalSlots > 0 ? 30 : 0);
        return scoreB - scoreA;
      });

    // Get customer zone for matching
    const customerZone = extractZone(customerAddress || null);
    
    for (let i = 0; i < Math.min(3, sortedDays.length); i++) {
      const day = sortedDays[i];
      
      // Check if customer zone matches any job on this day
      const matchingZoneJobs = day.jobAddresses.filter(addr => 
        extractZone(addr) === customerZone
      ).length;
      
      let label = 'Available';
      let reason = 'Good availability';
      let efficiencyScore = 50;
      
      if (matchingZoneJobs >= 2) {
        label = 'Best fit for your area';
        reason = `${matchingZoneJobs} jobs already scheduled in your area`;
        efficiencyScore = 90;
      } else if (matchingZoneJobs === 1) {
        label = 'Good route fit';
        reason = 'Another job nearby on this day';
        efficiencyScore = 75;
      } else if (day.bookedJobs >= 3) {
        label = 'Most efficient';
        reason = 'Busy day with tight routes';
        efficiencyScore = 70;
      } else if (day.totalSlots >= 5) {
        label = 'Fastest availability';
        reason = 'Many open time slots';
        efficiencyScore = 60;
      }
      
      recommendedDays.push({
        date: day.dateStr,
        dayOfWeek: getWeekdayInTimezone(day.date, businessTimezone),
        label,
        reason,
        jobCount: day.bookedJobs,
        availableSlots: day.totalSlots,
        efficiencyScore,
      });
    }

    // Sort recommended days by efficiency score
    recommendedDays.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    // Limit results
    const limitedSlots = allSlots.slice(0, 50);

    console.log(`Generated ${allSlots.length} available slots, ${excludedSlots.length} excluded, ${recommendedDays.length} recommended days`);

    const response: {
      slots: TimeSlot[];
      totalAvailable: number;
      eligibleTechnicians: Array<{ id: string; name: string; durationMinutes: number }>;
      recommendedDays: RecommendedDay[];
      excludedSlots?: TimeSlot[];
      totalExcluded?: number;
    } = {
      slots: limitedSlots,
      totalAvailable: allSlots.length,
      eligibleTechnicians: eligibleTechs.map(t => ({ 
        id: t.id, 
        name: t.name, 
        durationMinutes: t.durationMinutes 
      })),
      recommendedDays,
    };

    // Include excluded slots if admin mode
    if (includeExcluded) {
      response.excludedSlots = excludedSlots.slice(0, 50);
      response.totalExcluded = excludedSlots.length;
    }

    return new Response(
      JSON.stringify(response),
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
