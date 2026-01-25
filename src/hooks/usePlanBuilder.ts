import { useState, useMemo, useCallback } from 'react';
import {
  Service,
  Perk,
  DiscountSettings,
  MemberDiscountSettings,
  PackageTier,
  TierServiceConfig,
  PlanConfig,
  BusinessDetails,
  AgreementTerms,
  ServiceFrequency,
  TierKey,
  TierAvailability,
  TierFrequencyConfig,
  FREQUENCY_MULTIPLIERS,
  TIER_LABELS,
  DEFAULT_SERVICES,
  DEFAULT_PERKS,
  DEFAULT_DISCOUNTS,
  DEFAULT_MEMBER_DISCOUNTS,
  DEFAULT_BUSINESS_DETAILS,
  DEFAULT_AGREEMENT_TERMS,
  createDefaultTierAvailability,
  createTierFrequencies,
} from '@/types/servicePlan';
import { ServiceBundle } from '@/types/bundles';

export function usePlanBuilder() {
  const [services, setServices] = useState<Service[]>(DEFAULT_SERVICES);
  const [customServiceIds, setCustomServiceIds] = useState<Set<string>>(new Set());
  const [perks, setPerks] = useState<Perk[]>(DEFAULT_PERKS);
  const [customPerkIds, setCustomPerkIds] = useState<Set<string>>(new Set());
  const [discounts, setDiscounts] = useState<DiscountSettings>(DEFAULT_DISCOUNTS);
  const [memberDiscounts, setMemberDiscounts] = useState<MemberDiscountSettings>(DEFAULT_MEMBER_DISCOUNTS);
  const [depositPercent, setDepositPercent] = useState(15);
  const [businessDetails, setBusinessDetails] = useState<BusinessDetails>(DEFAULT_BUSINESS_DETAILS);
  const [agreementTerms, setAgreementTerms] = useState<AgreementTerms>(DEFAULT_AGREEMENT_TERMS);
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best'>('better');
  const [showLimitedTimeOffer, setShowLimitedTimeOffer] = useState(false);
  const [limitedTimeOfferText, setLimitedTimeOfferText] = useState('Limited Time Offer — Book This Week!');
  const [limitedTimeOfferExpiry, setLimitedTimeOfferExpiry] = useState<Date | undefined>(undefined);
  const [pricingDisplayMode, setPricingDisplayMode] = useState<'monthly' | 'deposit'>('deposit');

  const toggleService = useCallback((id: string) => {
    setServices((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  }, []);

  const updateServicePrice = useCallback((id: string, price: number) => {
    setServices((prev) =>
      prev.map((s) => (s.id === id ? { ...s, basePrice: price } : s))
    );
  }, []);

  const updateServiceNote = useCallback((id: string, note: string) => {
    setServices((prev) =>
      prev.map((s) => (s.id === id ? { ...s, note: note || undefined } : s))
    );
  }, []);

  const updateServiceFrequency = useCallback((id: string, frequency: Service['frequency']) => {
    setServices((prev) =>
      prev.map((s) => (s.id === id ? { ...s, frequency } : s))
    );
  }, []);

  // Update tier availability for a service
  const updateServiceTierAvailability = useCallback((id: string, tier: TierKey, available: boolean) => {
    setServices((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        
        const newAvailability = { ...s.tierAvailability, [tier]: available };
        
        // If bestOnly is true and we're enabling lower tiers, disable bestOnly
        let newBestOnly = s.bestOnly;
        if (available && tier !== 'best' && s.bestOnly) {
          newBestOnly = false;
        }
        
        // Enforce tier ordering: if a tier is disabled, lower tiers should also be disabled for consistency
        // Actually, we want flexible control, so just update the specific tier
        
        return { ...s, tierAvailability: newAvailability, bestOnly: newBestOnly };
      })
    );
  }, []);

  // Update tier-specific frequency for a service
  const updateServiceTierFrequency = useCallback((id: string, tier: TierKey, frequency: ServiceFrequency) => {
    setServices((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        
        const newFrequencies = { ...s.tierFrequencies, [tier]: frequency };
        
        // Enforce frequency ordering: higher tiers should have >= frequency
        // Convert frequency to visits for comparison
        const visits = (freq: ServiceFrequency) => FREQUENCY_MULTIPLIERS[freq];
        
        if (tier === 'good') {
          // If Good frequency increases, ensure Better and Best are at least as high
          if (visits(frequency) > visits(newFrequencies.better)) {
            newFrequencies.better = frequency;
          }
          if (visits(newFrequencies.better) > visits(newFrequencies.best)) {
            newFrequencies.best = newFrequencies.better;
          }
        } else if (tier === 'better') {
          // Better must be >= Good and <= Best
          if (visits(frequency) < visits(newFrequencies.good)) {
            newFrequencies.good = frequency;
          }
          if (visits(frequency) > visits(newFrequencies.best)) {
            newFrequencies.best = frequency;
          }
        } else if (tier === 'best') {
          // If Best frequency decreases, lower Better and Good if needed
          if (visits(frequency) < visits(newFrequencies.better)) {
            newFrequencies.better = frequency;
          }
          if (visits(newFrequencies.better) < visits(newFrequencies.good)) {
            newFrequencies.good = newFrequencies.better;
          }
        }
        
        return { ...s, tierFrequencies: newFrequencies };
      })
    );
  }, []);

  // Toggle "Best Only" flag
  const updateServiceBestOnly = useCallback((id: string, bestOnly: boolean) => {
    setServices((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        
        if (bestOnly) {
          // Set tier availability to Best only
          return {
            ...s,
            bestOnly: true,
            tierAvailability: { good: false, better: false, best: true },
          };
        } else {
          // Enable all tiers when unchecking bestOnly
          return {
            ...s,
            bestOnly: false,
            tierAvailability: { good: true, better: true, best: true },
          };
        }
      })
    );
  }, []);

  const addCustomService = useCallback(
    (name: string, price: number, frequency: ServiceFrequency, description: string) => {
      const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newService: Service = {
        id,
        name,
        basePrice: price,
        frequency,
        description: description || 'Custom service',
        icon: 'Wrench',
        enabled: true,
        tierAvailability: createDefaultTierAvailability(),
        tierFrequencies: createTierFrequencies(frequency),
        bestOnly: false,
      };
      setServices((prev) => [...prev, newService]);
      setCustomServiceIds((prev) => new Set([...prev, id]));
    },
    []
  );

  const deleteService = useCallback((id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
    setCustomServiceIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const reorderServices = useCallback((activeId: string, overId: string) => {
    setServices((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === activeId);
      const newIndex = prev.findIndex((s) => s.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      
      const newServices = [...prev];
      const [removed] = newServices.splice(oldIndex, 1);
      newServices.splice(newIndex, 0, removed);
      return newServices;
    });
  }, []);

  const togglePerk = useCallback((id: string) => {
    setPerks((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  }, []);

  const updatePerkTier = useCallback((id: string, tier: Perk['tier']) => {
    setPerks((prev) => prev.map((p) => (p.id === id ? { ...p, tier } : p)));
  }, []);

  const addCustomPerk = useCallback(
    (name: string, description: string, tier: Perk['tier']) => {
      const id = `custom-perk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newPerk: Perk = {
        id,
        name,
        description: description || 'Custom perk',
        enabled: true,
        tier,
      };
      setPerks((prev) => [...prev, newPerk]);
      setCustomPerkIds((prev) => new Set([...prev, id]));
    },
    []
  );

  const deletePerk = useCallback((id: string) => {
    setPerks((prev) => prev.filter((p) => p.id !== id));
    setCustomPerkIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const applyBundle = useCallback((bundle: ServiceBundle) => {
    // Update services with full tier configurations
    setServices((prev) => {
      // First, disable all services
      const reset = prev.map(s => ({ ...s, enabled: false }));
      
      // Then enable and configure bundle services with tier-specific settings
      return reset.map(service => {
        const bundleService = bundle.services.find(bs => bs.id === service.id);
        if (bundleService) {
          return {
            ...service,
            enabled: true,
            basePrice: bundleService.basePrice ?? service.basePrice,
            tierAvailability: bundleService.tierAvailability,
            tierFrequencies: bundleService.tierFrequencies,
            bestOnly: bundleService.bestOnly ?? false,
          };
        }
        return service;
      });
    });

    // Apply bundle discounts if provided
    if (bundle.discounts) {
      setDiscounts((prev) => ({
        ...prev,
        goodDiscount: bundle.discounts!.goodDiscount,
        betterDiscount: bundle.discounts!.betterDiscount,
        bestDiscount: bundle.discounts!.bestDiscount,
      }));
    }
  }, []);

  const updateDiscount = useCallback((key: keyof DiscountSettings, value: number) => {
    setDiscounts((prev) => {
      const updated = { ...prev, [key]: value };
      
      // Enforce tier ordering: Good <= Better <= Best
      if (key === 'goodDiscount') {
        // If Good increases above Better, raise Better (and Best if needed)
        if (updated.goodDiscount > updated.betterDiscount) {
          updated.betterDiscount = updated.goodDiscount;
        }
        if (updated.betterDiscount > updated.bestDiscount) {
          updated.bestDiscount = updated.betterDiscount;
        }
      } else if (key === 'betterDiscount') {
        // Better must be >= Good and <= Best
        if (updated.betterDiscount < updated.goodDiscount) {
          updated.goodDiscount = updated.betterDiscount;
        }
        if (updated.betterDiscount > updated.bestDiscount) {
          updated.bestDiscount = updated.betterDiscount;
        }
      } else if (key === 'bestDiscount') {
        // If Best decreases below Better, lower Better (and Good if needed)
        if (updated.bestDiscount < updated.betterDiscount) {
          updated.betterDiscount = updated.bestDiscount;
        }
        if (updated.betterDiscount < updated.goodDiscount) {
          updated.goodDiscount = updated.betterDiscount;
        }
      }
      
      return updated;
    });
  }, []);

  const updateMemberDiscount = useCallback((key: keyof MemberDiscountSettings, value: number) => {
    setMemberDiscounts((prev) => {
      const updated = { ...prev, [key]: value };
      
      // Enforce tier ordering: Good <= Better <= Best
      if (key === 'goodMemberDiscount') {
        if (updated.goodMemberDiscount > updated.betterMemberDiscount) {
          updated.betterMemberDiscount = updated.goodMemberDiscount;
        }
        if (updated.betterMemberDiscount > updated.bestMemberDiscount) {
          updated.bestMemberDiscount = updated.betterMemberDiscount;
        }
      } else if (key === 'betterMemberDiscount') {
        if (updated.betterMemberDiscount < updated.goodMemberDiscount) {
          updated.goodMemberDiscount = updated.betterMemberDiscount;
        }
        if (updated.betterMemberDiscount > updated.bestMemberDiscount) {
          updated.bestMemberDiscount = updated.betterMemberDiscount;
        }
      } else if (key === 'bestMemberDiscount') {
        if (updated.bestMemberDiscount < updated.betterMemberDiscount) {
          updated.betterMemberDiscount = updated.bestMemberDiscount;
        }
        if (updated.betterMemberDiscount < updated.goodMemberDiscount) {
          updated.goodMemberDiscount = updated.betterMemberDiscount;
        }
      }
      
      return updated;
    });
  }, []);

  const updateBusinessDetails = useCallback((key: keyof BusinessDetails, value: string) => {
    setBusinessDetails((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updateAgreementTerms = useCallback((key: keyof AgreementTerms, value: string | number) => {
    setAgreementTerms((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Calculate annual value for a list of tier service configs
  const calculateTierAnnualValue = useCallback((tierServices: TierServiceConfig[]): number => {
    return tierServices.reduce((total, ts) => total + ts.annualValue, 0);
  }, []);

  // Build tier service configurations using tier-specific availability and frequency
  const buildTierServices = useCallback((
    enabledServices: Service[],
    tier: TierKey
  ): TierServiceConfig[] => {
    const tierServices: TierServiceConfig[] = [];

    enabledServices.forEach(service => {
      // Check if service is available in this tier
      if (!service.tierAvailability[tier]) {
        return; // Skip this service for this tier
      }

      // Get the tier-specific frequency
      const tierFrequency = service.tierFrequencies[tier];
      const annualVisits = FREQUENCY_MULTIPLIERS[tierFrequency];
      const annualValue = service.basePrice * annualVisits;

      tierServices.push({
        service,
        tierFrequency,
        annualVisits,
        annualValue,
      });
    });

    return tierServices;
  }, []);

  const packages = useMemo<PackageTier[]>(() => {
    const enabledServices = services.filter((s) => s.enabled);
    
    if (enabledServices.length === 0) {
      return [];
    }

    // Build tier-specific service configurations
    const goodTierServices = buildTierServices(enabledServices, 'good');
    const betterTierServices = buildTierServices(enabledServices, 'better');
    const bestTierServices = buildTierServices(enabledServices, 'best');

    // Calculate base annual values (before discount)
    const goodBaseAnnual = calculateTierAnnualValue(goodTierServices);
    const betterBaseAnnual = calculateTierAnnualValue(betterTierServices);
    const bestBaseAnnual = calculateTierAnnualValue(bestTierServices);

    // Calculate savings based on discounts
    const goodSavings = goodBaseAnnual * (discounts.goodDiscount / 100);
    const betterSavings = betterBaseAnnual * (discounts.betterDiscount / 100);
    const bestSavings = bestBaseAnnual * (discounts.bestDiscount / 100);

    // Build perks
    // - Regular perks: inherit upward (good => all tiers, better => better+best, best => best only)
    // - Discount perks: show exactly one per package (0/5/10/etc), without duplicating $ savings text
    const tierRank: Record<TierKey, number> = { good: 0, better: 1, best: 2 };
    const perkAppliesToTier = (perk: Perk, tier: TierKey) => tierRank[perk.tier] <= tierRank[tier];
    const isDiscountPerk = (perk: Perk) => perk.id.startsWith('tier-discount-');

    const buildPerksForTier = (tier: TierKey, memberDiscountPercent: number): Perk[] => {
      const basePerks = perks.filter(
        (p) => p.enabled && !isDiscountPerk(p) && perkAppliesToTier(p, tier)
      );

      const discountPerk = perks.find(
        (p) => p.enabled && p.id === `tier-discount-${tier}`
      );

      if (!discountPerk) return basePerks;

      // Use memberDiscounts (separate from tier discounts) for the member discount perk
      return [{ ...discountPerk, name: `${memberDiscountPercent}% Member Discount on Additional Cleaning Services`, tier }, ...basePerks];
    };

    // Use memberDiscounts (NOT tier discounts) for member discount perks
    const goodPerks = buildPerksForTier('good', memberDiscounts.goodMemberDiscount);
    const betterPerks = buildPerksForTier('better', memberDiscounts.betterMemberDiscount);
    const bestPerks = buildPerksForTier('best', memberDiscounts.bestMemberDiscount);

    // Calculate final prices
    const goodFinal = goodBaseAnnual - goodSavings;
    const betterFinal = betterBaseAnnual - betterSavings;
    const bestFinal = bestBaseAnnual - bestSavings;

    // Monthly and deposit calculations
    const goodMonthly = goodFinal / 12;
    const betterMonthly = betterFinal / 12;
    const bestMonthly = bestFinal / 12;

    const goodDeposit = goodFinal * (depositPercent / 100);
    const betterDeposit = betterFinal * (depositPercent / 100);
    const bestDeposit = bestFinal * (depositPercent / 100);

    // Pay in full calculations
    const goodPayInFull = goodFinal * (1 - discounts.payInFullDiscount / 100);
    const betterPayInFull = betterFinal * (1 - discounts.payInFullDiscount / 100);
    const bestPayInFull = bestFinal * (1 - discounts.payInFullDiscount / 100);

    // Extract services from tier configs for backward compatibility
    const goodServices = goodTierServices.map(ts => ts.service);
    const betterServices = betterTierServices.map(ts => ts.service);
    const bestServices = bestTierServices.map(ts => ts.service);

    return [
      {
        name: 'Good',
        tier: 'good',
        tierLabel: TIER_LABELS.good,
        services: goodServices,
        tierServices: goodTierServices,
        perks: goodPerks,
        annualTotal: goodFinal,
        baseAnnualValue: goodBaseAnnual,
        monthlyPrice: goodMonthly,
        depositAmount: goodDeposit,
        savings: goodSavings,
        savingsPercent: discounts.goodDiscount,
        payInFullPrice: goodPayInFull,
        payInFullSavings: goodFinal - goodPayInFull,
      },
      {
        name: 'Better',
        tier: 'better',
        tierLabel: TIER_LABELS.better,
        services: betterServices,
        tierServices: betterTierServices,
        perks: betterPerks,
        annualTotal: betterFinal,
        baseAnnualValue: betterBaseAnnual,
        monthlyPrice: betterMonthly,
        depositAmount: betterDeposit,
        savings: betterSavings,
        savingsPercent: discounts.betterDiscount,
        payInFullPrice: betterPayInFull,
        payInFullSavings: betterFinal - betterPayInFull,
      },
      {
        name: 'Best',
        tier: 'best',
        tierLabel: TIER_LABELS.best,
        services: bestServices,
        tierServices: bestTierServices,
        perks: bestPerks,
        annualTotal: bestFinal,
        baseAnnualValue: bestBaseAnnual,
        monthlyPrice: bestMonthly,
        depositAmount: bestDeposit,
        savings: bestSavings,
        savingsPercent: discounts.bestDiscount,
        payInFullPrice: bestPayInFull,
        payInFullSavings: bestFinal - bestPayInFull,
      },
    ];
  }, [services, perks, discounts, memberDiscounts, depositPercent, buildTierServices, calculateTierAnnualValue]);

  const warnings = useMemo<string[]>(() => {
    const warns: string[] = [];
    
    // Discount range validations
    if (discounts.bestDiscount > 20) {
      warns.push('Best tier discount exceeds 20% — consider lowering to protect margins.');
    }
    if (discounts.goodDiscount > 10) {
      warns.push('Good tier discount exceeds recommended 10% max.');
    }
    if (discounts.betterDiscount > 12 && discounts.betterDiscount <= discounts.bestDiscount) {
      warns.push('Better tier discount exceeds recommended 12% max.');
    }
    
    // Tier ordering validation (should be Good ≤ Better ≤ Best)
    if (discounts.goodDiscount > discounts.betterDiscount) {
      warns.push('Good tier discount should be ≤ Better tier.');
    }
    if (discounts.betterDiscount > discounts.bestDiscount) {
      warns.push('Better tier discount should be ≤ Best tier.');
    }
    
    const enabledServices = services.filter((s) => s.enabled);
    if (enabledServices.length === 0) {
      warns.push('Select at least one service to build packages.');
    }
    
    // Check for pricing inversion (Best should be more expensive than Better, Better more than Good)
    if (packages.length === 3) {
      if (packages[0].annualTotal >= packages[1].annualTotal) {
        warns.push('Pricing issue: Good tier is priced equal to or higher than Better tier.');
      }
      if (packages[1].annualTotal >= packages[2].annualTotal) {
        warns.push('Pricing issue: Better tier is priced equal to or higher than Best tier.');
      }
      
      // Soft guardrail: Best pricing approaches Better (within 10%)
      const betterTotal = packages[1].annualTotal;
      const bestTotal = packages[2].annualTotal;
      const priceDifference = ((bestTotal - betterTotal) / betterTotal) * 100;
      if (priceDifference > 0 && priceDifference < 10) {
        warns.push('Best plans are designed to provide maximum coverage and long-term value. Consider adding exclusive services or higher frequency.');
      }
      
      // Check for service count inversion (higher tiers should have >= services)
      if (packages[0].tierServices.length > packages[1].tierServices.length) {
        warns.push('Service issue: Good tier has more services than Better tier.');
      }
      if (packages[1].tierServices.length > packages[2].tierServices.length) {
        warns.push('Service issue: Better tier has more services than Best tier.');
      }
      
      // Check for visit count inversion (higher tiers should have >= total visits)
      const goodVisits = packages[0].tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0);
      const betterVisits = packages[1].tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0);
      const bestVisits = packages[2].tierServices.reduce((sum, ts) => sum + ts.annualVisits, 0);
      
      if (goodVisits > betterVisits) {
        warns.push('Visit issue: Good tier has more annual visits than Better tier.');
      }
      if (betterVisits > bestVisits) {
        warns.push('Visit issue: Better tier has more annual visits than Best tier.');
      }
      
      // Soft nudge: Best has same frequency as Better but no exclusive services
      const bestOnlyServices = packages[2].tierServices.filter(
        ts => !packages[1].tierServices.some(bts => bts.service.id === ts.service.id)
      );
      if (bestVisits === betterVisits && bestOnlyServices.length === 0) {
        warns.push('Best plans typically include higher visit frequency or exclusive services to differentiate from Better.');
      }
    }
    
    const lowPriceServices = enabledServices.filter((s) => s.basePrice < 50);
    if (lowPriceServices.length > 0) {
      warns.push(`Low pricing detected on: ${lowPriceServices.map((s) => s.name).join(', ')}`);
    }

    return warns;
  }, [discounts, services, packages]);

  const config: PlanConfig = {
    businessName: businessDetails.businessName,
    customerName,
    services,
    perks,
    discounts,
    depositPercent,
  };

  return {
    services,
    customServiceIds,
    perks,
    customPerkIds,
    discounts,
    memberDiscounts,
    packages,
    warnings,
    config,
    depositPercent,
    businessDetails,
    agreementTerms,
    customerName,
    customerAddress,
    selectedTier,
    showLimitedTimeOffer,
    limitedTimeOfferText,
    limitedTimeOfferExpiry,
    pricingDisplayMode,
    toggleService,
    updateServicePrice,
    updateServiceNote,
    updateServiceFrequency,
    updateServiceTierAvailability,
    updateServiceTierFrequency,
    updateServiceBestOnly,
    addCustomService,
    deleteService,
    reorderServices,
    togglePerk,
    updatePerkTier,
    addCustomPerk,
    deletePerk,
    applyBundle,
    updateDiscount,
    updateMemberDiscount,
    setDepositPercent,
    updateBusinessDetails,
    updateAgreementTerms,
    setCustomerName,
    setCustomerAddress,
    setSelectedTier,
    setShowLimitedTimeOffer,
    setLimitedTimeOfferText,
    setLimitedTimeOfferExpiry,
    setPricingDisplayMode,
  };
}
