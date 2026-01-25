import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

interface WarningBannerProps {
  warnings: string[];
}

export function WarningBanner({ warnings }: WarningBannerProps) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const visibleWarnings = warnings.filter((_, i) => !dismissed.has(i));

  if (visibleWarnings.length === 0) return null;

  return (
    <div className="space-y-2 animate-fade-in">
      {warnings.map((warning, index) => {
        if (dismissed.has(index)) return null;

        return (
          <div
            key={index}
            className="flex items-center gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20"
          >
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
            <p className="text-sm text-foreground flex-1">{warning}</p>
            <button
              onClick={() => setDismissed((prev) => new Set([...prev, index]))}
              className="p-1 rounded hover:bg-warning/20 transition-colors"
            >
              <X className="w-4 h-4 text-warning" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
