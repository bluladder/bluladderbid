import { useState, ReactNode } from 'react';
import { ChevronDown, ChevronUp, LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AdminSectionProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
  headerAction?: ReactNode;
  variant?: 'default' | 'compact' | 'nested';
}

export function AdminSection({
  title,
  description,
  icon: Icon,
  children,
  defaultOpen = true,
  badge,
  badgeVariant = 'secondary',
  headerAction,
  variant = 'default',
}: AdminSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  if (variant === 'nested') {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center justify-between w-full py-3 px-4 rounded-lg bg-muted/50 hover:bg-muted/80 transition-colors text-left">
            <div className="flex items-center gap-3">
              {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
              <div>
                <span className="font-medium text-sm">{title}</span>
                {description && (
                  <p className="text-xs text-muted-foreground">{description}</p>
                )}
              </div>
              {badge && (
                <Badge variant={badgeVariant} className="text-[10px]">
                  {badge}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerAction}
              {isOpen ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-4 pl-4">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  
  if (variant === 'compact') {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center justify-between w-full py-2 text-left group">
            <div className="flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
              <span className="text-sm font-medium">{title}</span>
              {badge && (
                <Badge variant={badgeVariant} className="text-[10px]">
                  {badge}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {headerAction}
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                {isOpen ? 'Hide' : 'Show'}
              </span>
              {isOpen ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-3">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  
  // Default: Card-based section
  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {Icon && (
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                )}
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {title}
                    {badge && (
                      <Badge variant={badgeVariant} className="text-[10px]">
                        {badge}
                      </Badge>
                    )}
                  </CardTitle>
                  {description && (
                    <CardDescription className="mt-0.5">{description}</CardDescription>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {headerAction}
                {isOpen ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            {children}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Helper component for grouping related settings
interface SettingsGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsGroup({ title, description, children, className }: SettingsGroupProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div>
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// Quick action row for common operations
interface QuickActionRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function QuickActionRow({ label, description, children }: QuickActionRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0 pr-4">
        <span className="text-sm font-medium">{label}</span>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  );
}
