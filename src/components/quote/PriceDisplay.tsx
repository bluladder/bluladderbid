import { cn } from '@/lib/utils';
import { formatQuotePrice } from './priceFormat';

interface PriceDisplayProps {
  value: number;
  prefix?: string;
  className?: string;
  testId?: string;
}

export function PriceDisplay({ value, prefix, className, testId }: PriceDisplayProps) {
  return (
    <span className={cn('price-display tabular-nums', className)} data-testid={testId}>
      {prefix && <span className="mr-1 text-sm font-medium text-muted-foreground">{prefix}</span>}
      {formatQuotePrice(value)}
    </span>
  );
}
