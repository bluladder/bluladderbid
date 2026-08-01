import type { ElementType, ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChoiceCardProps {
  icon: ElementType;
  title: string;
  description: string;
  selected?: boolean;
  featured?: boolean;
  badge?: string;
  meta?: ReactNode;
  onSelect: () => void;
}

export function ChoiceCard({
  icon: Icon,
  title,
  description,
  selected = false,
  featured = false,
  badge,
  meta,
  onSelect,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${selected ? 'Selected' : 'Add'} ${title}`}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left',
        'transition-colors hover:border-primary/50 hover:bg-primary/[0.03]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected && 'border-primary bg-primary/5',
        featured && 'border-primary/60 ring-1 ring-primary/20',
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{title}</span>
          {featured && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Featured
            </span>
          )}
          {badge && (
            <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {meta && <span className="hidden text-xs text-muted-foreground sm:inline">{meta}</span>}
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            selected ? 'bg-success text-success-foreground' : 'bg-primary text-primary-foreground',
          )}
          aria-hidden="true"
        >
          {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
      </span>
    </button>
  );
}
