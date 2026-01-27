import { User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { ServicePlanCustomer } from '@/types/servicePlanBuilder';

interface PlanCustomerFormProps {
  customer: ServicePlanCustomer;
  onChange: (updates: Partial<ServicePlanCustomer>) => void;
}

export function PlanCustomerForm({ customer, onChange }: PlanCustomerFormProps) {
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-4">
        <div className="section-header">
          <div className="section-icon">
            <User className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">Your Information</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              We'll use this to create your service plan
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName" className="text-sm font-medium">
              First Name *
            </Label>
            <Input
              id="firstName"
              value={customer.firstName}
              onChange={(e) => onChange({ firstName: e.target.value })}
              placeholder="John"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="lastName" className="text-sm font-medium">
              Last Name *
            </Label>
            <Input
              id="lastName"
              value={customer.lastName}
              onChange={(e) => onChange({ lastName: e.target.value })}
              placeholder="Smith"
            />
          </div>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              Email *
            </Label>
            <Input
              id="email"
              type="email"
              value={customer.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="john@example.com"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-sm font-medium">
              Phone *
            </Label>
            <Input
              id="phone"
              type="tel"
              value={customer.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="address" className="text-sm font-medium">
            Service Address *
          </Label>
          <Input
            id="address"
            value={customer.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="123 Main Street"
          />
        </div>
        
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="city" className="text-sm font-medium">
              City
            </Label>
            <Input
              id="city"
              value={customer.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Phoenix"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="state" className="text-sm font-medium">
              State
            </Label>
            <Input
              id="state"
              value={customer.state}
              onChange={(e) => onChange({ state: e.target.value })}
              placeholder="AZ"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="zip" className="text-sm font-medium">
              ZIP Code
            </Label>
            <Input
              id="zip"
              value={customer.zip}
              onChange={(e) => onChange({ zip: e.target.value })}
              placeholder="85001"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
