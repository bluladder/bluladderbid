import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays } from 'date-fns';
import type { TimeSlot } from '@/components/booking/TimeSlotPicker';

interface ServiceForAvailability {
  service: string;
  price: number;
}

interface UseDateSlotsOptions {
  services: ServiceForAvailability[];
  customerAddress?: string;
  routeDensityWeight?: string;
  daysToFetch?: number; // How many days to fetch from the selected date (1-3)
}

interface UseDateSlotsResult {
  slots: TimeSlot[];
  isLoading: boolean;
  error: string | null;
  isThrottled: boolean;
  retryCountdown: number;
  requiresAdminAction: boolean;
  fetchSlotsForDate: (date: Date) => Promise<void>;
  clearSlots: () => void;
  lastFetchedDate: Date | null;
}

type AvailabilityErrorPayload = {
  error?: string;
  retryAfter?: number;
  requiresAdminAction?: boolean;
  code?: string;
};

async function extractAvailabilityErrorPayload(err: unknown): Promise<AvailabilityErrorPayload | null> {
  const anyErr = err as any;

  const context = anyErr?.context as Response | undefined;
  if (context && typeof context.clone === 'function') {
    try {
      const text = await context.clone().text();
      const maybeJson = JSON.parse(text) as AvailabilityErrorPayload;
      if (maybeJson && (maybeJson.error || maybeJson.retryAfter)) return maybeJson;
    } catch {
      // fall through
    }
  }

  const msg = anyErr?.message ? String(anyErr.message) : String(err);
  const jsonMatch = msg.match(/(\{[\s\S]*\})\s*$/);
  if (jsonMatch) {
    try {
      const maybeJson = JSON.parse(jsonMatch[1]) as AvailabilityErrorPayload;
      if (maybeJson && (maybeJson.error || maybeJson.retryAfter)) return maybeJson;
    } catch {
      // ignore
    }
  }

  return null;
}

export function useDateSlots({
  services,
  customerAddress,
  routeDensityWeight = 'medium',
  daysToFetch = 1,
}: UseDateSlotsOptions): UseDateSlotsResult {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isThrottled, setIsThrottled] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [requiresAdminAction, setRequiresAdminAction] = useState(false);
  const [lastFetchedDate, setLastFetchedDate] = useState<Date | null>(null);

  // Track countdown timer
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const startCountdown = useCallback((seconds: number) => {
    setRetryCountdown(seconds);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    countdownRef.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const fetchSlotsForDate = useCallback(async (date: Date) => {
    if (services.length === 0) return;

    setIsLoading(true);
    setError(null);
    setRequiresAdminAction(false);
    setLastFetchedDate(date);

    try {
      const startDate = format(date, 'yyyy-MM-dd');
      
      const { data, error: fnError } = await supabase.functions.invoke('jobber-availability', {
        body: {
          services,
          startDate,
          daysToCheck: daysToFetch,
          customerAddress,
          routeDensityWeight,
        },
      });

      if (fnError) {
        const payload = await extractAvailabilityErrorPayload(fnError);
        if (payload?.error) {
          setError(payload.error);
          if (payload.retryAfter) {
            setIsThrottled(true);
            startCountdown(payload.retryAfter);
          }
          if (payload.requiresAdminAction) {
            setRequiresAdminAction(true);
          }
          setSlots([]);
          return;
        }
        throw fnError;
      }

      if (data?.error) {
        setError(data.error);
        if (data.retryAfter) {
          setIsThrottled(true);
          startCountdown(data.retryAfter);
        }
        if (data.requiresAdminAction) {
          setRequiresAdminAction(true);
        }
        setSlots([]);
        return;
      }

      setIsThrottled(false);
      setRetryCountdown(0);
      setSlots(data.slots || []);
    } catch (err) {
      console.error('Failed to fetch availability for date:', err);
      const payload = await extractAvailabilityErrorPayload(err);
      if (payload?.error) {
        setError(payload.error);
        if (payload.retryAfter) {
          setIsThrottled(true);
          startCountdown(payload.retryAfter);
        }
        if (payload.requiresAdminAction) {
          setRequiresAdminAction(true);
        }
        setSlots([]);
        return;
      }
      setError('Unable to load available times. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [services, customerAddress, routeDensityWeight, daysToFetch, startCountdown]);

  const clearSlots = useCallback(() => {
    setSlots([]);
    setError(null);
    setLastFetchedDate(null);
  }, []);

  return {
    slots,
    isLoading,
    error,
    isThrottled,
    retryCountdown,
    requiresAdminAction,
    fetchSlotsForDate,
    clearSlots,
    lastFetchedDate,
  };
}
