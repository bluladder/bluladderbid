import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ServiceSelection {
  service: string;
  price: number;
}

interface TechnicianCapabilities {
  can_do_windows?: boolean;
  can_do_gutters?: boolean;
  can_do_pressure?: boolean;
  has_pressure_washer?: boolean;
  requires_bundle_for_windows?: boolean;
  eligible_for_big_job_pairing?: boolean;
  [key: string]: boolean | undefined;
}

interface Technician {
  id: string;
  name: string;
  jobber_user_id: string;
  is_active: boolean;
  service_capabilities: TechnicianCapabilities | null;
}

interface EligibilityRule {
  id: string;
  rule_name: string;
  priority: number;
  rule_type: 'hard_exclude' | 'preference';
  conditions: {
    services_include?: string[];
    services_exclude?: string[];
    require_capability?: string;
    exclude_capability?: string;
    min_price?: number;
    require_crew_size?: number;
  };
  is_active: boolean;
}

interface BigJobSettings {
  big_job_value_threshold: number;
  big_job_solo_hours_threshold: number | null;
  auto_assign_two_techs: boolean;
  crew_efficiency_factor: number;
}

export interface EligibilityResult {
  eligibleTechnicians: Technician[];
  excludedTechnicians: Array<{ technician: Technician; reason: string }>;
  requiredCrewSize: number;
  isBigJob: boolean;
  adjustedDurationHours: number | null;
  appliedRules: string[];
}

/**
 * Evaluates eligibility rules against selected services and returns eligible technicians.
 * This is the client-side evaluation - server-side validation should also be performed.
 */
