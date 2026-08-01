import { useState, type KeyboardEvent } from 'react';
import { Check, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ServicePlanTierPrice } from '@/types/servicePlanBuilder';
import {
  HARD_WATER_SUPPORT,
  MAINTENANCE_PLAN_DEFINITIONS,
  PLAN_DISCOUNT_EXCLUSIONS,
  type PlanDefinition,
} from './maintenancePlanDefinitions';
import type { PlanTier } from './TierSelector';

const FAIR_USE_SUPPORT =
  'Touch-ups cover qualifying window spots or workmanship concerns within the included scope and normal access. New damage, restoration, changed conditions and excluded work require review.';
const MAINTENANCE_PLANS = Object.values(MAINTENANCE_PLAN_DEFINITIONS);

interface PlanTierCardsProps {
  selectedTier: PlanTier;
  onSelectTier: (tier: PlanTier) => void;
  tierPrices: Record<PlanTier, ServicePlanTierPrice>;
  hasHomeDetails: boolean;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function unavailableText(pricingLoading?: boolean, pricingUnavailable?: boolean): string {
  if (pricingLoading) return 'Updating authoritative pricing…';
  if (pricingUnavailable) return 'Unavailable';
  return 'Pending authoritative pricing';
}

export function PlanPaymentPresentation({
  price,
  pricingLoading,
  pricingUnavailable,
  compact = false,
}: {
  price: ServicePlanTierPrice;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
  compact?: boolean;
}) {
  const unavailable = unavailableText(pricingLoading, pricingUnavailable);
  const firstPayment = price.firstPayment === null
    ? `First payment: ${unavailable}`
    : `${formatMoney(price.firstPayment)} due at enrollment`;
  const monthlyPayments = price.monthlyPayment === null || price.remainingPaymentCount === null
    ? `Remaining monthly payments: ${unavailable}`
    : `Then ${price.remainingPaymentCount} monthly payments of ${formatMoney(price.monthlyPayment)}`;
  const annualTotal = price.annualTotal === null
    ? `Annual plan total: ${unavailable}`
    : `Annual plan total: ${formatMoney(price.annualTotal)}`;
  const savings = price.estimatedSavings === null
    ? 'Estimated annual savings: Pending authoritative savings'
    : `Estimated annual savings: ${formatMoney(price.estimatedSavings)}`;

  return (
    <div className={compact ? 'space-y-1 text-sm' : 'space-y-2 text-sm'} data-testid="plan-payment-presentation">
      <p className="font-semibold text-foreground">{firstPayment}</p>
      <p className="text-muted-foreground">{monthlyPayments}</p>
      <p className="text-muted-foreground">{annualTotal}</p>
      <p className="text-muted-foreground">{savings}</p>
    </div>
  );
}

function ExpandableBenefit({ label, support }: { label: string; support: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer rounded-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {label}
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{support}</p>
    </details>
  );
}

function ComparisonValue({ value }: { value: string }) {
  if (value === 'Included') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Check className="h-4 w-4 text-primary" aria-hidden="true" /> Included
      </span>
    );
  }

  return value;
}

