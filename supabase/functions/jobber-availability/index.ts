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
  startHour: 9, // 9 AM
  endHour: 17, // 5 PM
  workDays: [1, 2, 3, 4, 5, 6], // Monday through Saturday (0 = Sunday)
};

interface BusinessHoursConfig {
  startHour: number;
  endHour: number;
  workDays: number[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { services, startDate, daysToCheck = 14 }: AvailabilityRequest = await req.json();

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
      };
      console.log("Using configured business hours:", BUSINESS_HOURS);
    } else {
      console.log("Using default business hours (no config found):", BUSINESS_HOURS);
    }

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

    // Calculate date range
    const fromDate = startDate ? new Date(startDate) : new Date();
    fromDate.setHours(0, 0, 0, 0);
    
    const toDate = new Date(fromDate.getTime() + daysToCheck * 24 * 60 * 60 * 1000);

    // Query Jobber for scheduled visits in the date range
    // Note: Jobber's visit filter uses 'after' and 'before' for date ranges
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
      
      // Filter visits to only those in our date range (since we can't filter in the query)
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
      let currentDay = new Date(fromDate);
      
      while (currentDay < toDate) {
        const dayOfWeek = currentDay.getDay();
        
        // Skip non-work days
        if (!BUSINESS_HOURS.workDays.includes(dayOfWeek)) {
          currentDay.setDate(currentDay.getDate() + 1);
          continue;
        }

        // Create business hours for this day
        const dayStart = new Date(currentDay);
        dayStart.setHours(BUSINESS_HOURS.startHour, 0, 0, 0);
        
        const dayEnd = new Date(currentDay);
        dayEnd.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);

        // Skip if day is in the past
        const now = new Date();
        if (dayEnd <= now) {
          currentDay.setDate(currentDay.getDate() + 1);
          continue;
        }

        // Adjust start time if it's today and past business start
        let effectiveStart = new Date(dayStart);
        if (currentDay.toDateString() === now.toDateString() && now > dayStart) {
          // Round up to next 30-minute slot
          effectiveStart = new Date(now);
          effectiveStart.setMinutes(Math.ceil(now.getMinutes() / 30) * 30, 0, 0);
          if (effectiveStart.getMinutes() === 60) {
            effectiveStart.setHours(effectiveStart.getHours() + 1, 0, 0, 0);
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

        currentDay.setDate(currentDay.getDate() + 1);
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
