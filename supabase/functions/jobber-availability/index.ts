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
}

interface TimeSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  isRecommended?: boolean;
}

// Default business hours (used if not configured in database)
const DEFAULT_BUSINESS_HOURS = {
  startHour: 9, // 9 AM local time
  endHour: 17, // 5 PM local time
  workDays: [1, 2, 3, 4, 5, 6], // Monday through Saturday (0 = Sunday)
  timezone: "America/Chicago", // Default timezone (CST/CDT)
};

interface BusinessHoursConfig {
  startHour: number;
  endHour: number;
  workDays: number[];
  timezone?: string;
}

// Helper to create a date in a specific timezone
function createDateInTimezone(date: Date, hour: number, minute: number, timezone: string): Date {
  // Format the date components
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hourStr = String(hour).padStart(2, '0');
  const minStr = String(minute).padStart(2, '0');
  
  // Create ISO string for the local time
  const localDateStr = `${year}-${month}-${day}T${hourStr}:${minStr}:00`;
  
  // Get the offset for this timezone at this time
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
  
  // Parse by creating dates and finding the UTC equivalent
  // We'll iterate to find the correct UTC time that corresponds to the local time
  let testDate = new Date(`${localDateStr}Z`);
  
  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(testDate);
    const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const localDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    
    // Adjust based on difference
    const hourDiff = hour - localHour;
    const dayDiff = parseInt(day) - localDay;
    
    testDate = new Date(testDate.getTime() + (hourDiff * 60 * 60 * 1000) + (dayDiff * 24 * 60 * 60 * 1000));
  }
  
  return testDate;
}

