import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  email: string;
}

interface OptStatus {
  hasPhone: boolean;
  optedOut: boolean;
  phoneLast4?: string;
}

export function SmsPreferenceCard({ email }: Props) {
  const [status, setStatus] = useState<OptStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-sms-optout', {
        body: { email: email.toLowerCase().trim(), action: 'status' },
      });
      if (error) throw error;
      setStatus(data as OptStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleToggle = async (checked: boolean) => {
    // checked = wants to RECEIVE texts (i.e. NOT opted out)
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-sms-optout', {
        body: { email: email.toLowerCase().trim(), action: checked ? 'opt_in' : 'opt_out' },
      });
      if (error) throw error;
      setStatus((prev) => ({ ...(prev ?? { hasPhone: true }), ...(data as OptStatus) }));
      toast.success(checked ? 'Text notifications turned on' : 'You will no longer receive texts');
    } catch {
      toast.error('Could not update your preference');
    } finally {
      setSaving(false);
    }
  };

  // Don't render if we couldn't find a phone on file.
  if (!loading && (!status || !status.hasPhone)) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Text Message Notifications
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking your preferences…
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="sms-pref" className="text-sm font-medium">
                Receive appointment & quote texts
              </Label>
              <p className="text-xs text-muted-foreground">
                {status?.phoneLast4
                  ? `Sent to the number ending in ${status.phoneLast4}.`
                  : 'Sent to the number on your account.'}{' '}
                You can also reply STOP to any text to opt out.
              </p>
            </div>
            <Switch
              id="sms-pref"
              checked={!status?.optedOut}
              onCheckedChange={handleToggle}
              disabled={saving}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
