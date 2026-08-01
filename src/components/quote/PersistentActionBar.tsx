import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PersistentActionBarProps {
  label: string;
  onAction: () => void;
  visible: boolean;
  disabled?: boolean;
}

export function PersistentActionBar({ label, onAction, visible, disabled = false }: PersistentActionBarProps) {
  useEffect(() => {
    if (!visible) return;
    document.documentElement.style.setProperty('--quote-action-height', '6.75rem');
    return () => document.documentElement.style.removeProperty('--quote-action-height');
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-primary/20 bg-background/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_hsl(var(--foreground)/0.12)] backdrop-blur md:hidden"
      data-testid="persistent-quote-action"
    >
      <Button type="button" className="h-14 w-full text-base" onClick={onAction} disabled={disabled}>
        <span>{label}</span>
        <ArrowRight className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
