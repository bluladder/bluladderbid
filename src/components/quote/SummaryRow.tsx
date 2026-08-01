import type { ElementType, ReactNode } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SummaryRowProps {
  icon: ElementType;
  title: string;
  description?: string;
  price?: ReactNode;
  onEdit: () => void;
  onRemove: () => void;
}

export function SummaryRow({ icon: Icon, title, description, price, onEdit, onRemove }: SummaryRowProps) {
  return (
    <div className="rounded-xl border border-primary/35 bg-primary/[0.04] p-3" data-testid="selected-service-summary">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Check className="h-4 w-4 text-success" aria-hidden="true" />
            <span className="font-semibold text-foreground">{title}</span>
            <span className="sr-only">selected</span>
            {price && <span className="ml-auto font-semibold text-primary">{price}</span>}
          </div>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${title}`}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${title}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remove
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
