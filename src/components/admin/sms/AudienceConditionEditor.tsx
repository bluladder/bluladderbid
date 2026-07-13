import { useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, Code, Users, X } from 'lucide-react';
import {
  AUDIENCE_FIELDS, type AudienceConditions, type AudienceMode,
  getAudienceMode, realConditions, summarizeAudience, validateAudienceConditions,
} from '@/lib/campaigns/campaignModel';

// Structured, JSON-free audience builder. Advanced JSON view is admin-only,
// validated, and can never introduce unsupported condition types.
export function AudienceConditionEditor({
  value, onChange,
}: {
  value: AudienceConditions;
  onChange: (next: AudienceConditions) => void;
}) {
  const mode = getAudienceMode(value);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const validation = useMemo(() => validateAudienceConditions(value), [value]);
  const summary = useMemo(() => summarizeAudience(value), [value]);
  const real = realConditions(value);

  const setMode = (m: AudienceMode) => {
    if (m === 'all') onChange({ __mode: 'all' });
    else onChange({ ...value, __mode: 'conditions' });
  };

  const setField = (key: string, v: unknown) => {
    const next = { ...value, __mode: 'conditions' as const };
    if (v === undefined) delete (next as Record<string, unknown>)[key];
    else (next as Record<string, unknown>)[key] = v;
    onChange(next);
  };

  const toggleMulti = (key: string, opt: string) => {
    const cur = Array.isArray(real[key]) ? (real[key] as string[]) : [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    setField(key, next.length ? next : undefined);
  };

  const openJson = () => {
    setJsonDraft(JSON.stringify(real, null, 2));
    setJsonError(null);
    setJsonOpen(true);
  };
  const applyJson = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(jsonDraft || '{}'); }
    catch (e) { setJsonError(`Invalid JSON: ${(e as Error).message}`); return; }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setJsonError('Must be a JSON object of conditions.'); return;
    }
    const candidate = { ...(parsed as AudienceConditions), __mode: 'conditions' as const };
    const v = validateAudienceConditions(candidate);
    if (!v.valid) { setJsonError(v.errors.join(' ')); return; }
    setJsonError(null);
    onChange(candidate);
    setJsonOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4" />
        <Label className="text-sm font-medium">Audience</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Explicitly choose who is eligible. Campaigns never default to all prospects.
      </p>

      <div className="flex gap-2">
        <Button type="button" size="sm" variant={mode === 'all' ? 'default' : 'outline'} onClick={() => setMode('all')}>
          All eligible prospects
        </Button>
        <Button type="button" size="sm" variant={mode === 'conditions' ? 'default' : 'outline'} onClick={() => setMode('conditions')}>
          Defined conditions
        </Button>
      </div>

      {mode === 'conditions' && (
        <div className="space-y-3 rounded-md border p-3">
          {AUDIENCE_FIELDS.map((f) => {
            const cur = real[f.key];
            const isSet = cur !== undefined;
            return (
              <div key={f.key} className="grid grid-cols-[160px_1fr_auto] items-start gap-2">
                <Label className="text-xs pt-2">{f.label}</Label>
                <div className="space-y-1">
                  {f.kind === 'enum' && (
                    <Select value={typeof cur === 'string' ? cur : ''} onValueChange={(v) => setField(f.key, v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        {f.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {f.kind === 'boolean' && (
                    <div className="flex items-center gap-2 h-8">
                      <Switch checked={cur === true} onCheckedChange={(v) => setField(f.key, isSet && cur === v ? undefined : v)} />
                      <span className="text-xs text-muted-foreground">{cur === true ? 'True' : cur === false ? 'False' : 'Any'}</span>
                    </div>
                  )}
                  {f.kind === 'multi' && (
                    <div className="flex flex-wrap gap-1">
                      {f.options?.map((o) => {
                        const on = Array.isArray(cur) && (cur as string[]).includes(o.value);
                        return (
                          <Badge key={o.value} variant={on ? 'default' : 'outline'} className="cursor-pointer" onClick={() => toggleMulti(f.key, o.value)}>
                            {o.label}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                  {f.kind === 'tags' && (
                    <Input
                      className="h-8 text-sm"
                      placeholder="comma,separated"
                      defaultValue={Array.isArray(cur) ? (cur as string[]).join(', ') : ''}
                      onBlur={(e) => {
                        const arr = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                        setField(f.key, arr.length ? arr : undefined);
                      }}
                    />
                  )}
                  {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
                </div>
                {isSet && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setField(f.key, undefined)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Plain-language summary */}
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <span className="font-medium">Who this targets: </span>{summary}
      </div>

      {!validation.valid && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
          <div className="flex items-center gap-1 font-medium"><AlertTriangle className="w-3.5 h-3.5" /> Invalid or contradictory conditions</div>
          {validation.errors.map((e, i) => <p key={i}>• {e}</p>)}
        </div>
      )}

      {/* Advanced JSON (admin only) */}
      <Collapsible open={jsonOpen} onOpenChange={(o) => (o ? openJson() : setJsonOpen(false))}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="text-xs"><Code className="w-3.5 h-3.5 mr-1" /> Advanced JSON view</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <Textarea value={jsonDraft} onChange={(e) => setJsonDraft(e.target.value)} rows={8} className="font-mono text-xs" />
          {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
          <Button type="button" size="sm" onClick={applyJson}>Validate &amp; apply</Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
