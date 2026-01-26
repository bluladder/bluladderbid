import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type BookingStep = 'calendar' | 'time' | 'info' | 'confirm';

interface StepEventData {
  services?: Array<{ service: string; price: number }>;
  selectedSlot?: {
    startTime: string;
    endTime: string;
    technicianId: string;
    isRecommended?: boolean;
  };
  usedSuggestedDay?: boolean;
  usedRecommendedSlot?: boolean;
}

// Generate or retrieve session ID
function getSessionId(): string {
  const storageKey = 'booking_session_id';
  let sessionId = sessionStorage.getItem(storageKey);
  
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem(storageKey, sessionId);
  }
  
  return sessionId;
}

// Reset session ID (call when booking completes)
export function resetBookingSession(): void {
  sessionStorage.removeItem('booking_session_id');
}

export function useBookingStepTracking() {
  const sessionIdRef = useRef<string>(getSessionId());
  const trackedStepsRef = useRef<Set<BookingStep>>(new Set());

  // Reset tracked steps on mount (new flow)
  useEffect(() => {
    trackedStepsRef.current = new Set();
  }, []);

  const trackStep = useCallback(async (
    step: BookingStep,
    data?: StepEventData
  ) => {
    // Avoid duplicate tracking for same step in same session
    if (trackedStepsRef.current.has(step)) {
      return;
    }
    trackedStepsRef.current.add(step);

    try {
      await (supabase as any)
        .from('booking_step_events')
        .insert({
          session_id: sessionIdRef.current,
          step,
          services_json: data?.services || null,
          selected_slot_json: data?.selectedSlot || null,
          used_suggested_day: data?.usedSuggestedDay || false,
          used_recommended_slot: data?.usedRecommendedSlot || false,
        });
    } catch (err) {
      // Silent fail - analytics shouldn't break UX
      console.warn('Failed to track booking step:', err);
    }
  }, []);

  const trackCalendarView = useCallback((
    services: Array<{ service: string; price: number }>
  ) => {
    trackStep('calendar', { services });
  }, [trackStep]);

  const trackTimeSelection = useCallback((
    selectedSlot: StepEventData['selectedSlot'],
    usedSuggestedDay: boolean,
    usedRecommendedSlot: boolean
  ) => {
    trackStep('time', {
      selectedSlot,
      usedSuggestedDay,
      usedRecommendedSlot,
    });
  }, [trackStep]);

  const trackInfoStep = useCallback(() => {
    trackStep('info');
  }, [trackStep]);

  const trackConfirmation = useCallback(() => {
    trackStep('confirm');
    // Reset session for next booking
    resetBookingSession();
    sessionIdRef.current = getSessionId();
    trackedStepsRef.current = new Set();
  }, [trackStep]);

  return {
    trackCalendarView,
    trackTimeSelection,
    trackInfoStep,
    trackConfirmation,
    sessionId: sessionIdRef.current,
  };
}
