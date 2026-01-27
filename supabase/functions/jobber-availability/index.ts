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
  routeDensityScore?: number;
  routeDensityLabel?: string;
  nearbyJobCount?: number;
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

interface BusyBlock {
  id: string;
  crew_id: string;
  start_at: string;
  end_at: string;
  jobber_visit_id: string | null;
  status: string;
  client_address: string | null;
}

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

function getHourInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  return parseInt(parts.find(p => p.type === 'hour')?.value || '0');
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

function estimateDriveTime(fromAddress: string | null, toAddress: string | null): number {
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

    const requestedDaysToCheck = Number.isFinite(daysToCheck) ? Math.floor(daysToCheck) : 14;
    const effectiveDaysToCheck = includeExcluded
      ? Math.max(1, Math.min(requestedDaysToCheck, 60))
      : Math.max(1, Math.min(requestedDaysToCheck, 14)); // Increased since we read local DB

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
          recommendedDays: [],
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
    console.log("Using timezone:", businessTimezone);

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
    const toDate = new Date(fromDate.getTime() + effectiveDaysToCheck * 24 * 60 * 60 * 1000);

    console.log(`Querying local busy blocks from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    // ========== KEY CHANGE: Query local jobber_busy_blocks instead of Jobber API ==========
    const techJobberIds = eligibleTechs.map(t => t.jobberUserId);
    
    const { data: busyBlocks, error: blocksError } = await supabase
      .from("jobber_busy_blocks")
      .select("*")
      .in("crew_id", techJobberIds)
      .gte("start_at", fromDate.toISOString())
      .lte("start_at", toDate.toISOString())
      .eq("status", "scheduled");

    if (blocksError) {
      console.error("Failed to fetch busy blocks:", blocksError);
      return new Response(
        JSON.stringify({ error: "Failed to load schedule data", slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log(`Found ${busyBlocks?.length || 0} busy blocks from local mirror`);

    // Build a map of busy times per technician
    const busyTimesByTech: Record<string, Array<{ 
      start: Date; 
      end: Date;
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
      busyTimesByTech[block.crew_id].push({
        start: new Date(block.start_at),
        end: new Date(block.end_at),
        address: block.client_address,
      });
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
      
      while (dayOffset < effectiveDaysToCheck) {
        const currentDay = new Date(fromDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const currentDateStr = formatDateInTimezone(currentDay, businessTimezone);
        
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

        const todayBusyTimes = techBusyTimes.filter(
          bt => bt.start >= dayStart && bt.start < dayEnd
        );
        
        const dayJobAddresses = jobsByDate[currentDateStr] || [];
        const hasEarlierJobToday = todayBusyTimes.some(bt => bt.start < effectiveStart);

        let slotStart = new Date(effectiveStart);
        
        while (slotStart.getTime() + tech.durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + tech.durationMinutes * 60 * 1000);
          const slotHour = getHourInTimezone(slotStart, businessTimezone);
          
          const hasConflict = todayBusyTimes.some(bt => 
            (slotStart < bt.end && slotEnd > bt.start)
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
          const driveMinutes = estimateDriveTime(fromAddress || null, customerAddress || null);
          
          const routeDensity = calculateRouteDensityScore(
            slotStart,
            customerAddress || null,
            dayJobAddresses,
            previousAppointment?.address || null,
            nextAppointment?.address || null
          );
          
          const driveBuffer = getBufferForDriveTime(driveMinutes, DRIVE_TIME_CONFIG);
          
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
            const maxDriveTime = tech.maxDriveTimeMinutes ?? DRIVE_TIME_CONFIG.max_drive_time_minutes;
            
            if (driveMinutes > maxDriveTime) {
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
            const metrics = dayMetrics.get(currentDateStr)!;
            metrics.totalSlots++;
          }

          slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000);
        }

        dayOffset++;
      }
    }

    // Sort slots
    allSlots.sort((a, b) => {
      const dateA = new Date(a.startTime).toDateString();
      const dateB = new Date(b.startTime).toDateString();
      
      if (dateA !== dateB) {
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }
      
      const scoreA = a.routeDensityScore || 50;
      const scoreB = b.routeDensityScore || 50;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
    
    excludedSlots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Mark recommended slots
    let recommendedCount = 0;
    for (const slot of allSlots) {
      if ((slot.routeDensityScore || 0) >= 70 && recommendedCount < 10) {
        slot.isRecommended = true;
        recommendedCount++;
      }
    }
    
    if (recommendedCount === 0 && allSlots.length > 0) {
      allSlots[0].isRecommended = true;
    }

    // Calculate recommended days
    const recommendedDays: RecommendedDay[] = [];
    const sortedDays = Array.from(dayMetrics.values())
      .filter(dm => dm.totalSlots > 0)
      .sort((a, b) => {
        const scoreA = (a.bookedJobs * 20) + (a.totalSlots > 0 ? 30 : 0);
        const scoreB = (b.bookedJobs * 20) + (b.totalSlots > 0 ? 30 : 0);
        return scoreB - scoreA;
      });

    const customerZone = extractZone(customerAddress || null);
    
    for (let i = 0; i < Math.min(3, sortedDays.length); i++) {
      const day = sortedDays[i];
      
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

    recommendedDays.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

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