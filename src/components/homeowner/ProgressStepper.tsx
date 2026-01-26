import { Check, ClipboardList, FileText, Calendar } from 'lucide-react';

export type FlowStep = 'services' | 'quote' | 'book';

interface ProgressStepperProps {
  currentStep: FlowStep;
}

const steps = [
  { id: 'services' as const, label: 'Select Services', icon: ClipboardList },
  { id: 'quote' as const, label: 'Review Quote', icon: FileText },
  { id: 'book' as const, label: 'Book', icon: Calendar },
];

export function ProgressStepper({ currentStep }: ProgressStepperProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const Icon = step.icon;
          
          return (
            <div key={step.id} className="flex-1 flex items-center">
              {/* Step */}
              <div className="flex flex-col items-center flex-1">
                <div 
                  className={`
                    relative w-10 h-10 rounded-full flex items-center justify-center 
                    transition-all duration-300 ease-out
                    ${isCompleted 
                      ? 'bg-success text-success-foreground shadow-md' 
                      : isCurrent 
                        ? 'bg-primary text-primary-foreground shadow-lg scale-110' 
                        : 'bg-muted text-muted-foreground'
                    }
                  `}
                >
                  {isCompleted ? (
                    <Check className="w-5 h-5 animate-scale-in" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                  
                  {/* Pulse animation for current step */}
                  {isCurrent && (
                    <span className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                  )}
                </div>
                
                <span 
                  className={`
                    mt-2 text-xs font-medium transition-colors duration-200
                    ${isCurrent 
                      ? 'text-primary' 
                      : isCompleted 
                        ? 'text-success' 
                        : 'text-muted-foreground'
                    }
                  `}
                >
                  {step.label}
                </span>
              </div>
              
              {/* Connector line (not for last step) */}
              {index < steps.length - 1 && (
                <div className="flex-shrink-0 w-12 sm:w-20 h-0.5 mx-1 -mt-6">
                  <div 
                    className={`
                      h-full rounded-full transition-all duration-500 ease-out
                      ${index < currentIndex 
                        ? 'bg-success' 
                        : 'bg-muted'
                      }
                    `}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
