import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Braces } from 'lucide-react';
import { TEMPLATE_VARS } from './messageTemplateVars';

export function VariableMenu({ onInsert, size = 'sm' }: { onInsert: (token: string) => void; size?: 'sm' | 'xs' }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={size === 'xs' ? 'h-8' : ''}>
          <Braces className="w-3.5 h-3.5 mr-1" /> Insert variable
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Personalization variables</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TEMPLATE_VARS.map((v) => (
          <DropdownMenuItem key={v.token} onClick={() => onInsert(v.token)} className="flex flex-col items-start gap-0.5">
            <span className="font-medium">{v.label}</span>
            <span className="text-xs text-muted-foreground"><code>{v.token}</code> → {v.example}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
