import { Calendar, ArrowRight, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface BookOneTimeCTAProps {
  total: number;
  hasServices: boolean;
  isSticky?: boolean;
  onBook: () => void;
  serviceCount?: number;
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
  onBook,
  serviceCount = 0,
}: BookOneTimeCTAProps) {
  const isMobile = useIsMobile();
  
  // Always show sticky on mobile when services are selected
  const showSticky = isSticky || (isMobile && hasServices);
  
  return (
    <div className={cn(
      'transition-all duration-300',
      showSticky && 'fixed bottom-0 left-0 right-0 z-50 p-4 bg-background/98 backdrop-blur-lg border-t-2 border-primary/20 shadow-[0_-8px_30px_rgba(0,0,0,0.2)] md:static md:p-0 md:bg-transparent md:backdrop-blur-none md:border-0 md:shadow-none'
    )}>
      {/* Mobile urgency indicator */}
      {showSticky && hasServices && isMobile && (
        <div className="flex items-center justify-center gap-2 mb-3 text-xs text-primary font-medium">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Lock in your price • {serviceCount} service{serviceCount !== 1 ? 's' : ''} selected</span>
        </div>
      )}
      
      <Button
        onClick={onBook}
        disabled={!hasServices}
        size="lg"
        className={cn(
          'w-full font-bold shadow-xl group',
          'bg-primary hover:bg-primary/90 text-primary-foreground',
          'h-16 text-lg md:h-14 md:text-base',
          'transition-all duration-200 active:scale-[0.98]',
          showSticky && 'rounded-xl',
          hasServices && 'animate-pulse-subtle'
        )}
      >
        {hasServices ? (
          <>
            <Calendar className="w-6 h-6 mr-2 md:w-5 md:h-5" />
            <span>Book One-Time Service</span>
            <span className="ml-3 font-mono bg-primary-foreground/20 px-3 py-1 rounded-lg text-lg">
              {formatPrice(total)}
            </span>
            <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-0.5 transition-transform" />
          </>
        ) : (
          <>
            <Check className="w-5 h-5 mr-2 opacity-50" />
            Select services to continue
          </>
        )}
      </Button>
      
      {/* Trust microcopy */}
      {hasServices && (
        <p className="text-center text-xs text-muted-foreground mt-3">
          No payment required until service is complete
        </p>
      )}
    </div>
  );
}
