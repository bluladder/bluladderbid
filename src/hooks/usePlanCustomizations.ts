import { useState, useEffect, useCallback } from 'react';
import type { PlanCustomization } from '@/components/homeowner/PlanCustomizeDrawer';

const STORAGE_KEY = 'bluladder-plan-customizations';

export type TierCustomizations = {
  good?: PlanCustomization;
  better?: PlanCustomization;
  best?: PlanCustomization;
};

export function usePlanCustomizations() {
  const [customizations, setCustomizations] = useState<TierCustomizations>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Persist to localStorage whenever customizations change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customizations));
    } catch (e) {
      console.warn('Failed to persist customizations:', e);
    }
  }, [customizations]);

  const setTierCustomization = useCallback(
    (tier: 'good' | 'better' | 'best', customization: PlanCustomization) => {
      setCustomizations((prev) => ({
        ...prev,
        [tier]: customization,
      }));
    },
    []
  );

  const clearTierCustomization = useCallback((tier: 'good' | 'better' | 'best') => {
    setCustomizations((prev) => {
      const next = { ...prev };
      delete next[tier];
      return next;
    });
  }, []);

  const clearAllCustomizations = useCallback(() => {
    setCustomizations({});
  }, []);

  const hasCustomization = useCallback(
    (tier: 'good' | 'better' | 'best') => !!customizations[tier],
    [customizations]
  );

  return {
    customizations,
    setTierCustomization,
    clearTierCustomization,
    clearAllCustomizations,
    hasCustomization,
  };
}
