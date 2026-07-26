import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  phase?: string;
}

export function PlaceholderPanel({ icon: Icon, title, description, phase }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-semibold">{title}</h2>
        {phase && <p className="text-xs uppercase tracking-wide text-muted-foreground mt-1">{phase}</p>}
      </div>
      <Card>
        <CardContent className="py-16 text-center space-y-3">
          <div className="mx-auto rounded-full bg-primary/10 h-14 w-14 flex items-center justify-center">
            <Icon className="h-7 w-7 text-primary" />
          </div>
          <div className="font-medium">{title}</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}