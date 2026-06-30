import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TimePreference = 'AM' | 'PM' | 'none';

export interface RecommendedSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  displayTime: string;
  durationMinutes: number;
  isRecommended?: boolean;
  estimatedDriveMinutes?: number;
  routeDensityScore?: number;
  routeDensityLabel?: string;
  gapMinutes?: number;
  gapScore?: number;
  gapEfficiencyLabel?: string;
  routeBonus?: number;
  whyLabel?: 'soonest_available' | 'minimizes_gaps' | 'alternative';
  // Team booking fields
  isTeamJob?: boolean;
  crewSize?: number;
  teamTechnicianIds?: string[];
  teamTechnicianNames?: string[];
  estimatedTeamHours?: number;
  estimatedSoloHours?: number;
  teamTriggerReason?: 'price' | 'hours' | 'fits_in_day';
}

export interface DayGridSlot {
  technicianId: string;
  technicianName: string;
  startTime: string;
  endTime: string;
  displayTime: string;
  durationMinutes: number;
  routeDensityScore?: number;
  routeDensityLabel?: string;
  gapMinutes?: number;
  gapScore?: number;
  gapEfficiencyLabel?: string;
  // Team booking fields
  isTeamJob?: boolean;
  crewSize?: number;
  teamTechnicianIds?: string[];
  teamTechnicianNames?: string[];
  estimatedTeamHours?: number;
  estimatedSoloHours?: number;
  teamTriggerReason?: 'price' | 'hours' | 'fits_in_day';
}

interface ServiceForAvailability {
  service: string;
  price: number;
}

interface UseSmartAvailabilityOptions {
  services: ServiceForAvailability[];
  customerAddress?: string;
  numStories?: number; // Property stories for technician filtering
}

interface UseSmartAvailabilityResult {
  // Recommended mode
  recommendations: RecommendedSlot[];
  // Unified scheduler surfaces (subset/relabel of the same ranked slots)
  bestRecommended: RecommendedSlot | null;
  nextAvailable: RecommendedSlot | null;
  rankedSlots: RecommendedSlot[];
  isLoadingRecommendations: boolean;
  fetchRecommendations: (preference: TimePreference) => Promise<void>;
  
  // Day grid mode
  daySlots: DayGridSlot[];
  isLoadingDaySlots: boolean;
  fetchDaySlots: (date: Date) => Promise<void>;
  
  // Fully booked days for disabling in calendar
  fullyBookedDays: string[];
  
  // Error state
  error: string | null;
  requiresAdminAction: boolean;
  
  // Clear state
  clearSlots: () => void;
}

export function useSmartAvailability({
  services,
  customerAddress,
  numStories,
}: UseSmartAvailabilityOptions): UseSmartAvailabilityResult {
  const [recommendations, setRecommendations] = useState<RecommendedSlot[]>([]);
  const [bestRecommended, setBestRecommended] = useState<RecommendedSlot | null>(null);
  const [nextAvailable, setNextAvailable] = useState<RecommendedSlot | null>(null);
  const [rankedSlots, setRankedSlots] = useState<RecommendedSlot[]>([]);
  const [daySlots, setDaySlots] = useState<DayGridSlot[]>([]);
  const [fullyBookedDays, setFullyBookedDays] = useState<string[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [isLoadingDaySlots, setIsLoadingDaySlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresAdminAction, setRequiresAdminAction] = useState(false);

  const fetchRecommendations = useCallback(async (preference: TimePreference) => {
    if (services.length === 0) return;

    setIsLoadingRecommendations(true);
    setError(null);
    setRequiresAdminAction(false);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services,
          customerAddress,
          numStories,
          mode: 'recommended',
          preference,
          daysToCheck: 30, // Look ahead 30 days for recommendations
        },
      });

      if (fnError) throw fnError;

      if (data?.error) {
        setError(data.error);
        if (data.requiresAdminAction) {
          setRequiresAdminAction(true);
        }
        setRecommendations([]);
        setBestRecommended(null);
        setNextAvailable(null);
        setRankedSlots([]);
        return;
      }

      setRecommendations(data.recommendations || []);
      setBestRecommended(data.bestRecommended ?? null);
      setNextAvailable(data.nextAvailable ?? null);
      setRankedSlots(data.rankedSlots || []);
      setFullyBookedDays(data.fullyBookedDays || []);
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
      setError('Unable to load available times. Please try again.');
    } finally {
      setIsLoadingRecommendations(false);
    }
  }, [services, customerAddress, numStories]);

  const fetchDaySlots = useCallback(async (date: Date) => {
    if (services.length === 0) return;

    setIsLoadingDaySlots(true);
    setError(null);

    try {
      const dateStr = date.toISOString().split('T')[0];
      
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services,
          customerAddress,
          numStories,
          mode: 'dayGrid',
          selectedDate: dateStr,
          daysToCheck: 1,
        },
      });

      if (fnError) throw fnError;

      if (data?.error) {
        setError(data.error);
        setDaySlots([]);
        return;
      }

      setDaySlots(data.slots || []);
      // Update fully booked days if returned
      if (data.fullyBookedDays) {
        setFullyBookedDays(prev => {
          const combined = new Set([...prev, ...data.fullyBookedDays]);
          return Array.from(combined);
        });
      }
    } catch (err) {
      console.error('Failed to fetch day slots:', err);
      setError('Unable to load times for this day. Please try again.');
    } finally {
      setIsLoadingDaySlots(false);
    }
  }, [services, customerAddress, numStories]);

  const clearSlots = useCallback(() => {
    setRecommendations([]);
    setBestRecommended(null);
    setNextAvailable(null);
    setRankedSlots([]);
    setDaySlots([]);
    setError(null);
  }, []);

  return {
    recommendations,
    bestRecommended,
    nextAvailable,
    rankedSlots,
    isLoadingRecommendations,
    fetchRecommendations,
    daySlots,
    isLoadingDaySlots,
    fetchDaySlots,
    fullyBookedDays,
    error,
    requiresAdminAction,
    clearSlots,
  };
}
