import React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

interface State { error: Error | null }

export class SecurityErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console so the user's next message includes a real signal.
    // eslint-disable-next-line no-console
    console.error("[SecurityTab crash]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Security panel failed to render</AlertTitle>
          <AlertDescription>
            <p className="text-sm">{this.state.error.message}</p>
            <pre className="mt-2 text-xs whitespace-pre-wrap opacity-80">
              {this.state.error.stack?.split("\n").slice(0, 6).join("\n")}
            </pre>
          </AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}