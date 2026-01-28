import { Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BookOneTimeCTAProps {
  total: number;
  hasServices: boolean;
  isSticky?: boolean;
  onBook: () => void;
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function BookOneTimeCTA({ 
  total, 
  hasServices, 
  isSticky = false,
  onBook 
}: BookOneTimeCTAProps) {
  return (
    <div className={cn(
      'transition-all',
      isSticky && 'fixed bottom-0 left-0 right-0 z-50 p-4 bg-background/95 backdrop-blur-md border-t border-border shadow-2xl md:static md:p-0 md:bg-transparent md:backdrop-blur-none md:border-0 md:shadow-none'
    )}>
      <Button
        onClick={onBook}
        disabled={!hasServices}
        size="lg"
        className={cn(
          'w-full text-base font-bold shadow-lg',
          'bg-primary hover:bg-primary/90',
          'h-14 md:h-12',
          isSticky && 'rounded-xl'
        )}
      >
        {hasServices ? (
          <>
            <Calendar className="w-5 h-5 mr-2" />
            Book One-Time Service
            <span className="ml-2 font-mono">{formatPrice(total)}</span>
            <ArrowRight className="w-5 h-5 ml-2" />
          </>
        ) : (
          'Select services to continue'
        )}
      </Button>
      
      {/* Trust microcopy */}
      {hasServices && (
        <p className="text-center text-xs text-muted-foreground mt-2 md:mt-1.5">
          No payment required until service is complete
        </p>
      )}
    </div>
  );
}
