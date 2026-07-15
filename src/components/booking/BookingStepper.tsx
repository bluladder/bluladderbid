import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BookingStepKey = 'review' | 'info' | 'time' | 'confirmation';

const STEPS: Array<{ key: BookingStepKey; label: string; short: string }> = [
  { key: 'review', label: 'Review', short: 'Review' },
  { key: 'info', label: 'Your Info', short: 'Info' },
  { key: 'time', label: 'Pick a Time', short: 'Time' },
  { key: 'confirmation', label: 'Confirmed', short: 'Done' },
];

interface BookingStepperProps {
  current: BookingStepKey;
}

export function BookingStepper({ current }: BookingStepperProps) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <nav aria-label="Booking progress" className="w-full">
      <ol className="flex items-center justify-between gap-1 sm:gap-2">
        {STEPS.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isUpcoming = idx > currentIdx;

          return (
            <li key={step.key} className="flex-1 flex items-center gap-1 sm:gap-2 min-w-0">
              <div
                className={cn(
                  'flex items-center gap-1.5 sm:gap-2 min-w-0',
                  isCurrent && 'text-primary',
                  isDone && 'text-success',
                  isUpcoming && 'text-muted-foreground',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold transition-colors',
                    isDone && 'bg-success text-success-foreground',
                    isCurrent && 'bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background',
                    isUpcoming && 'bg-muted text-muted-foreground',
                  )}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <span
                  className={cn(
                    'text-xs sm:text-sm font-medium truncate',
                    isCurrent && 'font-semibold',
                  )}
                >
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.short}</span>
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 min-w-[8px] rounded-full transition-colors',
                    idx < currentIdx ? 'bg-success' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}