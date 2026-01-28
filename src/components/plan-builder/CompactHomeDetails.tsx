import { Home, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
                <p className="text-xs text-muted-foreground">
                  {homeDetails.condition === 'maintenance' ? 'Regular maintenance' : 'Heavy cleaning needed'}
                </p>
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
                onChange({ squareFootage: value === '' ? 0 : parseInt(value, 10) });
              }}
              placeholder="e.g. 2,500"
              className="text-lg h-12"
              autoFocus={!hasBasicDetails}
            />
            <p className="text-xs text-muted-foreground">
              You can find this on your property tax statement or home listing
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

          {/* Condition */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Current Condition</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onChange({ condition: 'maintenance' })}
                className={`
                  p-3 rounded-lg text-left transition-colors border-2
                  ${homeDetails.condition === 'maintenance'
                    ? 'bg-primary/10 border-primary'
                    : 'bg-muted/50 border-transparent hover:border-muted-foreground/30'
                  }
                `}
              >
                <p className={`font-medium text-sm ${homeDetails.condition === 'maintenance' ? 'text-primary' : 'text-foreground'}`}>
                  Regular Maintenance
                </p>
                <p className="text-xs text-muted-foreground">
                  Cleaned within the past year
                </p>
              </button>
              <button
                onClick={() => onChange({ condition: 'heavy' })}
                className={`
                  p-3 rounded-lg text-left transition-colors border-2
                  ${homeDetails.condition === 'heavy'
                    ? 'bg-primary/10 border-primary'
                    : 'bg-muted/50 border-transparent hover:border-muted-foreground/30'
                  }
                `}
              >
                <p className={`font-medium text-sm ${homeDetails.condition === 'heavy' ? 'text-primary' : 'text-foreground'}`}>
                  Heavy Cleaning
                </p>
                <p className="text-xs text-muted-foreground">
                  Not cleaned in 2+ years
                </p>
              </button>
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
