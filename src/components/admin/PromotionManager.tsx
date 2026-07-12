import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tag } from 'lucide-react';
import { usePricingConfigRows, useUpdatePricingConfig } from '@/hooks/usePricingConfig';

interface PromoValue {
  active: boolean;
  promoId: string;
  version: number;
  flatPrice: number;
  maxWindows: number;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  prepInstructions: string;
  stackingPolicy: 'none' | 'allow_discount_codes';
  serviceLabel?: string;
  terms?: string;
}

const DEFAULT_PROMO: PromoValue = {
  active: false,
  promoId: 'PROMO_99_WINDOWS',
  version: 1,
  flatPrice: 99,
  maxWindows: 10,
  effectiveStart: null,
  effectiveEnd: null,
  prepInstructions:
    'Customer must remove all window screens before BluLadder arrives. Screen removal and screen cleaning are not included. Interior window cleaning is not included. Tracks and sills are not included.',
  stackingPolicy: 'none',
  serviceLabel: '$99 Exterior Window Cleaning (up to 10 windows)',
  terms: 'Residential exterior window cleaning only. Covers up to 10 standard exterior windows.',
};

/**
 * Administrator control for the structured $99 window promotion.
 * Every field here is authoritative for calculate-quote. The promotion is NEVER
 * applied automatically — the customer must explicitly select it.
 */
export function PromotionManager() {
  const { data: rows, isLoading } = usePricingConfigRows();
  const update = useUpdatePricingConfig();
  const [promo, setPromo] = useState<PromoValue>(DEFAULT_PROMO);

  useEffect(() => {
    const row = rows?.find((r) => r.config_key === 'window_promo_99');
    if (row?.config_value) {
      setPromo({ ...DEFAULT_PROMO, ...(row.config_value as unknown as PromoValue) });
    }
  }, [rows]);

  const set = <K extends keyof PromoValue>(key: K, value: PromoValue[K]) =>
    setPromo((p) => ({ ...p, [key]: value }));

  const save = () => {
    // Bump the version on every save so booked snapshots stay traceable.
    const next: PromoValue = { ...promo, version: (promo.version ?? 0) + 1 };
    update.mutate({ configKey: 'window_promo_99', configValue: next as unknown as Record<string, unknown> });
    setPromo(next);
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading promotion…</p>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" /> $99 Window Promotion
            </CardTitle>
            <CardDescription>
              Server-authoritative promotional offer. Applied only when a customer explicitly selects it.
            </CardDescription>
          </div>
          <Badge variant={promo.active ? 'default' : 'outline'}>
            {promo.active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label>Active</Label>
            <p className="text-xs text-muted-foreground">Turn the promotion on or off for customers.</p>
          </div>
          <Switch checked={promo.active} onCheckedChange={(v) => set('active', v)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Promotional identifier</Label>
            <Input value={promo.promoId} onChange={(e) => set('promoId', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Flat price ($)</Label>
            <Input
              type="number"
              value={promo.flatPrice}
              onChange={(e) => set('flatPrice', Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>Maximum included windows</Label>
            <Input
              type="number"
              value={promo.maxWindows}
              onChange={(e) => set('maxWindows', Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>Stacking policy</Label>
            <Select
              value={promo.stackingPolicy}
              onValueChange={(v) => set('stackingPolicy', v as PromoValue['stackingPolicy'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No stacking (recommended)</SelectItem>
                <SelectItem value="allow_discount_codes">Allow discount codes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Effective start (optional)</Label>
            <Input
              type="date"
              value={promo.effectiveStart ?? ''}
              onChange={(e) => set('effectiveStart', e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label>Effective end (optional)</Label>
            <Input
              type="date"
              value={promo.effectiveEnd ?? ''}
              onChange={(e) => set('effectiveEnd', e.target.value || null)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Customer-facing label</Label>
          <Input
            value={promo.serviceLabel ?? ''}
            onChange={(e) => set('serviceLabel', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Preparation instructions (added to booking notes &amp; Jobber)</Label>
          <Textarea
            rows={3}
            value={promo.prepInstructions}
            onChange={(e) => set('prepInstructions', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Terms</Label>
          <Textarea rows={2} value={promo.terms ?? ''} onChange={(e) => set('terms', e.target.value)} />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Current version: v{promo.version}</p>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save promotion'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
