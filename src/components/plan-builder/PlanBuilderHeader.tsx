import { Calendar, Shield } from 'lucide-react';

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
        Create a personalized maintenance bundle with easy monthly payments. 
        Select the services you need and choose how often you want them.
      </p>
      
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="w-4 h-4 text-primary" />
          <span>20% down payment</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4 text-primary" />
          <span>11 easy monthly payments</span>
        </div>
      </div>
    </div>
  );
}