// Get current time in timezone
function getNowInTimezone(timezone: string): { date: Date; hour: number; minute: number; dayOfWeek: number } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  
  const weekdayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };
  
  return { date: now, hour, minute, dayOfWeek: weekdayMap[weekdayStr] || 1 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { services, startDate, daysToCheck = 14, timezone: clientTimezone }: AvailabilityRequest = await req.json();

    if (!services || services.length === 0) {
      return new Response(
        JSON.stringify({ error: "No services provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch business hours from config
    let BUSINESS_HOURS: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS;
    
    const { data: configData, error: configError } = await supabase
      .from("pricing_config")
      .select("config_value")
      .eq("config_key", "business_hours")
      .maybeSingle();

    console.log("Business hours config query result:", { configData, configError });

    if (configData?.config_value) {
      const cfg = configData.config_value as Record<string, unknown>;
      BUSINESS_HOURS = {
        startHour: (cfg.startHour as number) ?? DEFAULT_BUSINESS_HOURS.startHour,
        endHour: (cfg.endHour as number) ?? DEFAULT_BUSINESS_HOURS.endHour,
        workDays: (cfg.workDays as number[]) ?? DEFAULT_BUSINESS_HOURS.workDays,
        timezone: (cfg.timezone as string) ?? DEFAULT_BUSINESS_HOURS.timezone,
      };
      console.log("Using configured business hours:", BUSINESS_HOURS);
    } else {
      console.log("Using default business hours (no config found):", BUSINESS_HOURS);
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
    console.log("Services requested:", services);

    // Calculate duration for each technician
    const eligibleTechs: Array<{
      id: string;
      jobberUserId: string;
      name: string;
      durationMinutes: number;
    }> = [];

    for (const tech of technicians) {
      let totalDuration = 0;
      let canPerformAll = true;

      for (const svc of services) {
        const serviceType = serviceTypeMap[svc.service] || svc.service;
        const rate = tech.technician_service_rates?.find(
          (r: { service_type: string }) => r.service_type === serviceType
        );

        console.log(`Tech ${tech.name}: service ${svc.service} -> ${serviceType}, rate:`, rate);

        if (!rate || rate.dollars_per_hour <= 0) {
          canPerformAll = false;
          console.log(`Tech ${tech.name} disqualified: no rate for ${serviceType}`);
          break;
        }

        // Duration calculation: ceil((price / dollars_per_hour) * 60) + buffer
        const minutes = Math.ceil((svc.price / rate.dollars_per_hour) * 60) + rate.buffer_minutes;
        totalDuration += minutes;
      }

      if (canPerformAll && totalDuration > 0) {
        console.log(`Tech ${tech.name} eligible with duration ${totalDuration} minutes`);
        eligibleTechs.push({
          id: tech.id,
          jobberUserId: tech.jobber_user_id,
          name: tech.name,
          durationMinutes: totalDuration,
        });
      }
    }

    if (eligibleTechs.length === 0) {
      return new Response(
        JSON.stringify({ error: "No technicians can perform all selected services", slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Eligible technicians:", eligibleTechs);

    // Calculate date range - using local timezone
    const now = new Date();
    const fromDate = startDate ? new Date(startDate) : now;
    
    const toDate = new Date(fromDate.getTime() + daysToCheck * 24 * 60 * 60 * 1000);

    // Query Jobber for scheduled visits in the date range
    const scheduledItemsQuery = `
      query GetScheduledItems {
        visits(first: 200) {
          nodes {
            id
            startAt
            endAt
            assignedUsers {
              nodes {
                id
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
        }>;
      };
    }>(scheduledItemsQuery, {});

    // Build a map of busy times per technician
    const busyTimesByTech: Record<string, Array<{ start: Date; end: Date }>> = {};

    if (jobberResult.data?.visits?.nodes) {
      console.log("Found visits from Jobber:", jobberResult.data.visits.nodes.length);
      
      // Filter visits to only those in our date range
      const relevantVisits = jobberResult.data.visits.nodes.filter(visit => {
        const visitStart = new Date(visit.startAt);
        return visitStart >= fromDate && visitStart < toDate;
      });
      
      console.log("Relevant visits in date range:", relevantVisits.length);
      
      for (const visit of relevantVisits) {
        const users = visit.assignedUsers?.nodes || [];
        for (const user of users) {
          if (!busyTimesByTech[user.id]) {
            busyTimesByTech[user.id] = [];
          }
          busyTimesByTech[user.id].push({
            start: new Date(visit.startAt),
            end: new Date(visit.endAt),
          });
        }
      }
    } else {
      console.log("No visits found or query failed:", jobberResult.errors);
    }

    // Generate available slots for each eligible technician
    const slots: TimeSlot[] = [];

    for (const tech of eligibleTechs) {
      const techBusyTimes = busyTimesByTech[tech.jobberUserId] || [];
      
      // Sort busy times by start
      techBusyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());

      // Generate slots for each business day
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
        
        // Skip non-work days
        if (!BUSINESS_HOURS.workDays.includes(dayOfWeek)) {
          dayOffset++;
          continue;
        }

        // Create business hours for this day in the correct timezone
        const dayStart = createDateInTimezone(currentDay, BUSINESS_HOURS.startHour, 0, businessTimezone);
        const dayEnd = createDateInTimezone(currentDay, BUSINESS_HOURS.endHour, 0, businessTimezone);

        console.log(`Day ${dayOffset}: ${currentDay.toDateString()} -> Start: ${dayStart.toISOString()}, End: ${dayEnd.toISOString()}`);

        // Skip if day is completely in the past
        if (dayEnd <= now) {
          dayOffset++;
          continue;
        }

        // Adjust start time if it's today and past business start
        let effectiveStart = new Date(dayStart);
        if (now > dayStart && now < dayEnd) {
          // Round up to next 30-minute slot
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

        // Generate available slots avoiding busy times
        let slotStart = new Date(effectiveStart);
        
        while (slotStart.getTime() + tech.durationMinutes * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + tech.durationMinutes * 60 * 1000);
          
          // Check if this slot conflicts with any busy time
          const hasConflict = todayBusyTimes.some(bt => 
            (slotStart < bt.end && slotEnd > bt.start)
          );

          if (!hasConflict) {
            slots.push({
              technicianId: tech.id,
              technicianName: tech.name,
              startTime: slotStart.toISOString(),
              endTime: slotEnd.toISOString(),
              durationMinutes: tech.durationMinutes,
            });
          }

          // Move to next 30-minute interval
          slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000);
        }

        dayOffset++;
      }
    }

    // Sort slots by start time
    slots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Mark the first slot as recommended
    if (slots.length > 0) {
      slots[0].isRecommended = true;
    }

    // Limit to first 50 slots
    const limitedSlots = slots.slice(0, 50);

    console.log(`Generated ${slots.length} total slots, returning ${limitedSlots.length}`);

    return new Response(
      JSON.stringify({
        slots: limitedSlots,
        totalAvailable: slots.length,
        eligibleTechnicians: eligibleTechs.map(t => ({ id: t.id, name: t.name, durationMinutes: t.durationMinutes })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Availability error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to check availability", details: error instanceof Error ? error.message : String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
