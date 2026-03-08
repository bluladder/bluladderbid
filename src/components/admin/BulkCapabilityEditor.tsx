import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Users, Zap, Save, PlusCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

const SERVICE_TYPES = [
  { value: 'windows_exterior', label: 'Windows (Exterior)' },
  { value: 'windows_interior', label: 'Windows (Interior)' },
  { value: 'gutters', label: 'Gutter Cleaning' },
  { value: 'house_wash', label: 'House Wash' },
  { value: 'roof_wash', label: 'Roof Wash' },
  { value: 'driveway', label: 'Driveway/Pressure Wash' },
  { value: 'pressure_wash_addon', label: 'PW Add-ons' },
];

const EQUIPMENT_FLAGS = [
  { key: 'has_pressure_washer', label: 'Has Pressure Washer' },
  { key: 'has_ladder_2_story', label: 'Has 2-Story Ladder' },
  { key: 'is_roof_safe', label: 'Roof-Safe Certified' },
];

const BEHAVIOR_FLAGS = [
  { key: 'requires_bundle_for_windows', label: 'Requires Bundle for Windows' },
  { key: 'eligible_for_big_job_pairing', label: 'Eligible for Big Job Pairing' },
];

interface Technician {
  id: string;
  name: string;
  is_active: boolean;
  service_capabilities: Record<string, any> | null;
}

