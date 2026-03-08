import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { 
  Calendar, CheckCircle2, ArrowRight, CreditCard, 
  Home, Clock, Share2, Copy, FileText, AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface QuoteService {
  id: string;
  name: string;
  frequency: number;
  pricePerVisit: number;
  annualTotal: number;
}

interface QuotePayment {
  annualTotal: number;
  downPayment: number;
  monthlyPayment: number;
}

interface QuoteData {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  services_json: {
    type: string;
    paymentStructure: {
      downPaymentPercent: number;
      monthlyPayments: number;
      totalPayments: number;
    };
    services: QuoteService[];
    payment: QuotePayment;
  };
  home_details_json: {
    squareFootage: number;
    stories: number;
    customerAddress?: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
  };
  status: string;
  created_at: string;
  expires_at: string | null;
}

export default function QuoteView() {
  const { id } = useParams<{ id: string }>();
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (!id) return;
    
    const fetchQuote = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const { data, error: fetchError } = await supabase
          .from('quotes')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        
        if (fetchError) throw fetchError;
        
        if (!data) {
          setError('Quote not found');
          return;
        }
        
        // Mark as viewed if first time
        if (data.status === 'pending' && !data.viewed_at) {
          await supabase
            .from('quotes')
            .update({ viewed_at: new Date().toISOString(), status: 'viewed' })
            .eq('id', id);
        }
        
        // Type cast the JSON fields
        setQuote(data as unknown as QuoteData);
      } catch (err) {
        console.error('Error fetching quote:', err);
        setError('Unable to load quote');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchQuote();
  }, [id]);
  
  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard!');
  };
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading quote...</div>
      </div>
    );
  }
  
  if (error || !quote) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-xl font-semibold mb-2">Quote Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This quote may have expired or the link is invalid.
            </p>
            <Button asChild>
              <Link to="/plan-builder">Create a New Quote</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const { services_json: servicesData, home_details_json: homeData } = quote;
  const { services, payment, paymentStructure } = servicesData;
  
  const isExpired = quote.expires_at && new Date(quote.expires_at) < new Date();
  
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <FileText className="w-4 h-4" />
            Service Plan Quote
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
            Your Custom Service Plan
          </h1>
          <p className="text-muted-foreground">
            Quote created {format(new Date(quote.created_at), 'MMMM d, yyyy')}
          </p>
          
          {isExpired && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              This quote has expired
            </div>
          )}
        </div>
        
        <div className="grid md:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="md:col-span-2 space-y-6">
            {/* Customer Info */}
            <Card className="card-elevated">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Home className="w-5 h-5 text-primary" />
                  Property Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Customer</span>
                    <p className="font-medium">{quote.customer_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="font-medium">{quote.customer_email}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone</span>
                    <p className="font-medium">{quote.customer_phone}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Home Size</span>
                    <p className="font-medium">
                      {homeData.squareFootage.toLocaleString()} sq ft • {homeData.stories} {homeData.stories === 1 ? 'story' : 'stories'}
                    </p>
                  </div>
                </div>
                {homeData.customerAddress && (
                  <div className="pt-2 border-t">
                    <span className="text-sm text-muted-foreground">Service Address</span>
                    <p className="font-medium text-sm">
                      {homeData.customerAddress.street}
                      {homeData.customerAddress.city && `, ${homeData.customerAddress.city}`}
                      {homeData.customerAddress.state && `, ${homeData.customerAddress.state}`}
                      {homeData.customerAddress.zip && ` ${homeData.customerAddress.zip}`}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Services */}
            <Card className="card-elevated">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Included Services
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {services.map((service) => (
                    <li key={service.id} className="flex justify-between items-center py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium">{service.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {service.frequency}x per year @ ${service.pricePerVisit}/visit
                        </p>
                      </div>
                      <span className="font-semibold text-foreground">
                        ${service.annualTotal}/yr
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          
          {/* Sidebar - Payment */}
          <div className="md:col-span-1">
            <Card className="card-elevated sticky top-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  Payment Plan
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Annual Total */}
                <div className="text-center py-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Annual Value</p>
                  <p className="text-3xl font-bold text-foreground">${payment.annualTotal}</p>
                </div>
                
                <Separator />
                
                {/* Payment Structure */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                      1
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">Down Payment ({paymentStructure.downPaymentPercent}%)</p>
                      <p className="text-xl font-bold text-primary">${payment.downPayment}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-muted-foreground text-sm pl-4">
                    <ArrowRight className="w-4 h-4" />
                    <span>Then {paymentStructure.monthlyPayments} monthly payments</span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-sm font-bold">
                      2-12
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground">Monthly Payment</p>
                      <p className="text-xl font-bold text-foreground">${payment.monthlyPayment}/mo</p>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                {/* Actions */}
                <div className="space-y-2">
                  {!isExpired && (
                    <Button className="w-full btn-primary" size="lg" asChild>
                      <Link to="/plan-builder">Accept & Start Service</Link>
                    </Button>
                  )}
                  
                  <Button 
                    variant="outline" 
                    className="w-full" 
                    onClick={handleCopyLink}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Quote Link
                  </Button>
                </div>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center">
                  <Clock className="w-3 h-3" />
                  <span>Quote valid for 30 days</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        
        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Prices are estimates based on the information provided. 
            Final pricing may adjust if on-site conditions differ.
          </p>
          <Button variant="ghost" asChild>
            <Link to="/plan-builder">
              Create a Different Plan
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
