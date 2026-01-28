import { Badge } from '@/components/ui/badge';
import { 
  Check, 
  X, 
  AlertTriangle, 
  Home, 
  Users, 
  Wrench,
  Droplets,
  Shield
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TechnicianCapabilities {
  can_do_windows?: boolean;
  can_do_gutters?: boolean;
  can_do_pressure?: boolean;
  has_pressure_washer?: boolean;
  has_ladder_2_story?: boolean;
  is_roof_safe?: boolean;
  requires_bundle_for_windows?: boolean;
  eligible_for_big_job_pairing?: boolean;
  [key: string]: boolean | undefined | object | string[];
}

interface TechnicianRulesSummaryProps {
  capabilities: TechnicianCapabilities | null;
  maxStories: number | null;
  name: string;
}

export function TechnicianRulesSummary({ capabilities, maxStories, name }: TechnicianRulesSummaryProps) {
  if (!capabilities) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No scheduling rules configured
      </div>
    );
  }

  const rules: { icon: React.ReactNode; text: string; type: 'can' | 'cannot' | 'requires' | 'info' }[] = [];

  // Service capabilities
  if (capabilities.can_do_windows) {
    rules.push({ icon: <Check className="w-3 h-3" />, text: 'Window Cleaning', type: 'can' });
  }
  if (capabilities.can_do_gutters) {
    rules.push({ icon: <Check className="w-3 h-3" />, text: 'Gutter Cleaning', type: 'can' });
  }
  if (capabilities.can_do_pressure || capabilities.has_pressure_washer) {
    rules.push({ icon: <Droplets className="w-3 h-3" />, text: 'Pressure Washing', type: 'can' });
  }

  // Restrictions
  if (!capabilities.can_do_pressure && !capabilities.has_pressure_washer) {
    rules.push({ icon: <X className="w-3 h-3" />, text: 'Pressure Washing', type: 'cannot' });
  }

  // Bundle requirement
  if (capabilities.requires_bundle_for_windows) {
    rules.push({ 
      icon: <AlertTriangle className="w-3 h-3" />, 
      text: 'Requires bundle for windows', 
      type: 'requires' 
    });
  }

  // Story limit
  if (maxStories) {
    rules.push({ 
      icon: <Home className="w-3 h-3" />, 
      text: `${maxStories}-story homes only`, 
      type: 'info' 
    });
  }

  // Big job pairing
  if (capabilities.eligible_for_big_job_pairing) {
    rules.push({ 
      icon: <Users className="w-3 h-3" />, 
      text: 'Can pair on big jobs', 
      type: 'info' 
    });
  }

  // Equipment
  if (capabilities.has_ladder_2_story) {
    rules.push({ icon: <Wrench className="w-3 h-3" />, text: 'Has 2-story ladder', type: 'info' });
  }
  if (capabilities.is_roof_safe) {
    rules.push({ icon: <Shield className="w-3 h-3" />, text: 'Roof-safe certified', type: 'info' });
  }

  const canDo = rules.filter(r => r.type === 'can');
  const cannotDo = rules.filter(r => r.type === 'cannot');
  const restrictions = rules.filter(r => r.type === 'requires');
  const info = rules.filter(r => r.type === 'info');

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {/* Can perform */}
        {canDo.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {canDo.map((rule, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800">
                {rule.icon}
                <span className="ml-1">{rule.text}</span>
              </Badge>
            ))}
          </div>
        )}

        {/* Cannot perform */}
        {cannotDo.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {cannotDo.map((rule, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800">
                {rule.icon}
                <span className="ml-1">No {rule.text}</span>
              </Badge>
            ))}
          </div>
        )}

        {/* Restrictions */}
        {restrictions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {restrictions.map((rule, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 cursor-help">
                    {rule.icon}
                    <span className="ml-1">{rule.text}</span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">This affects online booking behavior</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {/* Info badges */}
        {info.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {info.map((rule, i) => (
              <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0.5">
                {rule.icon}
                <span className="ml-1">{rule.text}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