interface BulkCapabilityEditorProps {
  technicians: Technician[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

type BulkAction = 'set_skill' | 'set_flags' | 'add_excluded' | 'remove_excluded' | 'add_tag' | 'remove_tag' | 'set_preferred' | 'set_discouraged';

export function BulkCapabilityEditor({ technicians, open, onOpenChange, onSaved }: BulkCapabilityEditorProps) {
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>('set_flags');
  const [isSaving, setIsSaving] = useState(false);

  // Bulk edit values
  const [skillService, setSkillService] = useState('');
  const [skillLevel, setSkillLevel] = useState(3);
  const [flagsToSet, setFlagsToSet] = useState<Record<string, boolean>>({});
  const [servicesToModify, setServicesToModify] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const activeTechs = technicians.filter(t => t.is_active);

  const toggleTech = (id: string) => {
    setSelectedTechIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedTechIds.size === activeTechs.length) {
      setSelectedTechIds(new Set());
    } else {
      setSelectedTechIds(new Set(activeTechs.map(t => t.id)));
    }
  };

  const toggleServiceModify = (svc: string) => {
    setServicesToModify(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  };

  const handleApply = async () => {
    if (selectedTechIds.size === 0) {
      toast.error('Select at least one technician');
      return;
    }

    setIsSaving(true);
    let successCount = 0;

    try {
      for (const techId of selectedTechIds) {
        const tech = technicians.find(t => t.id === techId);
        if (!tech) continue;

        const caps = { ...(tech.service_capabilities || {}) };

        switch (action) {
          case 'set_skill': {
            if (!skillService) { toast.error('Select a service type'); setIsSaving(false); return; }
            const levels = { ...(caps.skill_levels || {}) };
            levels[skillService] = skillLevel;
            caps.skill_levels = levels;
            break;
          }
          case 'set_flags': {
            for (const [key, val] of Object.entries(flagsToSet)) {
              caps[key] = val;
            }
            break;
          }
          case 'add_excluded': {
            const existing = (caps.excluded_service_types || []) as string[];
            caps.excluded_service_types = [...new Set([...existing, ...servicesToModify])];
            break;
          }
          case 'remove_excluded': {
            const existing = (caps.excluded_service_types || []) as string[];
            caps.excluded_service_types = existing.filter((s: string) => !servicesToModify.includes(s));
            break;
          }
          case 'add_tag': {
            if (!tagInput.trim()) { toast.error('Enter a tag name'); setIsSaving(false); return; }
            const tags = (caps.custom_tags || []) as string[];
            if (!tags.includes(tagInput.trim())) {
              caps.custom_tags = [...tags, tagInput.trim()];
            }
            break;
          }
          case 'remove_tag': {
            if (!tagInput.trim()) { toast.error('Enter a tag name'); setIsSaving(false); return; }
            caps.custom_tags = ((caps.custom_tags || []) as string[]).filter((t: string) => t !== tagInput.trim());
            break;
          }
          case 'set_preferred': {
            const existing = (caps.preferred_services || []) as string[];
            caps.preferred_services = [...new Set([...existing, ...servicesToModify])];
            // Remove from discouraged
            caps.discouraged_services = ((caps.discouraged_services || []) as string[]).filter((s: string) => !servicesToModify.includes(s));
            break;
          }
          case 'set_discouraged': {
            const existing = (caps.discouraged_services || []) as string[];
            caps.discouraged_services = [...new Set([...existing, ...servicesToModify])];
            // Remove from preferred
            caps.preferred_services = ((caps.preferred_services || []) as string[]).filter((s: string) => !servicesToModify.includes(s));
            break;
          }
        }

        const { error } = await supabase
          .from('technicians')
          .update({ service_capabilities: JSON.parse(JSON.stringify(caps)) })
          .eq('id', techId);

        if (error) {
          console.error(`Failed to update ${tech.name}:`, error);
        } else {
          successCount++;
        }
      }

      toast.success(`Updated ${successCount} technician(s)`);
      onSaved();
      onOpenChange(false);
      // Reset
      setSelectedTechIds(new Set());
      setFlagsToSet({});
      setServicesToModify([]);
      setTagInput('');
    } catch (error) {
      console.error('Bulk update failed:', error);
      toast.error('Bulk update failed');
    } finally {
      setIsSaving(false);
    }
  };

  const actionLabel: Record<BulkAction, string> = {
    set_skill: 'Set Skill Level',
    set_flags: 'Set Equipment / Behavior Flags',
    add_excluded: 'Add Excluded Service Types',
    remove_excluded: 'Remove Excluded Service Types',
    add_tag: 'Add Custom Tag',
    remove_tag: 'Remove Custom Tag',
    set_preferred: 'Add Preferred Services',
    set_discouraged: 'Add Discouraged Services',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Bulk Edit Capabilities
          </DialogTitle>
          <DialogDescription>
            Apply the same settings to multiple technicians at once.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select technicians */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">1. Select Technicians</Label>
            <Button variant="ghost" size="sm" onClick={selectAll}>
              {selectedTechIds.size === activeTechs.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
            {activeTechs.map(tech => (
              <label key={tech.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1">
                <Checkbox
                  checked={selectedTechIds.has(tech.id)}
                  onCheckedChange={() => toggleTech(tech.id)}
                />
                {tech.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedTechIds.size} of {activeTechs.length} selected
          </p>
        </div>

        <Separator />

        {/* Step 2: Choose action */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">2. Choose Action</Label>
          <Select value={action} onValueChange={(v) => { setAction(v as BulkAction); setFlagsToSet({}); setServicesToModify([]); setTagInput(''); }}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(actionLabel).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Step 3: Configure values */}
        <div>
          <Label className="text-sm font-semibold mb-2 block">3. Configure Values</Label>

          {action === 'set_skill' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Service Type</Label>
                <Select value={skillService} onValueChange={setSkillService}>
                  <SelectTrigger><SelectValue placeholder="Select service..." /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Skill Level (1-5)</Label>
                <div className="flex gap-2 mt-1">
                  {[1, 2, 3, 4, 5].map(level => (
                    <Button
                      key={level}
                      size="sm"
                      variant={skillLevel === level ? 'default' : 'outline'}
                      onClick={() => setSkillLevel(level)}
                      className="w-10"
                    >
                      {level}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">1=Novice, 3=Competent, 5=Expert</p>
              </div>
            </div>
          )}

          {action === 'set_flags' && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs mb-1 block">Equipment</Label>
                <div className="space-y-2">
                  {EQUIPMENT_FLAGS.map(flag => (
                    <label key={flag.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={flagsToSet[flag.key] === true}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setFlagsToSet(p => ({ ...p, [flag.key]: true }));
                          } else {
                            const next = { ...flagsToSet };
                            delete next[flag.key];
                            setFlagsToSet(next);
                          }
                        }}
                      />
                      {flag.label}
                      {flagsToSet[flag.key] !== undefined && (
                        <Badge variant="secondary" className="text-xs">will set → {String(flagsToSet[flag.key])}</Badge>
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Behavior</Label>
                <div className="space-y-2">
                  {BEHAVIOR_FLAGS.map(flag => (
                    <label key={flag.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={flagsToSet[flag.key] === true}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setFlagsToSet(p => ({ ...p, [flag.key]: true }));
                          } else {
                            const next = { ...flagsToSet };
                            delete next[flag.key];
                            setFlagsToSet(next);
                          }
                        }}
                      />
                      {flag.label}
                    </label>
                  ))}
                </div>
              </div>
              {Object.keys(flagsToSet).length === 0 && (
                <p className="text-xs text-muted-foreground">Check flags to set them to <strong>true</strong> on all selected techs.</p>
              )}
            </div>
          )}

          {(action === 'add_excluded' || action === 'remove_excluded' || action === 'set_preferred' || action === 'set_discouraged') && (
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map(svc => {
                const selected = servicesToModify.includes(svc.value);
                return (
                  <Badge
                    key={svc.value}
                    variant={selected ? (action.includes('excluded') ? 'destructive' : 'default') : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleServiceModify(svc.value)}
                  >
                    {selected && (action.includes('add') || action === 'set_preferred' || action === 'set_discouraged') ? '✓ ' : ''}
                    {svc.label}
                  </Badge>
                );
              })}
              {servicesToModify.length === 0 && (
                <p className="text-xs text-muted-foreground w-full">Click service types to select them.</p>
              )}
            </div>
          )}

          {(action === 'add_tag' || action === 'remove_tag') && (
            <div>
              <Label className="text-xs">Tag Name</Label>
              <Input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                placeholder="e.g., No Pressure Washing, VIP Only"
                className="mt-1"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleApply} disabled={isSaving || selectedTechIds.size === 0}>
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Applying...' : `Apply to ${selectedTechIds.size} Tech(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}