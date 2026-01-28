import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Badge } from '@/components/ui/badge';

const SKILL_LEVELS = [
  { 
    level: 1, 
    label: 'Basic', 
    color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    description: 'Entry-level technician. Assigned to simple, low-complexity jobs only. Lowest priority in scheduling.' 
  },
  { 
    level: 2, 
    label: 'Developing', 
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    description: 'Growing skills. Can handle routine jobs but deprioritized for complex work.' 
  },
  { 
    level: 3, 
    label: 'Competent', 
    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    description: 'Default level. Reliably handles standard jobs. Neutral priority in scheduling.' 
  },
  { 
    level: 4, 
    label: 'Proficient', 
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    description: 'Highly skilled. Preferred for complex jobs and multi-story homes.' 
  },
  { 
    level: 5, 
    label: 'Expert', 
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    description: 'Top-tier technician. First choice for big jobs, difficult properties, and VIP customers.' 
  },
];

interface SkillLevelLegendProps {
  compact?: boolean;
}

export function SkillLevelLegend({ compact = false }: SkillLevelLegendProps) {
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Info className="w-3.5 h-3.5" />
              <span>What do skill levels mean?</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs p-3">
            <div className="space-y-2">
              <p className="font-medium text-sm">Skill Level Priority</p>
              <p className="text-xs text-muted-foreground">
                Higher skill levels are preferred for complex jobs. Level 5 techs are assigned first for big jobs, multi-story homes, and VIP customers.
              </p>
              <div className="flex flex-wrap gap-1 mt-2">
                {SKILL_LEVELS.map((s) => (
                  <Badge key={s.level} variant="secondary" className={`text-[10px] ${s.color}`}>
                    {s.level} - {s.label}
                  </Badge>
                ))}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-dashed border-muted-foreground/30 rounded px-2 py-1">
          <Info className="w-3.5 h-3.5" />
          <span>Skill Level Guide</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-80">
        <div className="space-y-3">
          <div>
            <h4 className="font-semibold text-sm">Skill Level & Job Priority</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Skill levels determine which technicians are preferred when multiple are available for a job.
            </p>
          </div>
          <div className="space-y-2">
            {SKILL_LEVELS.map((skill) => (
              <div key={skill.level} className="flex items-start gap-2">
                <Badge variant="secondary" className={`text-[10px] shrink-0 ${skill.color}`}>
                  {skill.level}
                </Badge>
                <div>
                  <span className="font-medium text-xs">{skill.label}</span>
                  <p className="text-[10px] text-muted-foreground leading-tight">{skill.description}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic border-t pt-2">
            Default level is 3 (Competent). Set per-service levels to fine-tune technician assignments.
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function SkillLevelBadge({ level }: { level: number | undefined }) {
  const skill = SKILL_LEVELS.find(s => s.level === (level ?? 3)) || SKILL_LEVELS[2];
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className={`text-[10px] cursor-help ${skill.color}`}>
            {skill.level} - {skill.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{skill.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
