import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, Shield, ArrowUpDown, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface EligibilityRule {
  id: string;
  rule_name: string;
  priority: number;
  rule_type: 'hard_exclude' | 'preference';
  conditions: {
    services_include?: string[];
    services_exclude?: string[];
    require_capability?: string;
    exclude_capability?: string;
    min_price?: number;
    require_crew_size?: number;
  };
  allowed_tech_ids: string[] | null;
  excluded_tech_ids: string[] | null;
  default_tech_id: string | null;
  description: string | null;
  is_active: boolean;
}

interface Technician {
  id: string;
  name: string;
  is_active: boolean;
}

const SERVICE_OPTIONS = [
  { value: 'windows_exterior', label: 'Windows (Exterior)' },
  { value: 'windows_interior', label: 'Windows (Interior)' },
  { value: 'gutters', label: 'Gutter Cleaning' },
  { value: 'house_wash', label: 'House Wash' },
  { value: 'roof_wash', label: 'Roof Wash' },
  { value: 'driveway', label: 'Driveway' },
  { value: 'pressure_wash_addon', label: 'Pressure Wash Addon' },
];

const CAPABILITY_OPTIONS = [
  { value: 'can_do_windows', label: 'Can Do Windows' },
  { value: 'can_do_gutters', label: 'Can Do Gutters' },
  { value: 'can_do_pressure', label: 'Can Do Pressure Washing' },
  { value: 'has_pressure_washer', label: 'Has Pressure Washer Equipment' },
  { value: 'requires_bundle_for_windows', label: 'Requires Bundle for Windows' },
  { value: 'eligible_for_big_job_pairing', label: 'Eligible for Big Job Pairing' },
];

