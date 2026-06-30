import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, ArrowRight, Clock } from 'lucide-react';
import { format, parseISO, isBefore } from 'date-fns';

export interface SavedQuote {
  id: string;
  status: string;
  total: number;
  services_json: { services?: Array<{ name: string }> } | null;
  home_details_json: Record<string, unknown> | null;
  created_at: string;
  expires_at: string | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'converted':
      return 'default';
    case 'declined':
    case 'expired':
      return 'destructive';
    case 'viewed':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function SavedQuotesCard({ quotes }: { quotes: SavedQuote[] }) {
  if (!quotes || quotes.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Your Saved Quotes
        </CardTitle>
        <CardDescription>
          Quotes we've prepared for you. Pricing is held for 30 days from the quote date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {quotes.map((quote) => {
          const serviceNames = quote.services_json?.services?.map((s) => s.name).filter(Boolean) || [];
          const isExpired = quote.expires_at
            ? isBefore(parseISO(quote.expires_at), new Date())
            : false;

          return (
            <div
              key={quote.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border bg-card"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{formatCurrency(quote.total)}</span>
                  <Badge variant={isExpired ? 'destructive' : statusVariant(quote.status)} className="text-[10px]">
                    {isExpired ? 'Expired' : quote.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {serviceNames.length > 0 ? serviceNames.join(', ') : 'Service plan quote'}
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3" />
                  Created {format(parseISO(quote.created_at), 'MMM d, yyyy')}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link to={`/quote/${quote.id}`}>
                  View Quote
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Link>
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