export async function evaluateEligibility(
  services: ServiceSelection[],
  totalPrice: number,
  estimatedSoloHours: number | null
): Promise<EligibilityResult> {
  // Fetch all data in parallel
  const [techsRes, rulesRes, settingsRes] = await Promise.all([
    supabase.from('technicians').select('*').eq('is_active', true),
    supabase.from('eligibility_rules').select('*').eq('is_active', true).order('priority'),
    supabase.from('big_job_settings').select('*').eq('id', 'default').single(),
  ]);

  if (techsRes.error) throw techsRes.error;
  if (rulesRes.error) throw rulesRes.error;

  const technicians: Technician[] = (techsRes.data || []).map(t => ({
    ...t,
    service_capabilities: t.service_capabilities as TechnicianCapabilities | null,
  }));

  const rules: EligibilityRule[] = (rulesRes.data || []).map(r => ({
    ...r,
    rule_type: r.rule_type as 'hard_exclude' | 'preference',
    conditions: r.conditions as EligibilityRule['conditions'],
  }));

  const settings: BigJobSettings = settingsRes.data ? {
    big_job_value_threshold: settingsRes.data.big_job_value_threshold,
    big_job_solo_hours_threshold: settingsRes.data.big_job_solo_hours_threshold,
    auto_assign_two_techs: settingsRes.data.auto_assign_two_techs,
    crew_efficiency_factor: Number(settingsRes.data.crew_efficiency_factor),
  } : {
    big_job_value_threshold: 900,
    big_job_solo_hours_threshold: null,
    auto_assign_two_techs: true,
    crew_efficiency_factor: 1.8,
  };

  const serviceTypes = services.map(s => s.service);
  const eligibleTechs: Technician[] = [...technicians];
  const excludedTechs: Array<{ technician: Technician; reason: string }> = [];
  const appliedRules: string[] = [];
  let requiredCrewSize = 1;

  // Check if this is a big job
  const isBigJob = totalPrice >= settings.big_job_value_threshold ||
    (settings.big_job_solo_hours_threshold !== null && 
     estimatedSoloHours !== null && 
     estimatedSoloHours >= settings.big_job_solo_hours_threshold);

  if (isBigJob && settings.auto_assign_two_techs) {
    requiredCrewSize = 2;
  }

  // Apply each rule in priority order
  for (const rule of rules) {
    const { conditions } = rule;
    
    // Check if rule applies based on services
    let ruleApplies = false;

    // Check services_include condition
    if (conditions.services_include && conditions.services_include.length > 0) {
      const hasIncludedService = conditions.services_include.some(svc => serviceTypes.includes(svc));
      if (hasIncludedService) {
        ruleApplies = true;
      }
    }

    // Check services_exclude condition (booking must NOT have any of these)
    if (conditions.services_exclude && conditions.services_exclude.length > 0 && ruleApplies) {
      const hasExcludedService = conditions.services_exclude.some(svc => serviceTypes.includes(svc));
      if (hasExcludedService) {
        // Rule doesn't apply if booking has an excluded service
        ruleApplies = false;
      }
    }

    // Check min_price condition
    if (conditions.min_price !== undefined) {
      if (totalPrice >= conditions.min_price) {
        ruleApplies = true;
      }
    }

    // If rule doesn't apply to this booking, skip
    if (!ruleApplies && conditions.services_include && conditions.services_include.length > 0) {
      continue;
    }

    // Apply crew size requirement
    if (conditions.require_crew_size) {
      requiredCrewSize = Math.max(requiredCrewSize, conditions.require_crew_size);
    }

    // Apply technician filtering based on capabilities
    if (rule.rule_type === 'hard_exclude' || rule.rule_type === 'preference') {
      const toRemove: Technician[] = [];

      for (const tech of eligibleTechs) {
        const caps = tech.service_capabilities || {};
        let shouldExclude = false;
        let reason = '';

        // Check require_capability - tech must have this
        if (conditions.require_capability) {
          if (!caps[conditions.require_capability]) {
            shouldExclude = true;
            reason = `Missing required capability: ${conditions.require_capability}`;
          }
        }

        // Check exclude_capability - tech must NOT have this
        if (conditions.exclude_capability) {
          if (caps[conditions.exclude_capability]) {
            shouldExclude = true;
            reason = `Has excluded capability: ${conditions.exclude_capability}`;
          }
        }

        if (shouldExclude && rule.rule_type === 'hard_exclude') {
          toRemove.push(tech);
          excludedTechs.push({ technician: tech, reason: `${rule.rule_name}: ${reason}` });
        }
      }

      // Remove excluded technicians
      for (const tech of toRemove) {
        const idx = eligibleTechs.findIndex(t => t.id === tech.id);
        if (idx > -1) {
          eligibleTechs.splice(idx, 1);
        }
      }

      if (toRemove.length > 0) {
        appliedRules.push(rule.rule_name);
      }
    }
  }

  // For big jobs, filter to only eligible_for_big_job_pairing techs
  if (isBigJob && settings.auto_assign_two_techs) {
    const bigJobEligible = eligibleTechs.filter(t => 
      t.service_capabilities?.eligible_for_big_job_pairing === true
    );
    
    // Move non-eligible to excluded
    for (const tech of eligibleTechs) {
      if (!tech.service_capabilities?.eligible_for_big_job_pairing) {
        const alreadyExcluded = excludedTechs.some(e => e.technician.id === tech.id);
        if (!alreadyExcluded) {
          excludedTechs.push({ 
            technician: tech, 
            reason: 'Not eligible for big job pairing' 
          });
        }
      }
    }

    eligibleTechs.length = 0;
    eligibleTechs.push(...bigJobEligible);
    appliedRules.push('Big job auto-crew');
  }

  // Calculate adjusted duration
  let adjustedDurationHours: number | null = null;
  if (estimatedSoloHours !== null && requiredCrewSize > 1) {
    adjustedDurationHours = estimatedSoloHours / settings.crew_efficiency_factor;
  }

  return {
    eligibleTechnicians: eligibleTechs,
    excludedTechnicians: excludedTechs,
    requiredCrewSize,
    isBigJob,
    adjustedDurationHours,
    appliedRules,
  };
}

/**
 * Hook to use the eligibility engine reactively
 */
export function useEligibilityEngine() {
  return {
    evaluateEligibility,
  };
}
