import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MessageSquare, Mail, Loader2, BellRing } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  email: string;
  /** Render without the outer Card wrapper (e.g. when embedded in a page that already has one). */
  bare?: boolean;
}

interface PrefStatus {
  hasPhone: boolean;
  hasEmail: boolean;
  phoneLast4?: string;
  emailMasked?: string;
  sms: { optedOut: boolean };
  email: { paused: boolean };
}

type Channel = 'sms' | 'email';

export function MessagePreferencesCard({ email, bare = false }: Props) {
  const [status, setStatus] = useState<PrefStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Channel | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-sms-optout', {
        body: { email: email.toLowerCase().trim(), action: 'status' },
      });
      if (error) throw error;
      setStatus(data as PrefStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleToggle = async (channel: Channel, wantsMessages: boolean) => {
    setSaving(channel);
    try {
      const { data, error } = await supabase.functions.invoke('manage-sms-optout', {
        body: {
          email: email.toLowerCase().trim(),
          channel,
          action: wantsMessages ? 'opt_in' : 'opt_out',
        },
      });
      if (error) throw error;
      setStatus(data as PrefStatus);
      const label = channel === 'sms' ? 'Text' : 'Email';
      toast.success(
        wantsMessages ? `${label} notifications turned on` : `You'll no longer receive ${label.toLowerCase()}s`,
      );
    } catch {
      toast.error('Could not update your preference');
    } finally {
      setSaving(null);
    }
  };

  const body = (
    <>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking your preferences…
        </div>
      ) : !status || (!status.hasPhone && !status.hasEmail) ? (
        <p className="text-sm text-muted-foreground py-2">
          We couldn't find contact details on file for this email.
        </p>
      ) : (
        <div className="space-y-5">
          {status.hasPhone && (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="pref-sms" className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> Text messages
                </Label>
                <p className="text-xs text-muted-foreground">
                  {status.phoneLast4
                    ? `Appointment & quote texts to the number ending in ${status.phoneLast4}.`
                    : 'Appointment & quote texts.'}{' '}
                  You can also reply STOP to any text.
                </p>
              </div>
              <Switch
                id="pref-sms"
                checked={!status.sms.optedOut}
                onCheckedChange={(c) => handleToggle('sms', c)}
                disabled={saving === 'sms'}
              />
            </div>
          )}

          {status.hasEmail && (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="pref-email" className="text-sm font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4" /> Emails
                </Label>
                <p className="text-xs text-muted-foreground">
                  {status.emailMasked
                    ? `Appointment & quote emails to ${status.emailMasked}.`
                    : 'Appointment & quote emails.'}
                </p>
              </div>
              <Switch
                id="pref-email"
                checked={!status.email.paused}
                onCheckedChange={(c) => handleToggle('email', c)}
                disabled={saving === 'email'}
              />
            </div>
          )}
        </div>
      )}
    </>
  );

  if (bare) return body;

  // Don't render the standalone card if there's nothing to manage.
  if (!loading && (!status || (!status.hasPhone && !status.hasEmail))) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BellRing className="w-4 h-4" /> Notification Preferences
        </CardTitle>
        <CardDescription>Choose how you'd like to hear from BluLadder.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
