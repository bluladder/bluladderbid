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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { services, startDate, daysToCheck = 7 }: AvailabilityRequest = await req.json();

    if (!services || services.length === 0) {
      return new Response(
        JSON.stringify({ error: "No services provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      return new Response(
        JSON.stringify({ error: "No technicians available", slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

        if (!rate || rate.dollars_per_hour <= 0) {
          canPerformAll = false;
          break;
        }

        // Duration calculation: ceil((price / dollars_per_hour) * 60) + buffer
        const minutes = Math.ceil((svc.price / rate.dollars_per_hour) * 60) + rate.buffer_minutes;
        totalDuration += minutes;
      }

      if (canPerformAll && totalDuration > 0) {
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

    // Query Jobber for schedule availability
    const fromDate = startDate || new Date().toISOString().split("T")[0];
    const toDate = new Date(new Date(fromDate).getTime() + daysToCheck * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Get schedule items for each technician
    const slots: TimeSlot[] = [];
    
    for (const tech of eligibleTechs) {
      // Query Jobber for the user's schedule
      const scheduleQuery = `
        query GetUserSchedule($userId: EncodedId!, $startDate: ISO8601Date!, $endDate: ISO8601Date!) {
          user(id: $userId) {
            id
            name {
              full
            }
            scheduleAvailability(startDate: $startDate, endDate: $endDate) {
              date
              availableSlots {
                startAt
                endAt
              }
            }
          }
        }
      `;

      const result = await jobberGraphQL<{
        user: {
          id: string;
          name: { full: string };
          scheduleAvailability: Array<{
            date: string;
            availableSlots: Array<{
              startAt: string;
              endAt: string;
            }>;
          }>;
        };
      }>(scheduleQuery, {
        userId: tech.jobberUserId,
        startDate: fromDate,
        endDate: toDate,
      });

      if (result.errors || !result.data?.user?.scheduleAvailability) {
        console.error("Jobber schedule query error for tech", tech.id, result.errors);
        continue;
      }

      // Find slots that can fit the duration
      for (const day of result.data.user.scheduleAvailability) {
        for (const slot of day.availableSlots) {
          const slotStart = new Date(slot.startAt);
          const slotEnd = new Date(slot.endAt);
          const slotDuration = (slotEnd.getTime() - slotStart.getTime()) / (1000 * 60);

          // Check if this slot can fit the job
          if (slotDuration >= tech.durationMinutes) {
            // Generate potential start times (every 30 minutes within the slot)
            let currentStart = new Date(slotStart);
            const maxStart = new Date(slotEnd.getTime() - tech.durationMinutes * 60 * 1000);

            while (currentStart <= maxStart) {
              const jobEnd = new Date(currentStart.getTime() + tech.durationMinutes * 60 * 1000);
              
              slots.push({
                technicianId: tech.id,
                technicianName: tech.name,
                startTime: currentStart.toISOString(),
                endTime: jobEnd.toISOString(),
                durationMinutes: tech.durationMinutes,
              });

              // Move to next 30-minute interval
              currentStart = new Date(currentStart.getTime() + 30 * 60 * 1000);
            }
          }
        }
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

    return new Response(
      JSON.stringify({
        slots: limitedSlots,
        totalAvailable: slots.length,
        eligibleTechnicians: eligibleTechs.map(t => ({ id: t.id, name: t.name })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Availability error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to check availability" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
