import { Calendar, Check } from 'lucide-react';

export function PlanBuilderHeader() {
  return (
    <div className="text-center mb-8">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
        <Calendar className="w-4 h-4" />
        12-Month Service Plan
      </div>
      <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
        Build Your Custom Service Plan
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
        Compare BluLadder’s maintenance plans, review authoritative payment information and share preferences before activation.
      </p>
      
      <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground">
          <Check className="w-4 h-4 text-primary" />
          <span>Authoritative payment schedule</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground">
          <Check className="w-4 h-4 text-primary" />
          <span>Preferences confirmed before activation</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground">
          <Check className="w-4 h-4 text-primary" />
          <span>No payment collected on this screen</span>
        </div>
      </div>
    </div>
  );
}
