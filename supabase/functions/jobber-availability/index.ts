import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobberGraphQL } from "../_shared/jobberClient.ts";

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
  // For admin visibility
  excluded?: boolean;
  exclusionReason?: ExclusionReason;
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

// Estimate drive time between two addresses (simplified - returns random 5-40 min)
// In production, you'd integrate with Google Maps Distance Matrix API
function estimateDriveTime(fromAddress: string | null, toAddress: string | null): number {
  if (!fromAddress || !toAddress) {
    return 15; // Default estimate when addresses unknown
  }
  // Simplified estimation - in production use actual routing API
  // For now, return a pseudo-random but consistent value based on address hash
  const hash = (fromAddress + toAddress).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  return 10 + Math.abs(hash % 35); // 10-45 minutes
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
    // Filter by date range to only get relevant future visits
    // Jobber uses 'after' and 'before' for datetime range filters
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

    const jobberResult = await jobberGraphQL<{
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
    }>(scheduledItemsQuery, { 
      startDateAfter: fromDateISO,
      startDateBefore: toDateISO,
    });

    // Build a map of busy times per technician with addresses
    const busyTimesByTech: Record<string, Array<{ 
      start: Date; 
      end: Date;
      address: string | null;
    }>> = {};

    // Debug: Log all technician Jobber IDs we're looking for
    const techJobberIds = eligibleTechs.map(t => t.jobberUserId);
    console.log("Looking for Jobber User IDs:", techJobberIds);

    if (jobberResult.data?.visits?.nodes) {
      const visits = jobberResult.data.visits.nodes;
      console.log(`Jobber returned ${visits.length} visits in date range`);
      
      // Log details of each relevant visit
      for (const visit of visits) {
        const users = visit.assignedUsers?.nodes || [];
        const userIds = users.map(u => u.id);
        console.log(`Visit ${visit.id}: ${visit.startAt} - ${visit.endAt}, assigned to users: ${JSON.stringify(userIds)}`);
        
        const addr = visit.job?.property?.address;
        const address = addr 
          ? `${addr.street || ''}, ${addr.city || ''}, ${addr.province || ''} ${addr.postalCode || ''}`.trim()
          : null;
          
        for (const user of users) {
          // Check if this user ID matches any of our technicians
          const matchesTech = techJobberIds.includes(user.id);
          if (matchesTech) {
            console.log(`  -> User ${user.id} MATCHES one of our technicians`);
          } else {
            console.log(`  -> User ${user.id} does NOT match our technicians`);
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
      
      // Debug: Show busy times map
      console.log("Busy times by tech ID:", Object.keys(busyTimesByTech).map(id => ({
        jobberUserId: id,
        busyCount: busyTimesByTech[id].length
      })));
    } else {
      console.log("No visits returned from Jobber or empty result");
      if (jobberResult.errors) {
        console.error("Jobber errors:", jobberResult.errors);
      }
    }

    // Generate available slots for each eligible technician
    const allSlots: TimeSlot[] = [];
    const excludedSlots: TimeSlot[] = [];

    for (const tech of eligibleTechs) {
      const techBusyTimes = busyTimesByTech[tech.jobberUserId] || [];
      techBusyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());

      let dayOffset = 0;
      
      while (dayOffset < daysToCheck) {
        const currentDay = new Date(fromDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        
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

          // Get previous appointment (for drive time calculation)
          const previousAppointment = todayBusyTimes
            .filter(bt => bt.end <= slotStart)
            .sort((a, b) => b.end.getTime() - a.end.getTime())[0];

          // Calculate drive time
          const fromAddress = isFirstJob 
            ? tech.startingAddress 
            : previousAppointment?.address;
          const driveMinutes = estimateDriveTime(fromAddress || null, customerAddress || null);
          
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
                // Allow it, but mark it
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
            // Use per-technician max drive time or fall back to global
            const maxDriveTime = tech.maxDriveTimeMinutes ?? DRIVE_TIME_CONFIG.max_drive_time_minutes;
            
            // Check if long drive as last job
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
            // Use per-technician buffer or fall back to global
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
          }

          // Move to next 30-minute interval
          slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000);
        }

        dayOffset++;
      }
    }

    // Sort slots by start time
    allSlots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    excludedSlots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Mark the first slot as recommended
    if (allSlots.length > 0) {
      allSlots[0].isRecommended = true;
    }

    // Limit results
    const limitedSlots = allSlots.slice(0, 50);

    console.log(`Generated ${allSlots.length} available slots, ${excludedSlots.length} excluded`);

    const response: {
      slots: TimeSlot[];
      totalAvailable: number;
      eligibleTechnicians: Array<{ id: string; name: string; durationMinutes: number }>;
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