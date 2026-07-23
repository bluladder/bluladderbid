import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, MessageSquare, LogOut, Loader2, CalendarClock, XCircle, Phone, FileText, ExternalLink, Mail, Lock } from 'lucide-react';
import { CustomerHeader } from '@/components/CustomerHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PRIMARY_PUBLIC_PHONE } from '@/config/contact';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable';
import { useToast } from '@/hooks/use-toast';

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

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

// Primary auth path: Google + email magic link (Supabase Auth). Phone/email OTP
// remains available as a "trouble signing in?" fallback but is not shown by default.
type Stage =
  | 'choose'
  | 'password_signin'
  | 'password_signup'
  | 'forgot_password'
  | 'forgot_sent'
  | 'magic_link_email'
  | 'magic_link_sent'
  | 'legacy_phone'
  | 'legacy_phone_code'
  | 'legacy_email'
  | 'legacy_email_code'
  | 'signed_in';

interface PortalData {
  customer: { first_name?: string; last_name?: string; address?: string } | null;
  recent_quotes: Array<{ id: string; created_at: string; total: number; status: string; address?: string; services_json?: any; line_item_snapshot?: any }>;
  upcoming_appointments: Array<{ id: string; reference_number: string; scheduled_start: string; address?: string; status: string; total: number }>;
  previous_work: Array<{ id: string; reference_number: string; scheduled_start: string; address?: string; total: number }>;
}

