import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, MessageSquare, Sparkles, CalendarPlus, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CustomerHeader } from '@/components/CustomerHeader';
import { PRIMARY_PUBLIC_PHONE, telHref } from '@/config/contact';

// STAGE A SECURITY LOCKDOWN
// -------------------------
// The former email-based "My Appointments" page allowed anyone who typed a
// customer's email address to view that customer's upcoming appointments and
// saved quotes. Because it required no verification, it has been retired
// until the passwordless customer portal (Twilio Verify SMS OTP + email OTP
// / Magic Link fallback) is live.
//
// This placeholder MUST NOT reveal customer existence, booking counts, quote
// counts, masked addresses or masked phone numbers.
export default function MyAppointments() {
  const smsHref = `sms:${PRIMARY_PUBLIC_PHONE.e164}`;
  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-12 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Secure Appointment Access is Being Upgraded
            </CardTitle>
            <CardDescription>
              You can still receive a new quote or book a new service.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We are moving to a secure passwordless sign-in so only you can
              view your appointments and saved quotes. Until it launches, the
              email-based lookup is disabled.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild size="lg">
                <Link to="/">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Get a New Quote
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/">
                  <CalendarPlus className="w-4 h-4 mr-2" />
                  Book a New Service
                </Link>
              </Button>
            </div>
            <div className="rounded-md border p-3 text-sm flex items-center gap-3">
              <MessageSquare className="w-4 h-4 text-primary" />
              <div className="flex-1">
                Need to reach us right now?
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={smsHref}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Text {PRIMARY_PUBLIC_PHONE.display}
                  </a>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={telHref(PRIMARY_PUBLIC_PHONE.e164)}>
                    <Phone className="w-4 h-4 mr-2" />
                    Call
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
