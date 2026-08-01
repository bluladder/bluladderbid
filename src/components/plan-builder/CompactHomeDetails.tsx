import { Home } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ServicePlanHomeDetails } from '@/types/servicePlanBuilder';

interface CompactHomeDetailsProps {
  homeDetails: ServicePlanHomeDetails;
  onChange: (updates: Partial<ServicePlanHomeDetails>) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function CompactHomeDetails({ 
  homeDetails, 
  onChange,
  isExpanded = false,
  onToggleExpand,
}: CompactHomeDetailsProps) {
  const hasBasicDetails = homeDetails.squareFootage > 0;

  // If we have details and not expanded, show compact summary
  if (hasBasicDetails && !isExpanded) {
    return (
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Home className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {homeDetails.squareFootage.toLocaleString()} sq ft • {homeDetails.stories} {homeDetails.stories === 1 ? 'story' : 'stories'}
                </p>
                <p className="text-xs text-muted-foreground">Property details used for authoritative plan pricing</p>
              </div>
            </div>
            {onToggleExpand && (
              <Button variant="ghost" size="sm" onClick={onToggleExpand}>
                Edit
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Full form for entering/editing details
  return (
    <Card>
      <CardContent className="p-4 md:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Home className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Tell Us About Your Home</h3>
            <p className="text-xs text-muted-foreground">
              We'll calculate accurate pricing based on your home's size
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Square Footage - Most Important */}
          <div className="space-y-2">
            <Label htmlFor="sqft" className="text-sm font-medium">
              Home Square Footage <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sqft"
              type="number"
              value={homeDetails.squareFootage === 0 ? '' : homeDetails.squareFootage}
              onChange={(e) => {
                const value = e.target.value;
                onChange({ squareFootage: value === '' ? 0 : parseInt(value, 10) || 0 });
              }}
              onFocus={(e) => {
                if (homeDetails.squareFootage > 0) {
                  e.target.select();
                }
              }}
              placeholder="Enter your home's sq ft (e.g. 2,500)"
              className="text-lg h-12"
              autoFocus={!hasBasicDetails}
              inputMode="numeric"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Find this on your property tax statement or home listing
            </p>
          </div>

          {/* Stories */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Number of Stories</Label>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => onChange({ stories: n as 1 | 2 | 3 })}
                  className={`
                    flex-1 py-3 rounded-lg text-sm font-medium transition-colors border-2
                    ${homeDetails.stories === n 
                      ? 'bg-primary text-primary-foreground border-primary' 
                      : 'bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/30'
                    }
                  `}
                >
                  {n} {n === 1 ? 'Story' : 'Stories'}
                </button>
              ))}
            </div>
          </div>

          {/* Done Editing Button */}
          {hasBasicDetails && onToggleExpand && (
            <Button 
              variant="outline" 
              onClick={onToggleExpand}
              className="w-full"
            >
              Done Editing
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
