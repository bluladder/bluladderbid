import { Calendar, RefreshCw, Sparkles, Star, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type ServiceMode = 'one-time' | 'recurring' | null;

interface ServiceModeSelectorProps {
  selectedMode: ServiceMode;
  onSelectMode: (mode: ServiceMode) => void;
}

export function ServiceModeSelector({ selectedMode, onSelectMode }: ServiceModeSelectorProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-display font-bold text-foreground">
          How would you like to get service?
        </h2>
        <p className="text-muted-foreground mt-2">
          Choose the option that works best for your home
        </p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 max-w-3xl mx-auto">
        {/* Single Visit Option */}
        <Card 
          className={`relative overflow-hidden cursor-pointer transition-all duration-300 ${
            selectedMode === 'one-time' 
              ? 'ring-2 ring-accent shadow-lg scale-[1.02]' 
              : 'hover:shadow-md hover:scale-[1.01] hover:border-accent/50'
          }`}
          onClick={() => onSelectMode('one-time')}
        >
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-full ${
                selectedMode === 'one-time' 
                  ? 'bg-accent text-accent-foreground' 
                  : 'bg-accent/10 text-accent'
              }`}>
                <Calendar className="w-6 h-6" />
              </div>
              
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Single Visit
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Best if you just need service once or want to try us out
                </p>
                
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <ArrowRight className="w-3 h-3 text-accent" />
                    No commitment required
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <ArrowRight className="w-3 h-3 text-accent" />
                    Book your preferred date
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <ArrowRight className="w-3 h-3 text-accent" />
                    Perfect for one-time cleans
                  </li>
                </ul>
              </div>
            </div>
            
            {selectedMode === 'one-time' && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-accent" />
            )}
          </CardContent>
        </Card>

        {/* Ongoing Service Plans */}
        <Card 
          className={`relative overflow-hidden cursor-pointer transition-all duration-300 ${
            selectedMode === 'recurring' 
              ? 'ring-2 ring-primary shadow-lg scale-[1.02]' 
              : 'hover:shadow-md hover:scale-[1.01] hover:border-primary/50'
          }`}
          onClick={() => onSelectMode('recurring')}
        >
          {/* Recommended Badge */}
          <div className="absolute top-3 right-3">
            <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
              <Star className="w-3 h-3 fill-primary" />
              Save More
            </Badge>
          </div>
          
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-full ${
                selectedMode === 'recurring' 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-primary/10 text-primary'
              }`}>
                <RefreshCw className="w-6 h-6" />
              </div>
              
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-1">
                  Ongoing Service Plans
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Scheduled service with savings up to 20%
                </p>
                
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="w-3 h-3 text-primary" />
                    Automatic scheduling
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="w-3 h-3 text-primary" />
                    Priority booking
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Sparkles className="w-3 h-3 text-primary" />
                    Locked-in pricing
                  </li>
                </ul>
              </div>
            </div>
            
            {selectedMode === 'recurring' && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Reassurance text */}
      <p className="text-center text-xs text-muted-foreground max-w-md mx-auto">
        Most homeowners choose a service plan to keep their home consistently clean and save over time.
      </p>
    </div>
  );
}