function MobilePlanPanel({
  plan,
  price,
  onSelectTier,
  hasHomeDetails,
  pricingLoading,
  pricingUnavailable,
}: {
  plan: PlanDefinition;
  price: ServicePlanTierPrice;
  onSelectTier: (tier: PlanTier) => void;
  hasHomeDetails: boolean;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
}) {
  return (
    <Card className={plan.recommended ? 'border-primary/40 shadow-md' : ''}>
      <CardContent className="space-y-5 p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold text-foreground">{plan.name}</h3>
            {plan.recommended && (
              <Badge className="gap-1">
                <Star className="h-3.5 w-3.5 fill-current" /> Recommended
              </Badge>
            )}
          </div>
          <p className="leading-relaxed text-muted-foreground">{plan.positioning}</p>
          <p className="font-medium text-foreground">{plan.outcome}</p>
        </div>

        <ul className="space-y-2" aria-label={`${plan.name} core services`}>
          {plan.keyServices.map((service) => (
            <li key={service} className="flex gap-2 text-sm leading-relaxed">
              <Check className="mt-0.5 h-4 w-4 flex-none text-primary" aria-hidden="true" />
              <span>{service}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-lg border bg-muted/30 p-4">
          <PlanPaymentPresentation
            price={price}
            pricingLoading={pricingLoading}
            pricingUnavailable={pricingUnavailable}
          />
        </div>

        <div className="space-y-3 text-sm">
          <p className="font-semibold text-primary">{plan.discount}</p>
          <ExpandableBenefit label={plan.guarantee} support={plan.guaranteeSupport} />
          <ExpandableBenefit label={plan.hardWater} support={HARD_WATER_SUPPORT} />
          <ExpandableBenefit label={plan.coating} support="A technician will confirm whether recurring sprinkler exposure and the glass condition make coating appropriate." />
          <ExpandableBenefit label="Guarantee exclusions and fair use" support={FAIR_USE_SUPPORT} />
          <p><span className="font-medium">Scheduling:</span> {plan.priority}</p>
          <p className="leading-relaxed text-muted-foreground">{PLAN_DISCOUNT_EXCLUSIONS}</p>
        </div>

        <Button
          type="button"
          className="min-h-12 w-full"
          onClick={() => onSelectTier(plan.id)}
          disabled={!hasHomeDetails}
        >
          Customize This Plan
        </Button>
        {!hasHomeDetails && (
          <p className="text-center text-sm text-muted-foreground">Enter your home details above to request authoritative plan pricing.</p>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Frequency and service customization will be confirmed before activation.
        </p>
      </CardContent>
    </Card>
  );
}

const COMPARISON_ROWS: Array<{
  label: string;
  value: (plan: PlanDefinition, price: ServicePlanTierPrice) => string;
}> = [
  { label: 'Exterior windows', value: (plan) => plan.exteriorWindows },
  { label: 'Interior windows', value: (plan) => plan.interiorWindows },
  { label: 'Gutter cleaning', value: (plan) => plan.gutterCleaning },
  { label: 'House wash', value: (plan) => plan.houseWash },
  { label: 'Driveway cleaning', value: (plan) => plan.drivewayCleaning },
  { label: 'Additional pressure washing', value: (plan) => plan.pressureWashing },
  { label: 'Minimum categories', value: (plan) => plan.minimumCategories },
  { label: 'Additional-service discount', value: (plan) => plan.discount },
  { label: 'Guarantee', value: (plan) => plan.guarantee },
  { label: 'Hard water', value: (plan) => plan.hardWater },
  { label: 'Preventive coating', value: (plan) => plan.coating },
  { label: 'Scheduling priority', value: (plan) => plan.priority },
  { label: 'Custom frequency availability', value: () => 'Confirmed before activation' },
  { label: 'First payment', value: (_plan, price) => price.firstPayment === null ? 'Pending authoritative pricing' : `${formatMoney(price.firstPayment)} due at enrollment` },
  { label: 'Remaining monthly payments', value: (_plan, price) => price.monthlyPayment === null || price.remainingPaymentCount === null ? 'Pending authoritative pricing' : `${price.remainingPaymentCount} payments of ${formatMoney(price.monthlyPayment)}` },
  { label: 'Annual total', value: (_plan, price) => price.annualTotal === null ? 'Pending authoritative pricing' : formatMoney(price.annualTotal) },
  { label: 'Estimated savings', value: (_plan, price) => price.estimatedSavings === null ? 'Pending authoritative savings' : formatMoney(price.estimatedSavings) },
];

export function PlanTierCards({
  selectedTier,
  onSelectTier,
  tierPrices,
  hasHomeDetails,
  pricingLoading,
  pricingUnavailable,
}: PlanTierCardsProps) {
  const [mobileTier, setMobileTier] = useState<PlanTier>(selectedTier);

  const handleMobileTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tier: PlanTier) => {
    const currentIndex = MAINTENANCE_PLANS.findIndex((plan) => plan.id === tier);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % MAINTENANCE_PLANS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + MAINTENANCE_PLANS.length) % MAINTENANCE_PLANS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = MAINTENANCE_PLANS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    event.stopPropagation();
    const nextTier = MAINTENANCE_PLANS[nextIndex].id;
    setMobileTier(nextTier);
    document.getElementById(`maintenance-plan-tab-${nextTier}`)?.focus();
  };

  return (
    <section aria-labelledby="maintenance-plans-heading" className="space-y-6">
      <div className="mx-auto max-w-3xl text-center">
        <h2 id="maintenance-plans-heading" className="text-2xl font-bold text-foreground md:text-3xl">
          Choose Your Maintenance Plan
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Compare the included care, guarantees and authoritative payment information before choosing a plan to customize.
        </p>
      </div>

      <div className="lg:hidden" data-testid="mobile-plan-tabs">
        <Tabs value={mobileTier} onValueChange={(value) => setMobileTier(value as PlanTier)}>
          <TabsList className="sticky top-0 z-20 grid h-auto w-full grid-cols-3 bg-background/95 p-1 shadow-sm backdrop-blur">
            {MAINTENANCE_PLANS.map((plan) => (
              <TabsTrigger
                key={plan.id}
                id={`maintenance-plan-tab-${plan.id}`}
                value={plan.id}
                className="min-h-11 whitespace-normal px-2 text-sm"
                onKeyDown={(event) => handleMobileTabKeyDown(event, plan.id)}
              >
                {plan.shortName}
              </TabsTrigger>
            ))}
          </TabsList>
          {MAINTENANCE_PLANS.map((plan) => (
            <TabsContent key={plan.id} value={plan.id} className="mt-4">
              <MobilePlanPanel
                plan={plan}
                price={tierPrices[plan.id]}
                onSelectTier={onSelectTier}
                hasHomeDetails={hasHomeDetails}
                pricingLoading={pricingLoading}
                pricingUnavailable={pricingUnavailable}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="hidden lg:block" data-testid="desktop-plan-comparison">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <caption className="sr-only">BluLadder maintenance plan service, benefit and payment comparison</caption>
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[25.33%]" />
            <col className="w-[25.33%]" />
            <col className="w-[25.33%]" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-background">
            <tr>
              <th scope="col" className="border-b border-r bg-muted/70 p-3 text-left font-semibold">
                Service or Benefit
              </th>
              {MAINTENANCE_PLANS.map((plan) => (
                <th key={plan.id} scope="col" className={plan.recommended ? 'border-b bg-primary/10 p-3 text-left align-top' : 'border-b bg-background p-3 text-left align-top'}>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold">{plan.name}</span>
                      {plan.recommended && <Badge>Recommended</Badge>}
                    </div>
                    <p className="font-normal leading-relaxed text-muted-foreground">{plan.positioning}</p>
                    <PlanPaymentPresentation
                      price={tierPrices[plan.id]}
                      pricingLoading={pricingLoading}
                      pricingUnavailable={pricingUnavailable}
                      compact
                    />
                    <Button type="button" className="w-full" variant={plan.recommended ? 'default' : 'outline'} onClick={() => onSelectTier(plan.id)} disabled={!hasHomeDetails}>
                      Customize This Plan
                    </Button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border-b border-r bg-muted/40 p-3 text-left font-medium text-foreground">
                  {row.label}
                </th>
                {MAINTENANCE_PLANS.map((plan) => (
                  <td key={plan.id} className={plan.recommended ? 'border-b bg-primary/[0.03] p-3 align-top leading-relaxed' : 'border-b p-3 align-top leading-relaxed'}>
                    <ComparisonValue value={row.value(plan, tierPrices[plan.id])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 grid grid-cols-[24%_1fr_1fr_1fr] gap-0 rounded-lg border bg-muted/20 p-3 text-sm">
          <p className="pr-3 font-semibold">Details and exclusions</p>
          {MAINTENANCE_PLANS.map((plan) => (
            <div key={plan.id} className="space-y-2 px-3">
              <ExpandableBenefit label={plan.guarantee} support={plan.guaranteeSupport} />
              <ExpandableBenefit label={plan.hardWater} support={HARD_WATER_SUPPORT} />
              <ExpandableBenefit label="Guarantee exclusions and fair use" support={FAIR_USE_SUPPORT} />
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-sm leading-relaxed text-muted-foreground">{PLAN_DISCOUNT_EXCLUSIONS}</p>
      {!hasHomeDetails && (
        <p className="text-center text-sm text-muted-foreground">Enter your home details above to request authoritative plan pricing.</p>
      )}
    </section>
  );
}
