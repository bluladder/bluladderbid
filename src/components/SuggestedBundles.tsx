import { useState } from 'react';
import { SUGGESTED_BUNDLES, ServiceBundle } from '@/types/bundles';
import { ChevronDown, ChevronRight, Sparkles, ArrowRight, Star } from 'lucide-react';

interface SuggestedBundlesProps {
  onApplyBundle: (bundle: ServiceBundle) => void;
}

export function SuggestedBundles({ onApplyBundle }: SuggestedBundlesProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get tier label for display
  const getTierLabel = (tier?: 'good' | 'better' | 'best') => {
    switch (tier) {
      case 'good': return 'Good';
      case 'better': return 'Better';
      case 'best': return 'Best';
      default: return null;
    }
  };

  return (
    <div className="mb-6">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 text-left group"
      >
        <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium">Suggested Bundles</span>
          <span className="text-xs text-muted-foreground">(Optional)</span>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-3 animate-fade-in">
          <p className="text-xs text-muted-foreground mb-3 pl-8">
            Bundles are starting points. Most homeowners choose a plan similar to "Popular Home Protection" and customize from there.
          </p>
          
          <div className="grid sm:grid-cols-3 gap-3 pl-8">
            {SUGGESTED_BUNDLES.map((bundle) => (
              <div
                key={bundle.id}
                className={`relative flex flex-col gap-2 p-3.5 rounded-xl border transition-all duration-200 ${
                  bundle.recommended
                    ? 'border-primary/40 bg-gradient-to-br from-primary/5 to-transparent shadow-sm'
                    : 'card-gradient hover:border-primary/30'
                }`}
              >
                {/* Recommended badge */}
                {bundle.recommended && (
                  <div className="absolute -top-2 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wide">
                    <Star className="w-2.5 h-2.5" />
                    Most Popular
                  </div>
                )}
                
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-foreground truncate">
                      {bundle.name}
                    </h4>
                    {bundle.optimizedFor && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${
                        bundle.optimizedFor === 'good'
                          ? 'bg-muted text-muted-foreground'
                          : bundle.optimizedFor === 'better'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-success/10 text-success'
                      }`}>
                        {getTierLabel(bundle.optimizedFor)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {bundle.description}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplyBundle(bundle);
                    setIsExpanded(false);
                  }}
                  className={`flex-shrink-0 flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 hover:shadow-md ${
                    bundle.recommended
                      ? 'text-primary-foreground'
                      : 'text-primary-foreground'
                  }`}
                  style={{ background: 'var(--gradient-primary)' }}
                >
                  Apply
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
