import { useEffect, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SqftLookupHelperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAddress?: string;
  /** Called with the lookup source key when the customer opens an external tab. */
  onLookup?: (source: 'zillow' | 'realtor' | 'public_records') => void;
}

/**
 * Compact modal that helps a customer find their home's finished square footage
 * using their property address. We never scrape or auto-import a value — the
 * customer returns and types the number they saw.
 */
export function SqftLookupHelper({
  open,
  onOpenChange,
  initialAddress = '',
  onLookup,
}: SqftLookupHelperProps) {
  const [address, setAddress] = useState(initialAddress);

  // Keep the modal in sync when a prefilled address becomes available.
  useEffect(() => {
    if (open) setAddress(initialAddress || '');
  }, [open, initialAddress]);

  const q = encodeURIComponent(address.trim());
  const canSearch = address.trim().length > 3;

  const links: Array<{
    key: 'zillow' | 'realtor' | 'public_records';
    label: string;
    url: string;
  }> = [
    {
      key: 'zillow',
      label: 'Search Zillow',
      url: `https://www.zillow.com/homes/${q}_rb/`,
    },
    {
      key: 'realtor',
      label: 'Search Realtor.com',
      url: `https://www.realtor.com/realestateandhomes-search/${q}`,
    },
    {
      key: 'public_records',
      label: 'Search public property records',
      url: `https://www.google.com/search?q=${q}+property+records+square+feet`,
    },
  ];

  const handleClick = (key: 'zillow' | 'realtor' | 'public_records') => {
    onLookup?.(key);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Find your home size</DialogTitle>
          <DialogDescription>
            We'll search using your property address — your quote progress is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lookup-address" className="text-sm font-medium">
              Property address
            </Label>
            <Input
              id="lookup-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, State"
              autoComplete="street-address"
            />
          </div>

          <div className="grid gap-2">
            {links.map((l) => (
              <Button
                key={l.key}
                asChild
                variant="outline"
                disabled={!canSearch}
                className="justify-between"
              >
                <a
                  href={canSearch ? l.url : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => canSearch && handleClick(l.key)}
                >
                  <span className="flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    {l.label}
                  </span>
                  <ExternalLink className="w-4 h-4 opacity-60" />
                </a>
              </Button>
            ))}
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Which number to use</p>
            <p>
              Look for <strong>"living area,"</strong>{' '}
              <strong>"heated square feet,"</strong>{' '}
              <strong>"finished square feet,"</strong> or a similar
              property-detail field.
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>For a two-story home, use the combined finished area of all floors.</li>
              <li>Do not use lot square footage.</li>
              <li>Do not use only the first-floor footprint.</li>
              <li>An approximate number is fine if the listing is slightly outdated.</li>
            </ul>
          </div>

          <Button
            variant="secondary"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            I have my number — return to my quote
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
