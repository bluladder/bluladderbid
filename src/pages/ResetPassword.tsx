import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { CustomerHeader } from '@/components/CustomerHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Landing page for Supabase password-reset links. Supabase hydrates a
// short-lived "recovery" session from the URL hash; we then call updateUser
// to set the new password. Never logs the token.
export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // If the URL indicates a recovery flow, wait for Supabase to establish
    // the recovery session. Otherwise check if we already have one.
    const hash = window.location.hash || '';
    const isRecovery = hash.includes('type=recovery');
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { setReady(true); return; }
      if (!isRecovery) {
        setLinkError('This reset link is missing or invalid. Please request a new one.');
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && isRecovery)) setReady(true);
    });
    const t = setTimeout(() => {
      if (!ready) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data.session) setLinkError('This reset link is expired or already used. Please request a new one.');
        });
      }
    }, 5000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 10) { setErr('Password must be at least 10 characters.'); return; }
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (classes < 2) { setErr('Use a mix of letters, numbers, or symbols.'); return; }
    if (pw !== confirm) { setErr('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) { setErr('We couldn\'t update your password. The link may be expired.'); return; }
      toast({ title: 'Password updated', description: 'You are now signed in.' });
      navigate('/customer-portal', { replace: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-12 max-w-md mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Set a new password
            </CardTitle>
            <CardDescription>Choose a strong password to secure your account.</CardDescription>
          </CardHeader>
          <CardContent>
            {linkError ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-destructive">{linkError}</p>
                <Button className="w-full min-h-11" onClick={() => navigate('/customer-portal', { replace: true })}>
                  Back to sign-in
                </Button>
              </div>
            ) : !ready ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <form className="space-y-3" onSubmit={submit}>
                <div className="space-y-1">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    disabled={saving}
                    className="min-h-11"
                  />
                  <p className="text-xs text-muted-foreground">At least 10 characters with a mix of letters, numbers, or symbols.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={saving}
                    className="min-h-11"
                  />
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}
                <Button type="submit" className="w-full min-h-11" disabled={saving || !pw || !confirm}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                  Update password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}