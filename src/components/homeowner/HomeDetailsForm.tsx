import { Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { HomeDetails } from '@/types/homeowner';

interface HomeDetailsFormProps {
  homeDetails: HomeDetails;
  onChange: (updates: Partial<HomeDetails>) => void;
}

export function HomeDetailsForm({ homeDetails, onChange }: HomeDetailsFormProps) {
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
              Home Square Footage
            </Label>
            <Input
              id="sqft"
              type="number"
              value={homeDetails.squareFootage === 0 ? '' : homeDetails.squareFootage}
              onChange={(e) => {
                const value = e.target.value;
                onChange({ squareFootage: value === '' ? 0 : parseInt(value, 10) });
              }}
              className="input-field"
              placeholder="e.g. 3200 (typical: 2,000-5,000 sqft)"
            />
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
      </CardContent>
    </Card>
  );
}