export function EligibilityRulesManager() {
  const [rules, setRules] = useState<EligibilityRule[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EligibilityRule | null>(null);
  
  const [formData, setFormData] = useState({
    rule_name: '',
    priority: 100,
    rule_type: 'preference' as 'hard_exclude' | 'preference',
    description: '',
    is_active: true,
    services_include: [] as string[],
    services_exclude: [] as string[],
    require_capability: '',
    exclude_capability: '',
    min_price: null as number | null,
    require_crew_size: null as number | null,
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [rulesRes, techsRes] = await Promise.all([
        supabase.from('eligibility_rules').select('*').order('priority'),
        supabase.from('technicians').select('id, name, is_active').eq('is_active', true),
      ]);

      if (rulesRes.error) throw rulesRes.error;
      if (techsRes.error) throw techsRes.error;

      setRules(rulesRes.data?.map(r => ({
        ...r,
        rule_type: r.rule_type as 'hard_exclude' | 'preference',
        conditions: r.conditions as EligibilityRule['conditions'],
      })) || []);
      setTechnicians(techsRes.data || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load eligibility rules');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetForm = () => {
    setFormData({
      rule_name: '',
      priority: 100,
      rule_type: 'preference',
      description: '',
      is_active: true,
      services_include: [],
      services_exclude: [],
      require_capability: '',
      exclude_capability: '',
      min_price: null,
      require_crew_size: null,
    });
    setEditingRule(null);
  };

  const openEditDialog = (rule: EligibilityRule) => {
    setEditingRule(rule);
    setFormData({
      rule_name: rule.rule_name,
      priority: rule.priority,
      rule_type: rule.rule_type,
      description: rule.description || '',
      is_active: rule.is_active,
      services_include: rule.conditions.services_include || [],
      services_exclude: rule.conditions.services_exclude || [],
      require_capability: rule.conditions.require_capability || '',
      exclude_capability: rule.conditions.exclude_capability || '',
      min_price: rule.conditions.min_price ?? null,
      require_crew_size: rule.conditions.require_crew_size ?? null,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.rule_name) {
      toast.error('Rule name is required');
      return;
    }

    const conditions: EligibilityRule['conditions'] = {};
    if (formData.services_include.length > 0) conditions.services_include = formData.services_include;
    if (formData.services_exclude.length > 0) conditions.services_exclude = formData.services_exclude;
    if (formData.require_capability) conditions.require_capability = formData.require_capability;
    if (formData.exclude_capability) conditions.exclude_capability = formData.exclude_capability;
    if (formData.min_price !== null) conditions.min_price = formData.min_price;
    if (formData.require_crew_size !== null) conditions.require_crew_size = formData.require_crew_size;

    try {
      if (editingRule) {
        const { error } = await supabase
          .from('eligibility_rules')
          .update({
            rule_name: formData.rule_name,
            priority: formData.priority,
            rule_type: formData.rule_type,
            conditions,
            description: formData.description || null,
            is_active: formData.is_active,
          })
          .eq('id', editingRule.id);

        if (error) throw error;
        toast.success('Rule updated');
      } else {
        const { error } = await supabase
          .from('eligibility_rules')
          .insert({
            rule_name: formData.rule_name,
            priority: formData.priority,
            rule_type: formData.rule_type,
            conditions,
            description: formData.description || null,
            is_active: formData.is_active,
          });

        if (error) throw error;
        toast.success('Rule created');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Failed to save rule:', error);
      toast.error('Failed to save rule');
    }
  };

  const handleDelete = async (rule: EligibilityRule) => {
    if (!confirm(`Delete rule "${rule.rule_name}"?`)) return;

    try {
      const { error } = await supabase
        .from('eligibility_rules')
        .delete()
        .eq('id', rule.id);

      if (error) throw error;
      toast.success('Rule deleted');
      fetchData();
    } catch (error) {
      console.error('Failed to delete rule:', error);
      toast.error('Failed to delete rule');
    }
  };

  const handleToggleActive = async (rule: EligibilityRule) => {
    try {
      const { error } = await supabase
        .from('eligibility_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id);

      if (error) throw error;
      toast.success(`Rule ${rule.is_active ? 'disabled' : 'enabled'}`);
      fetchData();
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      toast.error('Failed to toggle rule');
    }
  };

  const toggleServiceInclude = (service: string) => {
    const current = [...formData.services_include];
    const idx = current.indexOf(service);
    if (idx > -1) {
      current.splice(idx, 1);
    } else {
      current.push(service);
    }
    setFormData({ ...formData, services_include: current });
  };

  const toggleServiceExclude = (service: string) => {
    const current = [...formData.services_exclude];
    const idx = current.indexOf(service);
    if (idx > -1) {
      current.splice(idx, 1);
    } else {
      current.push(service);
    }
    setFormData({ ...formData, services_exclude: current });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Eligibility Rules
            </CardTitle>
            <CardDescription>
              Define which technicians can be assigned based on service types and capabilities
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Eligibility Rule'}</DialogTitle>
                <DialogDescription>
                  Rules are evaluated by priority (lower = higher priority). Hard exclusions override preferences.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rule_name">Rule Name *</Label>
                    <Input
                      id="rule_name"
                      value={formData.rule_name}
                      onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                      placeholder="Windows-only booking rule"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority (lower = first)</Label>
                    <Input
                      id="priority"
                      type="number"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 100 })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Rule Type</Label>
                    <Select
                      value={formData.rule_type}
                      onValueChange={(v) => setFormData({ ...formData, rule_type: v as 'hard_exclude' | 'preference' })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hard_exclude">Hard Exclude</SelectItem>
                        <SelectItem value="preference">Preference</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Switch
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                    <Label>Active</Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe what this rule does..."
                    rows={2}
                  />
                </div>

                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                  <h4 className="font-medium text-sm">Conditions</h4>
                  
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Applies when booking includes ANY of these services:
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {SERVICE_OPTIONS.map(svc => (
                        <Badge
                          key={svc.value}
                          variant={formData.services_include.includes(svc.value) ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => toggleServiceInclude(svc.value)}
                        >
                          {svc.label}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Applies ONLY if booking excludes ALL of these services:
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {SERVICE_OPTIONS.map(svc => (
                        <Badge
                          key={svc.value}
                          variant={formData.services_exclude.includes(svc.value) ? 'destructive' : 'outline'}
                          className="cursor-pointer"
                          onClick={() => toggleServiceExclude(svc.value)}
                        >
                          {svc.label}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Require technician capability:
                      </Label>
                      <Select
                        value={formData.require_capability}
                        onValueChange={(v) => setFormData({ ...formData, require_capability: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {CAPABILITY_OPTIONS.map(cap => (
                            <SelectItem key={cap.value} value={cap.value}>{cap.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Exclude technicians with capability:
                      </Label>
                      <Select
                        value={formData.exclude_capability}
                        onValueChange={(v) => setFormData({ ...formData, exclude_capability: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {CAPABILITY_OPTIONS.map(cap => (
                            <SelectItem key={cap.value} value={cap.value}>{cap.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Minimum job price ($):
                      </Label>
                      <Input
                        type="number"
                        value={formData.min_price ?? ''}
                        onChange={(e) => setFormData({ ...formData, min_price: e.target.value ? parseInt(e.target.value) : null })}
                        placeholder="e.g., 900"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Require crew size:
                      </Label>
                      <Input
                        type="number"
                        value={formData.require_crew_size ?? ''}
                        onChange={(e) => setFormData({ ...formData, require_crew_size: e.target.value ? parseInt(e.target.value) : null })}
                        placeholder="e.g., 2"
                        min={1}
                        max={3}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSubmit}>
                  {editingRule ? 'Update Rule' : 'Create Rule'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No eligibility rules configured. Add a rule to control technician assignment.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <ArrowUpDown className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Priority (lower = first)</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableHead>
                <TableHead>Rule Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map(rule => (
                <TableRow key={rule.id} className={!rule.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-mono text-sm">{rule.priority}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{rule.rule_name}</p>
                      {rule.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {rule.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.rule_type === 'hard_exclude' ? 'destructive' : 'secondary'}>
                      {rule.rule_type === 'hard_exclude' ? 'Hard Exclude' : 'Preference'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rule.conditions.services_include?.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          +{rule.conditions.services_include.length} services
                        </Badge>
                      )}
                      {rule.conditions.require_capability && (
                        <Badge variant="outline" className="text-xs text-green-600">
                          req: {rule.conditions.require_capability}
                        </Badge>
                      )}
                      {rule.conditions.exclude_capability && (
                        <Badge variant="outline" className="text-xs text-red-600">
                          exc: {rule.conditions.exclude_capability}
                        </Badge>
                      )}
                      {rule.conditions.min_price && (
                        <Badge variant="outline" className="text-xs">
                          ≥${rule.conditions.min_price}
                        </Badge>
                      )}
                      {rule.conditions.require_crew_size && (
                        <Badge variant="outline" className="text-xs">
                          crew:{rule.conditions.require_crew_size}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={() => handleToggleActive(rule)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(rule)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(rule)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
