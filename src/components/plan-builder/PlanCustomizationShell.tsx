import { useState } from 'react';
import { Check, Clock3, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ServicePlanTierPrice } from '@/types/servicePlanBuilder';
import {
  MAINTENANCE_PLAN_DEFINITIONS,
  PLAN_DISCOUNT_EXCLUSIONS,
} from './maintenancePlanDefinitions';
import { PlanPaymentPresentation } from './PlanTierCards';
import { FIRST_VISIT_NOTE_LIMIT, sanitizeFirstVisitNote } from './planPresentationInput';
import type { PlanTier } from './TierSelector';

interface PlanCustomizationShellProps {
  tier: PlanTier;
  price: ServicePlanTierPrice;
  pricingLoading?: boolean;
  pricingUnavailable?: boolean;
}

export function PlanCustomizationShell({
  tier,
  price,
  pricingLoading,
  pricingUnavailable,
}: PlanCustomizationShellProps) {
  const plan = MAINTENANCE_PLAN_DEFINITIONS[tier];
  const [firstVisitNote, setFirstVisitNote] = useState('');
  const [importantDate, setImportantDate] = useState('');
  const [urgentService, setUrgentService] = useState('');
  const [preferredSeason, setPreferredSeason] = useState('');
  const [datesToAvoid, setDatesToAvoid] = useState('');
  const [schedulingNotes, setSchedulingNotes] = useState('');

  return (
    <div className="space-y-6" data-testid="plan-customization-shell">
      <Card className="border-primary/30">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Settings2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-2xl">Customize {plan.name}</CardTitle>
              <p className="mt-1 leading-relaxed text-muted-foreground">{plan.positioning}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">Recommended services and frequencies</h3>
              <ul className="mt-3 space-y-2">
                {plan.keyServices.map((service) => (
                  <li key={service} className="flex gap-2 text-sm leading-relaxed">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-primary" aria-hidden="true" />
                    <span>{service}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="rounded-lg bg-muted/50 p-3 text-sm font-medium text-foreground">
              Frequency and service customization will be confirmed before activation.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" variant="outline" disabled>
                Adjust frequency — Coming next
              </Button>
              <Button type="button" variant="outline" disabled>
                Add or remove services — Coming next
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <h3 className="mb-3 font-semibold text-foreground">Authoritative payment summary</h3>
            <PlanPaymentPresentation
              price={price}
              pricingLoading={pricingLoading}
              pricingUnavailable={pricingUnavailable}
            />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              This is a plan preview, not an enrollment or payment request.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">First-visit details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="first-visit-note">Does anything need extra attention on the first visit?</Label>
          <Textarea
            id="first-visit-note"
            value={firstVisitNote}
            onChange={(event) => setFirstVisitNote(sanitizeFirstVisitNote(event.target.value))}
            maxLength={FIRST_VISIT_NOTE_LIMIT}
            rows={5}
            aria-describedby="first-visit-note-helper first-visit-note-count"
          />
          <p id="first-visit-note-helper" className="text-sm leading-relaxed text-muted-foreground">
            Tell us about stains, problem areas, access concerns or anything else our team should know. This will not change your plan price automatically.
          </p>
          <p id="first-visit-note-count" className="text-right text-sm text-muted-foreground" aria-live="polite">
            {FIRST_VISIT_NOTE_LIMIT - firstVisitNote.length} characters remaining
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-5 w-5 flex-none text-primary" aria-hidden="true" />
            <div>
              <CardTitle className="text-xl">Scheduling preferences</CardTitle>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Share timing preferences for BluLadder to review. These fields do not reserve an appointment.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="important-date">Important date or event</Label>
              <Input id="important-date" value={importantDate} onChange={(event) => setImportantDate(event.target.value.slice(0, 120))} maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="urgent-service">Which service is most urgent?</Label>
              <select
                id="urgent-service"
                value={urgentService}
                onChange={(event) => setUrgentService(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">No priority selected</option>
                <option value="windows">Window cleaning</option>
                <option value="gutters">Gutter cleaning</option>
                <option value="house-wash">House wash</option>
                <option value="driveway">Driveway cleaning</option>
                <option value="other">Another included service</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="preferred-season">Preferred month or season</Label>
              <Input id="preferred-season" value={preferredSeason} onChange={(event) => setPreferredSeason(event.target.value.slice(0, 120))} maxLength={120} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dates-to-avoid">Months or dates to avoid</Label>
              <Input id="dates-to-avoid" value={datesToAvoid} onChange={(event) => setDatesToAvoid(event.target.value.slice(0, 160))} maxLength={160} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduling-notes">Additional scheduling notes</Label>
            <Textarea id="scheduling-notes" value={schedulingNotes} onChange={(event) => setSchedulingNotes(event.target.value.slice(0, 500))} maxLength={500} rows={4} />
          </div>
          <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-medium leading-relaxed text-foreground">
            These are preferences, not appointments. BluLadder will contact you to confirm the exact service schedule after you submit your plan.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{PLAN_DISCOUNT_EXCLUSIONS}</p>
          <Button type="button" className="w-full" disabled>
            Continue — Coming next
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
