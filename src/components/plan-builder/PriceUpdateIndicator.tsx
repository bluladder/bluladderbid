import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

interface PriceUpdateIndicatorProps {
  price: number;
}

export function PriceUpdateIndicator({ price }: PriceUpdateIndicatorProps) {
  const [showUpdate, setShowUpdate] = useState(false);
  const [prevPrice, setPrevPrice] = useState(price);
  const [direction, setDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price !== prevPrice && prevPrice > 0) {
      setDirection(price > prevPrice ? 'up' : 'down');
      setShowUpdate(true);
      
      const timer = setTimeout(() => {
        setShowUpdate(false);
        setDirection(null);
      }, 1500);
      
      setPrevPrice(price);
      return () => clearTimeout(timer);
    }
    
    if (prevPrice === 0 && price > 0) {
      setPrevPrice(price);
    }
  }, [price, prevPrice]);

  if (!showUpdate) return null;

  return (
    <div className={`
      inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
      animate-in fade-in slide-in-from-right-2 duration-200
      ${direction === 'up' 
        ? 'bg-amber-100 text-amber-700' 
        : 'bg-success/20 text-success'
      }
    `}>
      <Check className="w-3 h-3" />
      Plan updated
    </div>
  );
}
