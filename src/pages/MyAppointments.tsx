import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, MessageSquare, LogOut, Loader2, CalendarClock, XCircle, Phone, FileText, ExternalLink } from 'lucide-react';
import { CustomerHeader } from '@/components/CustomerHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PRIMARY_PUBLIC_PHONE } from '@/config/contact';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Memory-only portal token.
// The customer frontend (bid.bluladder.com) and Edge Functions (*.supabase.co) live
// on different registrable domains, so an HttpOnly cookie set by an Edge Function
// is a third-party cookie — silently dropped by Safari ITP, Facebook in-app
// browsers, and increasingly Chrome. Rather than ship a config that fails for
// real customers, we hold the raw session token ONLY in JavaScript memory for
// the current tab. Refresh, tab close, or navigation away requires the customer
// to verify again. Nothing is written to sessionStorage, localStorage, IndexedDB,
// cookies, or URLs.
let inMemoryPortalToken: string | null = null;
function readPortalToken(): string | null { return inMemoryPortalToken; }
function writePortalToken(t: string | null) { inMemoryPortalToken = t; }
function portalHeaders(): Record<string, string> {
  const t = readPortalToken();
  return t ? { 'x-portal-session': t } : {};
}

// Passwordless customer portal — entry (phone) → OTP → portal data.
// All OTP verification, session issuance, and portal reads happen server-side
// through edge functions that validate an httpOnly session cookie. The browser
// never touches customer, quote, or booking tables directly.

type Stage = 'enter_phone' | 'enter_code' | 'enter_email' | 'enter_email_code' | 'signed_in';

interface PortalData {
  customer: { first_name?: string; last_name?: string; address?: string } | null;
  recent_quotes: Array<{ id: string; created_at: string; total: number; status: string; address?: string; services_json?: any }>;
  upcoming_appointments: Array<{ id: string; reference_number: string; scheduled_start: string; address?: string; status: string; total: number }>;
  previous_work: Array<{ id: string; reference_number: string; scheduled_start: string; address?: string; total: number }>;
}

