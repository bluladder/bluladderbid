import { Calendar, ClipboardList, FileText } from 'lucide-react';
import { JourneyProgress } from '@/components/quote/JourneyProgress';

export type FlowStep = 'services' | 'quote' | 'book';

interface ProgressStepperProps {
  currentStep: FlowStep;
}

const steps = [
  { id: 'services' as const, label: 'Select Services', icon: ClipboardList },
  { id: 'quote' as const, label: 'Review Quote', icon: FileText },
  { id: 'book' as const, label: 'Book', icon: Calendar },
] as const;

export function ProgressStepper({ currentStep }: ProgressStepperProps) {
  return <JourneyProgress steps={steps} currentStep={currentStep} />;
}
