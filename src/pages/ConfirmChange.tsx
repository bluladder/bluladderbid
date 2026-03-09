import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle, XCircle, Calendar, Clock, DollarSign, ArrowRight, AlertTriangle, Home } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface PendingConfirmation {
  id: string;
  booking_id: string;
  change_type: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  admin_note: string | null;
  show_price_change: boolean;
  expires_at: string;
  status: string;
  booking?: {
    reference_number: string;
    scheduled_start: string | null;
    services_json: Array<{ name: string; price: number }>;
    total: number;
  };
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(price);
}

function formatDateTime(iso: string): string {
  return format(parseISO(iso), 'EEEE, MMMM d, yyyy \'at\' h:mm a');
}

export default function ConfirmChange() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      loadConfirmation();
    } else {
      setError('No confirmation token provided');
      setLoading(false);
    }
  }, [token]);

  const loadConfirmation = async () => {
    try {
      // Fetch confirmation data via edge function (token acts as secret key)
      const { data, error: fetchError } = await supabase.functions.invoke('handle-confirmation', {
        body: { token, action: 'fetch' },
      });

      if (fetchError) {
        throw new Error(fetchError.message || 'Failed to load confirmation');
      }

      if (data?.error) {
        setError(data.error);
        return;
      }

      if (data?.alreadyProcessed) {
        setError(`This change has already been ${data.status}.`);
        return;
      }

      if (data?.expired) {
        setError('This confirmation link has expired. Please contact us for assistance.');
        return;
      }

      if (!data?.confirmation) {
        setError('This confirmation link is invalid or has already been used.');
        return;
      }

      setConfirmation(data.confirmation as PendingConfirmation);
    } catch (err) {
      console.error('Failed to load confirmation:', err);
      setError('Failed to load confirmation details.');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: 'accept' | 'decline') => {
    if (!token) return;
    
    setSubmitting(true);
    try {
      const { data, error: actionError } = await supabase.functions.invoke('handle-confirmation', {
        body: { token, action },
      });

      if (actionError) throw actionError;
      
      if (data?.error) {
        throw new Error(data.error);
      }

      setResult({
        success: action === 'accept',
        message: data.message,
      });
    } catch (err) {
      console.error('Failed to process confirmation:', err);
      setError(err instanceof Error ? err.message : 'Failed to process your response.');
    } finally {
      setSubmitting(false);
    }
  };

  const getChangeTypeLabel = (type: string) => {
    switch (type) {
      case 'reschedule': return 'Reschedule Request';
      case 'services_modified': return 'Service Changes';
      case 'cancelled': return 'Cancellation Request';
      default: return 'Appointment Change';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading confirmation details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-2" />
            <CardTitle>Unable to Process</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/">
                <Home className="w-4 h-4 mr-2" />
                Return Home
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            {result.success ? (
              <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-2" />
            ) : (
              <XCircle className="w-12 h-12 mx-auto text-amber-500 mb-2" />
            )}
            <CardTitle>{result.success ? 'Confirmed!' : 'Declined'}</CardTitle>
            <CardDescription>{result.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild className="w-full">
              <Link to="/my-appointments">View My Appointments</Link>
            </Button>
            <Button variant="outline" asChild className="w-full">
              <Link to="/">Return Home</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!confirmation) return null;

  const { change_type, old_values, new_values, admin_note, show_price_change, booking } = confirmation;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-lg mx-auto pt-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-primary">BluLadder</h1>
          <p className="text-muted-foreground">Appointment Confirmation</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="outline">{booking?.reference_number}</Badge>
              <Badge className="bg-amber-100 text-amber-800">
                {getChangeTypeLabel(change_type)}
              </Badge>
            </div>
            <CardTitle className="mt-4">Please Review This Change</CardTitle>
            <CardDescription>
              Your appointment has a pending change that requires your confirmation.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Change Details */}
            {change_type === 'reschedule' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Date & Time</p>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground line-through">
                        {old_values.scheduled_start ? formatDateTime(old_values.scheduled_start as string) : 'Previous time'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm mt-1">
                      <ArrowRight className="w-4 h-4 text-green-600" />
                      <span className="font-medium text-green-700">
                        {new_values.scheduled_start ? formatDateTime(new_values.scheduled_start as string) : 'New time'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {change_type === 'services_modified' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Services</p>
                    {old_values.services_json && (
                      <p className="text-sm text-muted-foreground line-through">
                        {(old_values.services_json as Array<{name: string}>).map(s => s.name).join(', ')}
                      </p>
                    )}
                    {new_values.services_json && (
                      <p className="text-sm font-medium text-green-700">
                        {(new_values.services_json as Array<{name: string}>).map(s => s.name).join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                {show_price_change && new_values.total && (
                  <div className="flex items-start gap-3">
                    <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Total</p>
                      <div className="flex items-center gap-2 text-sm">
                        {old_values.total && (
                          <span className="text-muted-foreground line-through">
                            {formatPrice(old_values.total as number)}
                          </span>
                        )}
                        <ArrowRight className="w-4 h-4" />
                        <span className="font-medium">{formatPrice(new_values.total as number)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {change_type === 'cancelled' && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This is a request to cancel your appointment. If you confirm, your appointment will be cancelled.
                </AlertDescription>
              </Alert>
            )}

            {/* Admin Note */}
            {admin_note && (
              <>
                <Separator />
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm font-medium mb-1">Note from our team:</p>
                  <p className="text-sm text-muted-foreground">{admin_note}</p>
                </div>
              </>
            )}

            <Separator />

            {/* Action Buttons */}
            <div className="space-y-3">
              <Button 
                className="w-full" 
                size="lg"
                onClick={() => handleAction('accept')}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Accept Changes
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                size="lg"
                onClick={() => handleAction('decline')}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4 mr-2" />
                )}
                Decline - Keep Original
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              This confirmation link expires on{' '}
              {format(parseISO(confirmation.expires_at), 'MMMM d, yyyy \'at\' h:mm a')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
