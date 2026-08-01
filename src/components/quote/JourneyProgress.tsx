import type { ElementType } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface JourneyStep<StepId extends string> {
  id: StepId;
  label: string;
  icon: ElementType;
}

interface JourneyProgressProps<StepId extends string> {
  steps: readonly JourneyStep<StepId>[];
  currentStep: StepId;
  label?: string;
}

export function JourneyProgress<StepId extends string>({
  steps,
  currentStep,
  label = 'Quote progress',
}: JourneyProgressProps<StepId>) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));
  return (
    <nav aria-label={label} className="mx-auto w-full max-w-2xl">
      <ol className="flex items-start justify-between">
        {steps.map((step, index) => {
          const completed = index < currentIndex;
          const current = index === currentIndex;
          const Icon = step.icon;
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-start" aria-current={current ? 'step' : undefined}>
              <div className="flex min-w-0 flex-1 flex-col items-center">
                <span
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors',
                    completed && 'border-success bg-success text-success-foreground',
                    current && 'border-primary bg-primary text-primary-foreground shadow-md',
                    !completed && !current && 'border-border bg-muted text-muted-foreground',
                  )}
                >
                  {completed ? <Check className="h-5 w-5" aria-hidden="true" /> : <Icon className="h-5 w-5" aria-hidden="true" />}
                </span>
                <span className={cn('mt-2 text-center text-xs font-medium', current ? 'text-primary' : completed ? 'text-success' : 'text-muted-foreground')}>
                  {step.label}
                </span>
                <span className="sr-only">{completed ? 'Completed' : current ? 'Current step' : 'Not started'}</span>
              </div>
              {index < steps.length - 1 && (
                <span className="mt-5 h-0.5 w-8 shrink-0 bg-muted sm:w-20" aria-hidden="true">
                  <span className={cn('block h-full', completed && 'bg-success')} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
