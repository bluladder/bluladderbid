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
  whyLabel?: 'soonest_available' | 'minimizes_gaps' | 'alternative' | 'best_recommended';
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
  // True when the backend deliberately withheld availability (stale mirror,
  // sync in progress, never-synced). This is a controlled, safe-to-retry state
  // — NOT a technical error — and the UI must show a reassuring message plus a
  // callback option instead of appointment choices.
  availabilityUnavailable: boolean;
  
  // Clear state
  clearSlots: () => void;
}

type AvailabilityErrorPayload = {
  error?: string;
  message?: string;
  availability_unavailable?: boolean;
  requiresAdminAction?: boolean;
  reason?: string;
};

// supabase.functions.invoke surfaces non-2xx responses as an error whose
// `context` is the raw Response. Pull the JSON body out so the controlled 503
// "availability temporarily unavailable" payload can drive a friendly message
// instead of a generic failure.
async function extractAvailabilityErrorPayload(err: unknown): Promise<AvailabilityErrorPayload | null> {
  const anyErr = err as { context?: Response; message?: string };
  const context = anyErr?.context;
  if (context && typeof context.clone === 'function') {
    try {
      const text = await context.clone().text();
      const parsed = JSON.parse(text) as AvailabilityErrorPayload;
      if (parsed && (parsed.error || parsed.message || parsed.availability_unavailable)) return parsed;
    } catch {
      // fall through
    }
  }
  const msg = anyErr?.message ? String(anyErr.message) : String(err);
  const jsonMatch = msg.match(/(\{[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as AvailabilityErrorPayload;
      if (parsed && (parsed.error || parsed.message || parsed.availability_unavailable)) return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

const AVAILABILITY_UNAVAILABLE_MESSAGE =
  "We're temporarily unable to verify online appointment times. Please try again shortly or request that our team contact you.";

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
  const [availabilityUnavailable, setAvailabilityUnavailable] = useState(false);

  const fetchRecommendations = useCallback(async (preference: TimePreference) => {
    if (services.length === 0) return;

    setIsLoadingRecommendations(true);
    setError(null);
    setRequiresAdminAction(false);
    setAvailabilityUnavailable(false);

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

      if (fnError) {
        const payload = await extractAvailabilityErrorPayload(fnError);
        if (payload?.availability_unavailable) {
          setAvailabilityUnavailable(true);
          setError(payload.message || payload.error || AVAILABILITY_UNAVAILABLE_MESSAGE);
          setRecommendations([]);
          setBestRecommended(null);
          setNextAvailable(null);
          setRankedSlots([]);
          return;
        }
        if (payload?.requiresAdminAction) setRequiresAdminAction(true);
        if (payload?.error || payload?.message) {
          setError(payload.message || payload.error || null);
          setRecommendations([]);
          setBestRecommended(null);
          setNextAvailable(null);
          setRankedSlots([]);
          return;
        }
        throw fnError;
      }

      if (data?.error) {
        if (data.availability_unavailable) {
          setAvailabilityUnavailable(true);
          setError(data.message || data.error || AVAILABILITY_UNAVAILABLE_MESSAGE);
          setRecommendations([]);
          setBestRecommended(null);
          setNextAvailable(null);
          setRankedSlots([]);
          return;
        }
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
    setAvailabilityUnavailable(false);

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

      if (fnError) {
        const payload = await extractAvailabilityErrorPayload(fnError);
        if (payload?.availability_unavailable) {
          setAvailabilityUnavailable(true);
          setError(payload.message || payload.error || AVAILABILITY_UNAVAILABLE_MESSAGE);
          setDaySlots([]);
          return;
        }
        if (payload?.error || payload?.message) {
          setError(payload.message || payload.error || null);
          setDaySlots([]);
          return;
        }
        throw fnError;
      }

      if (data?.error) {
        if (data.availability_unavailable) {
          setAvailabilityUnavailable(true);
          setError(data.message || data.error || AVAILABILITY_UNAVAILABLE_MESSAGE);
          setDaySlots([]);
          return;
        }
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
    setAvailabilityUnavailable(false);
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
    availabilityUnavailable,
    clearSlots,
  };
}
