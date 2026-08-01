import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface AsyncStatePanelProps {
  state: 'loading' | 'unavailable' | 'empty';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}

export function AsyncStatePanel({ state, title, children, action, testId }: AsyncStatePanelProps) {
  const loading = state === 'loading';
  return (
    <Alert
      variant={state === 'unavailable' ? 'destructive' : 'default'}
      role="status"
      aria-live="polite"
      aria-busy={loading}
      data-testid={testId}
      className="bg-muted/30"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
      )}
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
      {action && <div className="mt-3 pl-7">{action}</div>}
    </Alert>
  );
}
