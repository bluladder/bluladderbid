import { useRef, useState } from 'react';
import { Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { HomeDetails } from '@/types/homeowner';
import { SqftLookupHelper } from './SqftLookupHelper';

interface HomeDetailsFormProps {
  homeDetails: HomeDetails;
  onChange: (updates: Partial<HomeDetails>) => void;
  /** Optional address to prefill in the sqft lookup helper. */
  formattedAddress?: string;
}

// Fires a lightweight, PII-free internal analytics event. We intentionally do
// NOT include the address, name, email, or any customer identifier — only the
// event name and (for lookup clicks) the source key.
function emitInternalAnalytics(
  event:
    | 'square_footage_help_opened'
    | 'square_footage_lookup_clicked'
    | 'square_footage_entered_after_lookup',
  detail?: Record<string, string | number | boolean>,
) {
  try {
    if (typeof window === 'undefined') return;
    const dl = (window as unknown as { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
    if (Array.isArray(dl)) dl.push({ event, ...(detail || {}) });
    window.dispatchEvent(new CustomEvent(`bluladder:${event}`, { detail }));
  } catch {
    /* analytics must never break UX */
  }
}

// Parse a user-entered sqft string that may include commas / spaces.
function parseSqft(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, '');
  if (cleaned === '') return 0;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function formatSqft(n: number): string {
  if (!n || n <= 0) return '';
  return n.toLocaleString('en-US');
}

export function HomeDetailsForm({
  homeDetails,
  onChange,
  formattedAddress,
}: HomeDetailsFormProps) {
  const [helperOpen, setHelperOpen] = useState(false);
  const [awaitingLookupReturn, setAwaitingLookupReturn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const openHelper = () => {
    emitInternalAnalytics('square_footage_help_opened');
    setHelperOpen(true);
  };

  const handleLookup = (source: 'zillow' | 'realtor' | 'public_records') => {
    emitInternalAnalytics('square_footage_lookup_clicked', { source });
    setAwaitingLookupReturn(true);
  };

  const handleHelperOpenChange = (next: boolean) => {
    setHelperOpen(next);
    if (!next && awaitingLookupReturn) {
      // Bring focus back to the sqft field so it's easy to type the number.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <Home className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Tell Us About Your Home</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              We'll use this to calculate your exact pricing
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Home Size */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sqft" className="text-sm font-medium">
              Home Square Footage <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sqft"
              ref={inputRef}
              type="text"
              value={formatSqft(homeDetails.squareFootage)}
              onChange={(e) => {
                const next = parseSqft(e.target.value);
                if (awaitingLookupReturn && next > 0 && next !== homeDetails.squareFootage) {
                  emitInternalAnalytics('square_footage_entered_after_lookup', {
                    sqft: next,
                  });
                  setAwaitingLookupReturn(false);
                }
                onChange({ squareFootage: next });
              }}
              onFocus={(e) => {
                if (homeDetails.squareFootage > 0) {
                  e.target.select();
                }
              }}
              className="input-field text-lg h-12"
              placeholder="Enter your home's sq ft (e.g. 2,500)"
              inputMode="numeric"
              autoComplete="off"
              aria-describedby="sqft-help sqft-lookup-copy"
            />
            <p id="sqft-help" className="text-xs text-muted-foreground">
              Use your home's total heated or finished living area. Do not include the
              garage, patio, porch, lot size, or unfinished space.
            </p>
            <button
              type="button"
              onClick={openHelper}
              className="text-xs font-medium text-primary hover:underline underline-offset-2"
              id="sqft-lookup-copy"
            >
              Not sure? Find your home's square footage
            </button>
          </div>
          
          <div className="space-y-2">
            <Label className="text-sm font-medium">Number of Stories</Label>
            <RadioGroup
              value={String(homeDetails.stories)}
              onValueChange={(v) => onChange({ stories: parseInt(v) as 1 | 2 | 3 })}
              className="flex gap-4"
            >
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center space-x-2">
                  <RadioGroupItem value={String(n)} id={`stories-${n}`} />
                  <Label htmlFor={`stories-${n}`} className="cursor-pointer">
                    {n} {n === 1 ? 'Story' : 'Stories'}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>

        <SqftLookupHelper
          open={helperOpen}
          onOpenChange={handleHelperOpenChange}
          initialAddress={formattedAddress}
          onLookup={handleLookup}
        />
      </CardContent>
    </Card>
  );
}
