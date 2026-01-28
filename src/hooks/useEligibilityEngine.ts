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
  max_stories: number | null;
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
  workday_length_hours: number;
  min_buffer_minutes: number;
  big_job_trigger_mode: 'PRICE_ONLY' | 'HOURS_ONLY' | 'PRICE_OR_HOURS' | 'FITS_IN_DAY';
  pairing_mode: 'AUTO_PAIR' | 'RESTRICTED' | 'PREFER_LIST';
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
 * Determines if a job qualifies as a "big job" based on settings and triggers
 */
function evaluateBigJobTrigger(
  settings: BigJobSettings,
  totalPrice: number,
  estimatedSoloHours: number | null
): boolean {
  const { 
    big_job_trigger_mode, 
    big_job_value_threshold, 
    big_job_solo_hours_threshold,
    workday_length_hours,
    min_buffer_minutes
  } = settings;

  const priceExceeds = totalPrice >= big_job_value_threshold;
  const hoursExceeds = big_job_solo_hours_threshold !== null && 
    estimatedSoloHours !== null && 
    estimatedSoloHours >= big_job_solo_hours_threshold;

  switch (big_job_trigger_mode) {
    case 'PRICE_ONLY':
      return priceExceeds;
    
    case 'HOURS_ONLY':
      return hoursExceeds;
    
    case 'PRICE_OR_HOURS':
      return priceExceeds || hoursExceeds;
    
    case 'FITS_IN_DAY':
    default:
      // Job doesn't fit in one workday
      if (estimatedSoloHours === null) {
        // Fall back to price threshold if hours not available
        return priceExceeds;
      }
      const availableHours = (workday_length_hours * 60 - min_buffer_minutes) / 60;
      return estimatedSoloHours > availableHours;
  }
}

/**
 * Evaluates eligibility rules against selected services and returns eligible technicians.
 * This is the client-side evaluation - server-side validation should also be performed.
 */
export async function evaluateEligibility(
  services: ServiceSelection[],
  totalPrice: number,
  estimatedSoloHours: number | null,
  propertyStories?: number
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
    workday_length_hours: Number(settingsRes.data.workday_length_hours) || 8,
    min_buffer_minutes: settingsRes.data.min_buffer_minutes || 30,
    big_job_trigger_mode: (settingsRes.data.big_job_trigger_mode as BigJobSettings['big_job_trigger_mode']) || 'FITS_IN_DAY',
    pairing_mode: (settingsRes.data.pairing_mode as BigJobSettings['pairing_mode']) || 'RESTRICTED',
  } : {
    big_job_value_threshold: 900,
    big_job_solo_hours_threshold: null,
    auto_assign_two_techs: true,
    crew_efficiency_factor: 1.8,
    workday_length_hours: 8,
    min_buffer_minutes: 30,
    big_job_trigger_mode: 'FITS_IN_DAY',
    pairing_mode: 'RESTRICTED',
  };

  const serviceTypes = services.map(s => s.service);
  const eligibleTechs: Technician[] = [...technicians];
  const excludedTechs: Array<{ technician: Technician; reason: string }> = [];
  const appliedRules: string[] = [];
  let requiredCrewSize = 1;

  // Phase 2: Filter by property stories first
  if (propertyStories !== undefined && propertyStories > 0) {
    const storiesToRemove: Technician[] = [];
    for (const tech of eligibleTechs) {
      if (tech.max_stories !== null && tech.max_stories < propertyStories) {
        storiesToRemove.push(tech);
        excludedTechs.push({ 
          technician: tech, 
          reason: `Property height constraint: max ${tech.max_stories} stories, property has ${propertyStories}` 
        });
      }
    }
    for (const tech of storiesToRemove) {
      const idx = eligibleTechs.findIndex(t => t.id === tech.id);
      if (idx > -1) eligibleTechs.splice(idx, 1);
    }
    if (storiesToRemove.length > 0) {
      appliedRules.push('Property height constraint');
    }
  }

  // Check if this is a big job using configurable trigger mode
  const isBigJob = evaluateBigJobTrigger(settings, totalPrice, estimatedSoloHours);

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

  // For big jobs, filter based on pairing mode
  if (isBigJob && settings.auto_assign_two_techs) {
    if (settings.pairing_mode === 'RESTRICTED') {
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
    }
    // AUTO_PAIR keeps all eligible techs, PREFER_LIST is future
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
