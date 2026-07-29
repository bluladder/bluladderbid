import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { launchDiagnosticFixtures } from "@/lib/ops/launchDiagnostics.fixtures";
import { resolveDiagnosticsMode, selectLaunchDiagnostics } from "@/lib/ops/launchDiagnostics";
import { ShieldAlert } from "lucide-react";

export function LaunchDiagnosticsPanel() {
  const mode = resolveDiagnosticsMode(import.meta.env.VITE_LAUNCH_DIAGNOSTICS_MODE);
  const items = mode === "repository_fixture"
    ? selectLaunchDiagnostics(launchDiagnosticFixtures, {
      authenticated: true,
      adminAuthorized: true,
      organizationId: "00000000-0000-4000-8000-0000000000df",
    })
    : [];

  return (
    <Card className="border-amber-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" />
          Unified launch diagnostics
          <Badge variant="outline">{mode === "disabled" ? "Disabled" : "Repository fixture"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          The organization-scoped diagnostic contract and recovery harness are repository-ready.
          Hosted persistence and operator actions are not active, so this panel does not query
          production data or offer retries.
        </p>
        {mode === "disabled" ? (
          <p className="font-medium">
            Awaiting a separately authorized hosted schema, deployment, and verification window.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="font-medium text-amber-700">Fixture evidence only — not a production health signal.</p>
            <ul className="grid gap-2 md:grid-cols-2">
              {items.map((item) => (
                <li key={item.id} className="rounded border p-2">
                  <div className="font-medium">{item.kind}</div>
                  <div className="text-xs text-muted-foreground">{item.reasonCode} · {item.correlationId}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