export default function MyAppointments() {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>('enter_phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PortalData | null>(null);

  // No persistent session — nothing to restore. In-memory token dies on refresh.
  useEffect(() => { if (inMemoryPortalToken) void refreshPortalData(true); }, []);

  async function refreshPortalData(silent = false) {
    try {
      if (!readPortalToken()) return;
      const { data: res, error } = await supabase.functions.invoke('customer-portal-data', { headers: portalHeaders() });
      if (error || !res) {
        if (!silent) toast({ title: 'Session expired', description: 'Please verify your phone again.' });
        writePortalToken(null);
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
        if (res.session_token) writePortalToken(res.session_token as string);
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

  // ---- Email OTP fallback ------------------------------------------------
  // Same backend challenge/session path as SMS; no password, no marketing
  // consent, no typed email trusted until the one-time code is verified.
  async function requestEmailCode() {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await supabase.functions.invoke('customer-verification-request', { body: { email: email.trim() } });
      toast({
        title: 'Check your email',
        description: 'If that address is reachable, we sent a 6-digit code. It expires shortly.',
      });
      setStage('enter_email_code');
    } catch {
      // Generic — never reveal whether an account exists.
      toast({ title: 'Check your email', description: 'If that address is reachable, we sent a code.' });
      setStage('enter_email_code');
    } finally {
      setLoading(false);
    }
  }

  async function confirmEmailCode() {
    if (!/^\d{6}$/.test(emailCode)) return;
    setLoading(true);
    try {
      const { data: res } = await supabase.functions.invoke('customer-verification-confirm', {
        body: { email: email.trim(), code: emailCode },
      });
      if (res?.verified && !res?.guest) {
        if (res.session_token) writePortalToken(res.session_token as string);
        await refreshPortalData();
      } else if (res?.ambiguous) {
        toast({ title: 'Needs review', description: 'Our team was notified. Please text us so we can help.', variant: 'destructive' });
      } else {
        toast({
          title: 'Invalid portal code',
          description: 'Use the code from “Your BluLadder verification code” — password reset or recovery codes will not work here.',
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await supabase.functions.invoke('customer-verification-logout', { headers: portalHeaders() });
    writePortalToken(null);
    setData(null);
    setPhone('');
    setCode('');
    setEmail('');
    setEmailCode('');
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
            {stage === 'enter_phone' && (
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
                <Button variant="ghost" className="w-full" onClick={() => setStage('enter_email')} disabled={loading}>
                  Verify another way
                </Button>
                <p className="text-xs text-muted-foreground">
                  Message and data rates may apply. This is a one-time verification, not a marketing subscription.
                </p>
                <p className="text-xs text-muted-foreground">
                  For your security, sign-in ends when you close or refresh this tab.
                </p>
              </div>
            )}
            {stage === 'enter_code' && (
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
            {stage === 'enter_email' && (
              <div className="space-y-3">
                <Label htmlFor="portal-email">Email address</Label>
                <Input
                  id="portal-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
                <Button className="w-full" onClick={requestEmailCode} disabled={loading || !email.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Email me a secure code
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setStage('enter_phone')} disabled={loading}>
                  Use phone instead
                </Button>
              </div>
            )}
            {stage === 'enter_email_code' && (
              <div className="space-y-3">
                <Label htmlFor="portal-email-code">6-digit code from your email</Label>
                <p className="text-xs text-muted-foreground">
                  Enter only the code from “Your BluLadder verification code.” Password reset or recovery emails are not used for My Appointments.
                </p>
                <Input
                  id="portal-email-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
                  disabled={loading}
                />
                <Button className="w-full" onClick={confirmEmailCode} disabled={loading || !/^\d{6}$/.test(emailCode)}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Verify
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => setStage('enter_email')} disabled={loading}>
                  Use a different email
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

        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upcoming">
              Upcoming
              {data.upcoming_appointments.length > 0 && (
                <Badge variant="secondary" className="ml-2">{data.upcoming_appointments.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="quotes">
              Bids
              {data.recent_quotes.length > 0 && (
                <Badge variant="secondary" className="ml-2">{data.recent_quotes.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="past">
              Past work
              {data.previous_work.length > 0 && (
                <Badge variant="secondary" className="ml-2">{data.previous_work.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="mt-4">
            <Card>
              <CardHeader><CardTitle>Upcoming appointments</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {data.upcoming_appointments.length === 0 && <p className="text-sm text-muted-foreground">No upcoming appointments.</p>}
                {data.upcoming_appointments.map((b) => (
                  <UpcomingAppointmentRow key={b.id} appt={b} fmt={fmt} fmtDate={fmtDate} />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent bids (last 30 days)</CardTitle>
                <CardDescription>Prices are recalculated when you continue booking.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.recent_quotes.length === 0 && <p className="text-sm text-muted-foreground">No recent bids.</p>}
                {data.recent_quotes.map((q) => (
                  <QuoteRow key={q.id} quote={q} fmt={fmt} />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="past" className="mt-4">
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
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

type UpcomingAppt = PortalData['upcoming_appointments'][number];
type QuoteItem = PortalData['recent_quotes'][number];

interface LineItem { key?: string; label?: string; name?: string; amount?: number; quantity?: number; unit?: string }

function extractLineItems(services_json: any): LineItem[] {
  if (!services_json || typeof services_json !== 'object') return [];
  if (Array.isArray(services_json.lineItems) && services_json.lineItems.length > 0) return services_json.lineItems;
  if (Array.isArray(services_json.services)) {
    return services_json.services.map((s: any) => ({
      key: s.key, label: s.name ?? s.label, amount: Number(s.amount) || 0,
    }));
  }
  return [];
}

function QuoteRow({ quote, fmt }: { quote: QuoteItem; fmt: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const items = extractLineItems(quote.services_json);
  const dateStr = new Date(quote.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="font-medium">{dateStr}</div>
          {quote.address && <div className="text-muted-foreground truncate">{quote.address}</div>}
          <div className="text-xs uppercase tracking-wide text-muted-foreground mt-1">{quote.status}</div>
        </div>
        <div className="text-right font-semibold whitespace-nowrap">{fmt(quote.total)}</div>
      </div>

      {items.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5">
          {items.slice(0, 3).map((li, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="truncate">{li.label ?? li.name ?? li.key}</span>
              {typeof li.amount === 'number' && <span className="tabular-nums">{fmt(li.amount)}</span>}
            </li>
          ))}
          {items.length > 3 && <li className="italic">+{items.length - 3} more…</li>}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" className="flex-1 min-w-[140px]" onClick={() => setOpen(true)}>
          <FileText className="w-4 h-4 mr-2" />View line items
        </Button>
        <Button asChild size="sm" className="flex-1 min-w-[140px]">
          <a href={`/quote/${quote.id}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" />Open full quote
          </a>
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bid from {dateStr}</DialogTitle>
            <DialogDescription>
              Prices are recalculated when you continue booking to reflect current rates.
            </DialogDescription>
          </DialogHeader>

          {quote.address && (
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{quote.address}</div>
          )}

          <div className="border rounded-md divide-y">
            {items.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No itemized breakdown available for this bid.</div>
            )}
            {items.map((li, i) => (
              <div key={i} className="p-3 text-sm flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{li.label ?? li.name ?? li.key}</div>
                  {li.quantity != null && li.unit && (
                    <div className="text-xs text-muted-foreground">{li.quantity.toLocaleString()} {li.unit}</div>
                  )}
                </div>
                {typeof li.amount === 'number' && (
                  <div className="tabular-nums font-medium">{fmt(li.amount)}</div>
                )}
              </div>
            ))}
            <div className="p-3 flex justify-between items-center bg-muted/40">
              <span className="font-semibold">Total</span>
              <span className="font-semibold text-lg tabular-nums">{fmt(quote.total)}</span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={`/quote/${quote.id}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />Open full quote
              </a>
            </Button>
            <Button asChild className="w-full sm:w-auto">
              <a href={`/quote/${quote.id}/book`}>
                <CalendarClock className="w-4 h-4 mr-2" />Continue to booking
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UpcomingAppointmentRow({
  appt,
  fmt,
  fmtDate,
}: {
  appt: UpcomingAppt;
  fmt: (n: number) => string;
  fmtDate: (iso: string) => string;
}) {
  const [action, setAction] = useState<null | 'reschedule' | 'cancel'>(null);
  const hoursUntil = (new Date(appt.scheduled_start).getTime() - Date.now()) / 3_600_000;
  const withinLockout = hoursUntil < 48;
  const phoneDigits = PRIMARY_PUBLIC_PHONE.e164.replace(/[^\d+]/g, '');
  const smsBody = (kind: 'reschedule' | 'cancel') =>
    encodeURIComponent(
      kind === 'reschedule'
        ? `Hi BluLadder — I'd like to reschedule appointment ${appt.reference_number} (${fmtDate(appt.scheduled_start)}).`
        : `Hi BluLadder — I need to cancel appointment ${appt.reference_number} (${fmtDate(appt.scheduled_start)}).`,
    );

  return (
    <div className="rounded-md border p-3 text-sm space-y-3">
      <div>
        <div className="font-medium">{fmtDate(appt.scheduled_start)}</div>
        <div className="text-muted-foreground">{appt.address}</div>
        <div className="flex justify-between mt-1">
          <span>Ref {appt.reference_number}</span>
          <span>{fmt(appt.total)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 min-w-[140px]"
          onClick={() => setAction('reschedule')}
        >
          <CalendarClock className="w-4 h-4 mr-2" />
          Reschedule
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 min-w-[140px] text-destructive hover:text-destructive"
          onClick={() => setAction('cancel')}
        >
          <XCircle className="w-4 h-4 mr-2" />
          Cancel
        </Button>
      </div>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === 'reschedule' ? 'Reschedule this appointment' : 'Cancel this appointment'}
            </DialogTitle>
            <DialogDescription>
              {withinLockout ? (
                <>
                  Your appointment is within 48 hours, so changes need to go through our team.
                  Text or call us and we'll take care of it right away.
                </>
              ) : (
                <>
                  To keep your crew assignment and route correct, {action === 'reschedule' ? 'reschedules' : 'cancellations'} from
                  the portal go through our team. Text or call and we'll confirm within business hours.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <div className="font-medium">Ref {appt.reference_number}</div>
            <div className="text-muted-foreground">{fmtDate(appt.scheduled_start)}</div>
            {appt.address && <div className="text-muted-foreground">{appt.address}</div>}
          </div>

          <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href={`tel:${phoneDigits}`}>
                <Phone className="w-4 h-4 mr-2" />
                Call {PRIMARY_PUBLIC_PHONE.display}
              </a>
            </Button>
            <Button asChild className="w-full sm:w-auto">
              <a href={`sms:${phoneDigits}?&body=${smsBody(action ?? 'reschedule')}`}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Text us
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
