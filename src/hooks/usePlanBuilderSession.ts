import { useState, useEffect, useCallback } from 'react';
import type { PlanTier } from '@/components/plan-builder/TierSelector';
import type { ServicePlanHomeDetails } from '@/types/servicePlanBuilder';

const SESSION_KEY = 'bluladder-plan-builder-session';

interface SessionData {
  selectedTier: PlanTier;
  homeDetails: ServicePlanHomeDetails | null;
  serviceSelections: Array<{ id: string; enabled: boolean; frequency: 1 | 2 | 3 | 4 }>;
  timestamp: number;
}

const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export function usePlanBuilderSession() {
  const [isInitialized, setIsInitialized] = useState(false);

  // Load session data
  const loadSession = useCallback((): SessionData | null => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) return null;
      
      const data = JSON.parse(stored) as SessionData;
      
      // Check if session is still valid
      if (Date.now() - data.timestamp > SESSION_DURATION_MS) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      
      return data;
    } catch {
      return null;
    }
  }, []);

  // Save session data
  const saveSession = useCallback((data: Omit<SessionData, 'timestamp'>) => {
    try {
      const sessionData: SessionData = {
        ...data,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    } catch (e) {
      console.warn('Failed to save plan builder session:', e);
    }
  }, []);

  // Clear session
  const clearSession = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      console.warn('Failed to clear plan builder session:', e);
    }
  }, []);

  return {
    loadSession,
    saveSession,
    clearSession,
    isInitialized,
    setIsInitialized,
  };
}
