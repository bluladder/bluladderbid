import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, MessageSquare, LogOut, Loader2 } from 'lucide-react';
import { CustomerHeader } from '@/components/CustomerHeader';
import { PRIMARY_PUBLIC_PHONE } from '@/config/contact';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Passwordless customer portal — entry (phone) → OTP → portal data.
// All OTP verification, session issuance, and portal reads happen server-side
// through edge functions that validate an httpOnly session cookie. The browser
// never touches customer, quote, or booking tables directly.

type Stage = 'enter_phone' | 'enter_code' | 'signed_in';

interface PortalData {
  customer: { first_name?: string; last_name?: string; address?: string } | null;
  recent_quotes: Array<{ id: string; created_at: string; total: number; status: string; address?: string }>;
  upcoming_appointments: Array<{ id: string; reference_number: string; scheduled_start: string; address?: string; status: string; total: number }>;
  previous_work: Array<{ id: string; reference_number: string; scheduled_start: string; address?: string; total: number }>;
}

export default function MyAppointments() {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>('enter_phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PortalData | null>(null);

  // Attempt to restore an existing session on mount.
  useEffect(() => { void refreshPortalData(true); }, []);

  async function refreshPortalData(silent = false) {
    try {
      const { data: res, error } = await supabase.functions.invoke('customer-portal-data');
      if (error || !res) {
        if (!silent) toast({ title: 'Session expired', description: 'Please verify your phone again.' });
        return;
      }
      setData(res as PortalData);
      setStage('signed_in');
    } catch {
      // no session — stay on enter_phone
    }
  }

  async function requestCode() {
    if (!phone.trim()) return;
    setLoading(true);
    try {
      await supabase.functions.invoke('customer-verification-request', { body: { phone } });
      // Generic — the response never reveals whether we sent anything.
      toast({
        title: 'Check your phone',
        description: 'If that number is reachable, we texted you a 6-digit code from (469) 747-2877.',
      });
      setStage('enter_code');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    if (!/^\d{6}$/.test(code)) return;
    setLoading(true);
    try {
      const { data: res } = await supabase.functions.invoke('customer-verification-confirm', {
        body: { phone, code },
      });
      if (res?.verified && !res?.guest) {
        await refreshPortalData();
      } else if (res?.verified && res?.guest) {
        toast({
          title: 'Verified',
          description: 'We couldn\'t find an account for this number yet. Book a service to get started.',
        });
      } else if (res?.ambiguous) {
        toast({
          title: 'Needs review',
          description: 'Our team was notified. Please text us so we can help.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Invalid or expired code', description: 'Please try again.', variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.functions.invoke('customer-verification-logout');
    setData(null);
    setPhone('');
    setCode('');
    setStage('enter_phone');
  }

  if (stage === 'signed_in' && data) {
    return <PortalView data={data} onSignOut={signOut} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-12 max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Secure sign-in
            </CardTitle>
            <CardDescription>
              Enter your mobile number and we'll text a 6-digit code from
              {' '}{PRIMARY_PUBLIC_PHONE.display}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stage === 'enter_phone' ? (
              <div className="space-y-3">
                <Label htmlFor="portal-phone">Mobile phone</Label>
                <Input
                  id="portal-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(469) 555-0100"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                />
                <Button className="w-full" onClick={requestCode} disabled={loading || !phone.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Text me a code
                </Button>
                <p className="text-xs text-muted-foreground">
                  Message and data rates may apply. This is a one-time verification, not a marketing subscription.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Label htmlFor="portal-code">6-digit code</Label>
                <Input
                  id="portal-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  disabled={loading}
                />
                <Button className="w-full" onClick={confirmCode} disabled={loading || !/^\d{6}$/.test(code)}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Verify
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setStage('enter_phone')} disabled={loading}>
                  Use a different number
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function PortalView({ data, onSignOut }: { data: PortalData; onSignOut: () => void }) {
  const name = [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ') || 'there';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Welcome back, {name}</h1>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            <LogOut className="w-4 h-4 mr-2" />Sign out
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle>Upcoming appointments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.upcoming_appointments.length === 0 && <p className="text-sm text-muted-foreground">No upcoming appointments.</p>}
            {data.upcoming_appointments.map((b) => (
              <div key={b.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">{fmtDate(b.scheduled_start)}</div>
                <div className="text-muted-foreground">{b.address}</div>
                <div className="flex justify-between mt-1"><span>Ref {b.reference_number}</span><span>{fmt(b.total)}</span></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent quotes (last 30 days)</CardTitle>
            <CardDescription>Prices are recalculated when you continue booking.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recent_quotes.length === 0 && <p className="text-sm text-muted-foreground">No recent quotes.</p>}
            {data.recent_quotes.map((q) => (
              <div key={q.id} className="rounded-md border p-3 text-sm">
                <div className="flex justify-between">
                  <span>{new Date(q.created_at).toLocaleDateString()}</span>
                  <span>{fmt(q.total)}</span>
                </div>
                <div className="text-muted-foreground">{q.address ?? ''}</div>
                <div className="text-xs uppercase text-muted-foreground mt-1">{q.status}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Previous work</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.previous_work.length === 0 && <p className="text-sm text-muted-foreground">No completed services yet.</p>}
            {data.previous_work.map((b) => (
              <div key={b.id} className="rounded-md border p-3 text-sm">
                <div>{new Date(b.scheduled_start).toLocaleDateString()}</div>
                <div className="text-muted-foreground">{b.address}</div>
                <div className="flex justify-between mt-1"><span>Ref {b.reference_number}</span><span>{fmt(b.total)}</span></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
