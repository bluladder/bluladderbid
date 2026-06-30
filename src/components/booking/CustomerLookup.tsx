import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search, Mail, User, Loader2, ArrowRight } from 'lucide-react';
import { useCustomerLookup, type CustomerLookupResult } from '@/hooks/useCustomerLookup';
import { z } from 'zod';

const emailSchema = z.string().email('Please enter a valid email address');

interface CustomerLookupProps {
  onCustomerFound: (result: CustomerLookupResult) => void;
  onNewCustomer: () => void;
}

export function CustomerLookup({ onCustomerFound, onNewCustomer }: CustomerLookupProps) {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const { lookupByEmail, isLoading, error } = useCustomerLookup();

  const handleLookup = async () => {
    // Validate email
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setEmailError(result.error.errors[0].message);
      return;
    }
    setEmailError('');

    const lookupResult = await lookupByEmail(email);
    if (lookupResult) {
      onCustomerFound(lookupResult);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLookup();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="w-5 h-5" />
          Welcome Back?
        </CardTitle>
        <CardDescription>
          Enter your email to find your past bookings and rebook with saved preferences
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="lookup-email">Email Address</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="lookup-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError('');
                }}
                onKeyPress={handleKeyPress}
                placeholder="Enter your email..."
                className={`pl-10 ${emailError ? 'border-destructive' : ''}`}
                disabled={isLoading}
              />
            </div>
            <Button 
              onClick={handleLookup} 
              disabled={isLoading || !email.trim()}
              className="shrink-0"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span className="ml-2">Look Up</span>
            </Button>
          </div>
          {emailError && (
            <p className="text-xs text-destructive">{emailError}</p>
          )}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Button 
          variant="outline" 
          className="w-full"
          onClick={onNewCustomer}
        >
          Continue as New Customer
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