export default function MyAppointments() {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>('choose');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PortalData | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Password form state (sign-in, sign-up, forgot)
  const [pwEmail, setPwEmail] = useState('');
  const [pwPassword, setPwPassword] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  // Watch Supabase Auth session — if a real auth user is signed in, prefer that
  // path over the legacy portal-token flow.
  useEffect(() => {
    let cancelled = false;
    const hydrateAuthed = async () => {
      // Ensure the auth user is bound to a customer_accounts row. Password
      // sign-in does NOT route through /auth/callback (only OAuth / magic
      // links do), so without this call first-time password users would sit
      // on the login screen forever while portal-data-authed returned
      // not_linked. Safe to call repeatedly — the function is idempotent.
      const { data: linkData, error: linkError } = await supabase.functions.invoke('customer-auth-link');
      if (cancelled) return;
      if (linkError || linkData?.error) {
        console.error('[portal] auth-link failed', { linkError, linkData });
        toast({
          title: "We couldn't connect your account yet",
          description: 'Your sign-in worked, but we could not finish linking it to your customer records. Please contact support if this keeps happening.',
          variant: 'destructive',
        });
        return;
      }
      if (linkData?.contact_support || linkData?.status === 'ambiguous') {
        toast({
          title: 'Customer match needs review',
          description: 'Your sign-in worked, but we found more than one possible customer match. Please contact support and we will connect it for you.',
          variant: 'destructive',
        });
        return;
      }
      const { data: authedData, error } = await supabase.functions.invoke('customer-portal-data-authed');
      if (cancelled) return;
      if (error || !authedData) {
        console.error('[portal] portal-data-authed failed', { error, authedData });
        toast({
          title: "We couldn't load your account",
          description: "You're signed in, but we hit a snag pulling your quotes and appointments. Please refresh, or contact support if this keeps happening.",
          variant: 'destructive',
        });
        return;
      }
      console.debug('[portal] loaded', {
        upcoming: authedData?.upcoming_appointments?.length ?? 0,
        quotes: authedData?.recent_quotes?.length ?? 0,
        past: authedData?.previous_work?.length ?? 0,
      });
      setData(authedData as PortalData);
      setStage('signed_in');
    };
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        setAuthedEmail(session.user.email ?? null);
        void hydrateAuthed();
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session?.user) {
        setAuthedEmail(session.user.email ?? null);
        void hydrateAuthed();
      } else {
        setAuthedEmail(null);
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [reloadTick]);

  // No persistent session — nothing to restore. In-memory token dies on refresh.
  useEffect(() => { if (inMemoryPortalToken) void refreshPortalData(true); }, []);

  // --- Supabase Auth primary path ---------------------------------------
  async function continueWithGoogle() {
    setLoading(true);
    try {
      sessionStorage.setItem('bl_auth_next', '/customer-portal');
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: `${window.location.origin}/auth/callback`,
      });
      if (result.error) {
        toast({
          title: 'Sign-in cancelled',
          description: 'Google sign-in didn\'t complete. Please try again.',
          variant: 'destructive',
        });
      }
      // If redirected, the browser navigates away; nothing more to do here.
    } catch {
      toast({ title: 'Sign-in error', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function sendMagicLink() {
    const addr = magicEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return;
    setLoading(true);
    try {
      sessionStorage.setItem('bl_auth_next', '/customer-portal');
      const { error } = await supabase.auth.signInWithOtp({
        email: addr,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: true,
        },
      });
      if (error) {
        // Never reveal whether an account exists.
        toast({ title: 'Check your email', description: 'If that address is reachable, we sent you a sign-in link.' });
      }
      setStage('magic_link_sent');
    } finally {
      setLoading(false);
    }
  }

  // --- Password sign-in / sign-up / reset -------------------------------
  function isReasonablePassword(pw: string): { ok: true } | { ok: false; msg: string } {
    if (pw.length < 10) return { ok: false, msg: 'Password must be at least 10 characters.' };
    // require at least two of: lower, upper, digit, symbol
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (classes < 2) return { ok: false, msg: 'Use a mix of letters, numbers, or symbols.' };
    return { ok: true };
  }

  async function passwordSignIn() {
    setPwError(null);
    const addr = pwEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || !pwPassword) return;
    setLoading(true);
    try {
      sessionStorage.setItem('bl_auth_next', '/customer-portal');
      const { error } = await supabase.auth.signInWithPassword({ email: addr, password: pwPassword });
      if (error) {
        // Neutral message — do not disclose whether the account exists. Steer
        // customers to the reset flow, which also works for accounts that were
        // originally created with Google or a magic link and have no password yet.
        const msg = /confirm/i.test(error.message)
          ? 'Please confirm your email first — check your inbox for the confirmation link, then try signing in again.'
          : "That email and password didn't match. If you signed up with Google or a magic link, use \"Forgot password?\" to set one.";
        setPwError(msg);
      }
      // On success, onAuthStateChange fires and hydrates the portal.
    } finally {
      setLoading(false);
    }
  }

  async function passwordSignUp() {
    setPwError(null);
    const addr = pwEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setPwError('Please enter a valid email address.');
      return;
    }
    const strength = isReasonablePassword(pwPassword);
    if (strength.ok === false) { setPwError(strength.msg); return; }
    if (pwPassword !== pwConfirm) { setPwError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      sessionStorage.setItem('bl_auth_next', '/customer-portal');
      const { data: res, error } = await supabase.auth.signUp({
        email: addr,
        password: pwPassword,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        // HIBP or other server-side rejection — surface the message inline so the
        // customer can react (pick a stronger password, etc.) instead of silently
        // dropping them on a "check your email" screen.
        setPwError(error.message || 'We couldn\'t create that account. Please try again.');
        return;
      }
      // Supabase enumeration-protection tell: on a repeated signup the returned
      // user has an empty identities[] array and NO confirmation email is sent.
      // If we don't handle this, the customer sits waiting for an email that
      // will never arrive. Transparently kick off a password reset instead so
      // they get a real, actionable email that lets them set a new password.
      const identities = (res.user as { identities?: unknown[] } | null)?.identities;
      const alreadyRegistered = !!res.user && Array.isArray(identities) && identities.length === 0;
      if (alreadyRegistered) {
        await supabase.auth.resetPasswordForEmail(addr, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setStage('forgot_sent');
        return;
      }
      // If email confirmation is required, session will be null here.
      if (!res.session) {
        toast({
          title: 'Confirm your email',
          description: 'We sent a confirmation link. Click it to finish creating your account.',
        });
        setStage('magic_link_sent');
      }
      // If session present, onAuthStateChange takes over.
    } finally {
      setLoading(false);
    }
  }

  async function requestPasswordReset() {
    setPwError(null);
    const addr = pwEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setPwError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Always show the same neutral confirmation.
      setStage('forgot_sent');
    } finally {
      setLoading(false);
    }
  }

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
      setStage('legacy_phone_code');
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
      setStage('legacy_email_code');
    } catch {
      // Generic — never reveal whether an account exists.
      toast({ title: 'Check your email', description: 'If that address is reachable, we sent a code.' });
      setStage('legacy_email_code');
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
    // Sign out of both the legacy portal session and the Supabase Auth session.
    try { await supabase.functions.invoke('customer-verification-logout', { headers: portalHeaders() }); } catch { /* noop */ }
    try { await supabase.auth.signOut(); } catch { /* noop */ }
    writePortalToken(null);
    setData(null);
    setPhone('');
    setCode('');
    setEmail('');
    setEmailCode('');
    setMagicEmail('');
    setAuthedEmail(null);
    setStage('choose');
  }

  if (stage === 'signed_in' && data) {
    return <PortalView data={data} onSignOut={signOut} authedEmail={authedEmail} onRefresh={() => { setData(null); setReloadTick((t) => t + 1); }} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-12 max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Sign in to your account
            </CardTitle>
            <CardDescription>
              View your bids, upcoming appointments, and past work.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stage === 'choose' && (
              <div className="space-y-3">
                <Button
                  className="w-full min-h-11"
                  onClick={continueWithGoogle}
                  disabled={loading}
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <GoogleGlyph className="w-4 h-4 mr-2" />}
                  Continue with Google
                </Button>
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center"><span className="bg-background px-2 text-xs text-muted-foreground">or</span></div>
                </div>
                <Button
                  variant="outline"
                  className="w-full min-h-11"
                  onClick={() => { setPwError(null); setStage('password_signin'); }}
                  disabled={loading}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Sign in with Email
                </Button>
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setStage('magic_link_email')}
                    disabled={loading}
                  >
                    Trouble signing in?
                  </button>
                </div>
                <p className="text-xs text-muted-foreground pt-2">
                  By continuing you agree to our terms and privacy notice. We won't post anything to your Google account.
                </p>
              </div>
            )}

            {stage === 'password_signin' && (
              <form
                className="space-y-3"
                onSubmit={(e) => { e.preventDefault(); void passwordSignIn(); }}
              >
                <div className="space-y-1">
                  <Label htmlFor="pw-email">Email address</Label>
                  <Input
                    id="pw-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={pwEmail}
                    onChange={(e) => setPwEmail(e.target.value)}
                    disabled={loading}
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pw-password">Password</Label>
                  <Input
                    id="pw-password"
                    type="password"
                    autoComplete="current-password"
                    value={pwPassword}
                    onChange={(e) => setPwPassword(e.target.value)}
                    disabled={loading}
                    className="min-h-11"
                  />
                </div>
                {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                <Button type="submit" className="w-full min-h-11" disabled={loading || !pwEmail.trim() || !pwPassword}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                  Sign In
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="underline underline-offset-2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setPwError(null); setStage('forgot_password'); }}
                    disabled={loading}
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setPwError(null); setPwPassword(''); setPwConfirm(''); setStage('password_signup'); }}
                    disabled={loading}
                  >
                    Create account
                  </button>
                </div>
                <Button type="button" variant="ghost" className="w-full min-h-11" onClick={() => setStage('choose')} disabled={loading}>
                  Back
                </Button>
              </form>
            )}

            {stage === 'password_signup' && (
              <form
                className="space-y-3"
                onSubmit={(e) => { e.preventDefault(); void passwordSignUp(); }}
              >
                <div className="space-y-1">
                  <Label htmlFor="su-email">Email address</Label>
                  <Input
                    id="su-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={pwEmail}
                    onChange={(e) => setPwEmail(e.target.value)}
                    disabled={loading}
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="su-password">Password</Label>
                  <Input
                    id="su-password"
                    type="password"
                    autoComplete="new-password"
                    value={pwPassword}
                    onChange={(e) => setPwPassword(e.target.value)}
                    disabled={loading}
                    className="min-h-11"
                  />
                  <p className="text-xs text-muted-foreground">At least 10 characters with a mix of letters, numbers, or symbols.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="su-confirm">Confirm password</Label>
                  <Input
                    id="su-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    disabled={loading}
                    className="min-h-11"
                  />
                </div>
                {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                <Button type="submit" className="w-full min-h-11" disabled={loading || !pwEmail.trim() || !pwPassword || !pwConfirm}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                  Create account
                </Button>
                <Button type="button" variant="ghost" className="w-full min-h-11" onClick={() => { setPwError(null); setStage('password_signin'); }} disabled={loading}>
                  I already have an account
                </Button>
              </form>
            )}

            {stage === 'forgot_password' && (
              <form
                className="space-y-3"
                onSubmit={(e) => { e.preventDefault(); void requestPasswordReset(); }}
              >
                <p className="text-sm text-muted-foreground">
                  Enter your account email and we'll send you a secure reset link.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="fp-email">Email address</Label>
                  <Input
                    id="fp-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={pwEmail}
                    onChange={(e) => setPwEmail(e.target.value)}
                    disabled={loading}
                    className="min-h-11"
                  />
                </div>
                {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                <Button type="submit" className="w-full min-h-11" disabled={loading || !pwEmail.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                  Send reset link
                </Button>
                <Button type="button" variant="ghost" className="w-full min-h-11" onClick={() => setStage('password_signin')} disabled={loading}>
                  Back
                </Button>
              </form>
            )}

            {stage === 'forgot_sent' && (
              <div className="space-y-3 text-center">
                <Mail className="w-8 h-8 text-primary mx-auto" />
                <h3 className="font-medium">Check your email</h3>
                <p className="text-sm text-muted-foreground">
                  If an account exists for that email, we sent reset instructions. The link expires shortly.
                </p>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('choose')}>
                  Back to sign-in
                </Button>
              </div>
            )}

            {stage === 'magic_link_email' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  We'll email you a one-time sign-in link — useful if you don't have a password yet.
                </p>
                <Label htmlFor="magic-email">Email address</Label>
                <Input
                  id="magic-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  disabled={loading}
                  className="min-h-11"
                />
                <Button
                  className="w-full min-h-11"
                  onClick={sendMagicLink}
                  disabled={loading || !magicEmail.trim()}
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                  Send me a sign-in link
                </Button>
                <Button
                  variant="ghost"
                  className="w-full min-h-11"
                  onClick={() => setStage('legacy_phone')}
                  disabled={loading}
                >
                  Use a phone code instead
                </Button>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('choose')} disabled={loading}>
                  Back
                </Button>
              </div>
            )}

            {stage === 'magic_link_sent' && (
              <div className="space-y-3 text-center">
                <Mail className="w-8 h-8 text-primary mx-auto" />
                <h3 className="font-medium">Check your email</h3>
                <p className="text-sm text-muted-foreground">
                  If <span className="font-medium text-foreground">{magicEmail}</span> is reachable, we sent a secure sign-in link. Open it on this device to continue.
                </p>
                <p className="text-xs text-muted-foreground">
                  The link expires shortly. You can close this tab and click the link from your email.
                </p>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('choose')}>
                  Use a different method
                </Button>
              </div>
            )}

            {stage === 'legacy_phone' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  We'll text a 6-digit code from {PRIMARY_PUBLIC_PHONE.display}.
                </p>
                <Label htmlFor="portal-phone">Mobile phone</Label>
                <Input
                  id="portal-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(469) 555-0100"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                  className="min-h-11"
                />
                <Button className="w-full min-h-11" onClick={requestCode} disabled={loading || !phone.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Text me a code
                </Button>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('legacy_email')} disabled={loading}>
                  Use email OTP instead
                </Button>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('choose')} disabled={loading}>
                  Back to sign-in options
                </Button>
              </div>
            )}
            {stage === 'legacy_phone_code' && (
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
                  className="min-h-11"
                />
                <Button className="w-full min-h-11" onClick={confirmCode} disabled={loading || !/^\d{6}$/.test(code)}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Verify
                </Button>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('legacy_phone')} disabled={loading}>
                  Use a different number
                </Button>
              </div>
            )}
            {stage === 'legacy_email' && (
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
                  className="min-h-11"
                />
                <Button className="w-full min-h-11" onClick={requestEmailCode} disabled={loading || !email.trim()}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Email me a secure code
                </Button>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('legacy_phone')} disabled={loading}>
                  Use phone instead
                </Button>
              </div>
            )}
            {stage === 'legacy_email_code' && (
              <div className="space-y-3">
                <Label htmlFor="portal-email-code">6-digit code from your email</Label>
                <p className="text-xs text-muted-foreground">
                  Enter only the code from “Your BluLadder verification code.” Password reset or recovery emails are not used for Customer Portal access.
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
                  className="min-h-11"
                />
                <Button className="w-full min-h-11" onClick={confirmEmailCode} disabled={loading || !/^\d{6}$/.test(emailCode)}>
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  Verify
                </Button>
                <Button variant="ghost" className="w-full min-h-11" onClick={() => setStage('legacy_email')} disabled={loading}>
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

function PortalView({ data, onSignOut, authedEmail, onRefresh }: { data: PortalData; onSignOut: () => void; authedEmail?: string | null; onRefresh?: () => void }) {
  const name = [data.customer?.first_name, data.customer?.last_name].filter(Boolean).join(' ') || 'there';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Customer Portal</p>
            <h1 className="text-2xl font-semibold">Welcome back, {name}</h1>
            {authedEmail && <p className="text-xs text-muted-foreground">Signed in as {authedEmail}</p>}
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="min-h-11">
            <LogOut className="w-4 h-4 mr-2" />Sign out
          </Button>
        </div>

        {onRefresh && (
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="ghost" onClick={onRefresh}>
              <Loader2 className="w-4 h-4 mr-2" />Refresh
            </Button>
          </div>
        )}

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

function extractLineItems(services_json: any, line_item_snapshot?: any): LineItem[] {
  if (Array.isArray(line_item_snapshot) && line_item_snapshot.length > 0) {
    return line_item_snapshot.map((li: any) => ({
      key: li.key,
      label: li.label ?? li.name,
      name: li.name,
      amount: Number(li.amount) || 0,
      quantity: li.quantity,
      unit: li.unit,
    }));
  }
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
  const items = extractLineItems(quote.services_json, quote.line_item_snapshot);
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
