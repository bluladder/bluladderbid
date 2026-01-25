import { useState } from 'react';
import { Check, X, Loader2, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { validateDiscountCode, type ValidatedDiscount } from '@/hooks/useDiscountCodes';

interface DiscountCodeInputProps {
  onApply: (discount: ValidatedDiscount | null) => void;
  appliedDiscount: ValidatedDiscount | null;
}

export function DiscountCodeInput({ onApply, appliedDiscount }: DiscountCodeInputProps) {
  const [code, setCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (!code.trim()) return;

    setIsValidating(true);
    setError(null);

    const result = await validateDiscountCode(code.trim());

    setIsValidating(false);

    if (result.valid && result.discount) {
      onApply(result.discount);
      setCode('');
    } else {
      setError(result.error || 'Invalid code');
    }
  };

  const handleRemove = () => {
    onApply(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  if (appliedDiscount) {
    return (
      <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-800 dark:text-green-200">
            {appliedDiscount.code} applied
          </span>
          <span className="text-sm text-green-600 dark:text-green-400">
            ({appliedDiscount.type === 'percentage'
              ? `${appliedDiscount.value}% off`
              : `$${appliedDiscount.value.toFixed(2)} off`})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRemove}
          className="text-green-700 hover:text-green-800 hover:bg-green-100"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Discount code"
            className="pl-9"
            disabled={isValidating}
          />
        </div>
        <Button
          variant="outline"
          onClick={handleApply}
          disabled={!code.trim() || isValidating}
        >
          {isValidating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Apply'
          )}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
