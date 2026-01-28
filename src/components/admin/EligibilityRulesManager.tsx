import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, Shield, Info, AlertTriangle, CheckCircle, Users, Wrench, DollarSign, FileText } from 'lucide-react';
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
  { value: 'windows_exterior', label: 'Windows (Exterior)', short: 'Ext. Windows' },
  { value: 'windows_interior', label: 'Windows (Interior)', short: 'Int. Windows' },
  { value: 'gutters', label: 'Gutter Cleaning', short: 'Gutters' },
  { value: 'house_wash', label: 'House Wash', short: 'House Wash' },
  { value: 'roof_wash', label: 'Roof Wash', short: 'Roof Wash' },
  { value: 'driveway', label: 'Driveway', short: 'Driveway' },
  { value: 'pressure_wash_addon', label: 'Pressure Wash Addon', short: 'PW Addon' },
];

const CAPABILITY_OPTIONS = [
  { value: 'can_do_windows', label: 'Can do window cleaning', description: 'Certified for window services' },
  { value: 'can_do_gutters', label: 'Can do gutter cleaning', description: 'Certified for gutter services' },
  { value: 'can_do_pressure', label: 'Can do pressure washing', description: 'Certified for pressure washing' },
  { value: 'has_pressure_washer', label: 'Has pressure washer equipment', description: 'Owns/has access to equipment' },
  { value: 'requires_bundle_for_windows', label: 'Requires bundled services for windows', description: 'Cannot do windows-only jobs' },
  { value: 'eligible_for_big_job_pairing', label: 'Eligible for big job pairing', description: 'Can be paired with another tech' },
];

// Generate a plain-English summary of what a rule does
function generateRuleSentence(rule: EligibilityRule): string {
  const parts: string[] = [];
  const { conditions, rule_type } = rule;
  
  // Build the "WHEN" clause
  const whenParts: string[] = [];
  
  if (conditions.services_include?.length) {
    const serviceNames = conditions.services_include.map(s => 
      SERVICE_OPTIONS.find(o => o.value === s)?.short || s
    );
    whenParts.push(`booking includes ${serviceNames.join(' or ')}`);
  }
  
  if (conditions.services_exclude?.length) {
    const serviceNames = conditions.services_exclude.map(s => 
      SERVICE_OPTIONS.find(o => o.value === s)?.short || s
    );
    whenParts.push(`booking does NOT include ${serviceNames.join(' or ')}`);
  }
  
  if (conditions.min_price) {
    whenParts.push(`job is $${conditions.min_price}+`);
  }
  
  // Build the "THEN" clause
  const thenParts: string[] = [];
  
  if (conditions.require_capability) {
    const cap = CAPABILITY_OPTIONS.find(c => c.value === conditions.require_capability);
    if (rule_type === 'hard_exclude') {
      thenParts.push(`only assign techs who "${cap?.label || conditions.require_capability}"`);
    } else {
      thenParts.push(`prefer techs who "${cap?.label || conditions.require_capability}"`);
    }
  }
  
  if (conditions.exclude_capability) {
    const cap = CAPABILITY_OPTIONS.find(c => c.value === conditions.exclude_capability);
    thenParts.push(`exclude techs who "${cap?.label || conditions.exclude_capability}"`);
  }
  
  if (conditions.require_crew_size) {
    thenParts.push(`require ${conditions.require_crew_size} technician${conditions.require_crew_size > 1 ? 's' : ''}`);
  }
  
  // Combine
  if (whenParts.length === 0 && thenParts.length === 0) {
    return 'No conditions set — this rule has no effect.';
  }
  
  const when = whenParts.length > 0 ? `When ${whenParts.join(' AND ')}` : 'For all bookings';
  const then = thenParts.length > 0 ? thenParts.join(', then ') : 'no action defined';
  
  return `${when} → ${then}.`;
}

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

  // Preview sentence based on current form state
  const previewRule: EligibilityRule = {
    id: 'preview',
    rule_name: formData.rule_name,
    priority: formData.priority,
    rule_type: formData.rule_type,
    conditions: {
      services_include: formData.services_include.length > 0 ? formData.services_include : undefined,
      services_exclude: formData.services_exclude.length > 0 ? formData.services_exclude : undefined,
      require_capability: formData.require_capability || undefined,
      exclude_capability: formData.exclude_capability || undefined,
      min_price: formData.min_price ?? undefined,
      require_crew_size: formData.require_crew_size ?? undefined,
    },
    allowed_tech_ids: null,
    excluded_tech_ids: null,
    default_tech_id: null,
    description: formData.description,
    is_active: formData.is_active,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Crew Assignment Rules
            </CardTitle>
            <CardDescription>
              Control which technicians are eligible for specific bookings based on services, capabilities, and job size.
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
                <DialogTitle>{editingRule ? 'Edit Rule' : 'Create Assignment Rule'}</DialogTitle>
                <DialogDescription>
                  Build a rule by selecting conditions (when it applies) and effects (what happens).
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6">
                {/* Live Preview */}
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="flex items-start gap-2 mb-2">
                    <FileText className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-primary">Rule Preview</p>
                      <p className="text-sm text-foreground mt-1">
                        {generateRuleSentence(previewRule)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Basic Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                    <Info className="w-4 h-4" />
                    Basic Info
                  </h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rule_name">
                        Rule Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="rule_name"
                        value={formData.rule_name}
                        onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
                        placeholder="e.g., Big Jobs Need Two Techs"
                      />
                      <p className="text-xs text-muted-foreground">
                        A short, descriptive name you'll recognize later.
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="priority" className="flex items-center gap-1">
                        Priority Order
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="w-3 h-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>Rules are checked in order from lowest to highest number. A rule with priority 10 runs before priority 100.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                      <Input
                        id="priority"
                        type="number"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 100 })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Default: 100. Lower numbers run first.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Rule Enforcement</Label>
                      <Select
                        value={formData.rule_type}
                        onValueChange={(v) => setFormData({ ...formData, rule_type: v as 'hard_exclude' | 'preference' })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hard_exclude">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-destructive" />
                              Strict (Hard Rule)
                            </div>
                          </SelectItem>
                          <SelectItem value="preference">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-4 h-4 text-primary" />
                              Preference (Soft Rule)
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {formData.rule_type === 'hard_exclude' 
                          ? 'Strict rules MUST be followed — no exceptions.'
                          : 'Preference rules guide assignment but can be overridden.'}
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <div className="flex items-center gap-3 h-10">
                        <Switch
                          checked={formData.is_active}
                          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                        />
                        <span className={formData.is_active ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
                          {formData.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Disabled rules are saved but not applied.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="e.g., Ensures pressure washing jobs go to techs with the right equipment"
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Add notes to help remember why this rule exists.
                    </p>
                  </div>
                </div>

                {/* Conditions Section */}
                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                    <Wrench className="w-4 h-4" />
                    Conditions — When Does This Rule Apply?
                  </h4>
                  
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        If booking includes ANY of these services:
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {SERVICE_OPTIONS.map(svc => (
                          <Badge
                            key={svc.value}
                            variant={formData.services_include.includes(svc.value) ? 'default' : 'outline'}
                            className="cursor-pointer transition-all hover:scale-105"
                            onClick={() => toggleServiceInclude(svc.value)}
                          >
                            {formData.services_include.includes(svc.value) && '✓ '}
                            {svc.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Example: Select "Gutter Cleaning" to make this rule apply to all gutter jobs.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        If booking does NOT include these services:
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {SERVICE_OPTIONS.map(svc => (
                          <Badge
                            key={svc.value}
                            variant={formData.services_exclude.includes(svc.value) ? 'destructive' : 'outline'}
                            className="cursor-pointer transition-all hover:scale-105"
                            onClick={() => toggleServiceExclude(svc.value)}
                          >
                            {formData.services_exclude.includes(svc.value) && '✗ '}
                            {svc.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Example: Exclude "Gutters" + "House Wash" to target windows-only bookings.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium flex items-center gap-2">
                        <DollarSign className="w-4 h-4" />
                        If job total is at least:
                      </Label>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">$</span>
                        <Input
                          type="number"
                          value={formData.min_price ?? ''}
                          onChange={(e) => setFormData({ ...formData, min_price: e.target.value ? parseInt(e.target.value) : null })}
                          placeholder="e.g., 900"
                          className="w-32"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Leave blank to ignore job price. Example: "900" for big job rules.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Effects Section */}
                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                    <Users className="w-4 h-4" />
                    Effects — What Happens When Conditions Match?
                  </h4>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Only assign techs who have:
                      </Label>
                      <Select
                        value={formData.require_capability || '__none__'}
                        onValueChange={(v) => setFormData({ ...formData, require_capability: v === '__none__' ? '' : v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="No requirement" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No requirement</SelectItem>
                          {CAPABILITY_OPTIONS.map(cap => (
                            <SelectItem key={cap.value} value={cap.value}>
                              <div>
                                <p>{cap.label}</p>
                                <p className="text-xs text-muted-foreground">{cap.description}</p>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Example: "Has pressure washer equipment" for pressure washing jobs.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Never assign techs who have:
                      </Label>
                      <Select
                        value={formData.exclude_capability || '__none__'}
                        onValueChange={(v) => setFormData({ ...formData, exclude_capability: v === '__none__' ? '' : v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="No exclusion" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No exclusion</SelectItem>
                          {CAPABILITY_OPTIONS.map(cap => (
                            <SelectItem key={cap.value} value={cap.value}>
                              <div>
                                <p>{cap.label}</p>
                                <p className="text-xs text-muted-foreground">{cap.description}</p>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Example: "Requires bundled services" for windows-only bookings.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Require crew size:
                    </Label>
                    <Select
                      value={formData.require_crew_size?.toString() || '__none__'}
                      onValueChange={(v) => setFormData({ ...formData, require_crew_size: v === '__none__' ? null : parseInt(v) })}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Default (1 tech)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Default (1 technician)</SelectItem>
                        <SelectItem value="2">2 technicians (pair)</SelectItem>
                        <SelectItem value="3">3 technicians (crew)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Default: 1 technician. Use "2 technicians" for big jobs that need a pair.
                    </p>
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-6">
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
        {/* Help Banner */}
        <div className="bg-muted/50 border rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">How Rules Work</p>
              <p>
                Rules are evaluated in priority order (lowest first). <strong>Strict rules</strong> must be followed — 
                if no technician matches, the booking cannot proceed. <strong>Preference rules</strong> guide assignment 
                but can be overridden if needed.
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <Shield className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground mb-4">
              No assignment rules configured yet.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Without rules, any available technician can be assigned to any job.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Rule
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule, index) => (
              <div
                key={rule.id}
                className={`border rounded-lg p-4 transition-all ${
                  !rule.is_active ? 'opacity-50 bg-muted/30' : 'bg-card hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                        #{rule.priority}
                      </span>
                      <Badge variant={rule.rule_type === 'hard_exclude' ? 'destructive' : 'secondary'}>
                        {rule.rule_type === 'hard_exclude' ? (
                          <><AlertTriangle className="w-3 h-3 mr-1" /> Strict</>
                        ) : (
                          <><CheckCircle className="w-3 h-3 mr-1" /> Preference</>
                        )}
                      </Badge>
                      {!rule.is_active && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Disabled
                        </Badge>
                      )}
                    </div>
                    
                    <h4 className="font-semibold text-foreground mb-1">
                      {rule.rule_name}
                    </h4>
                    
                    <p className="text-sm text-muted-foreground">
                      {generateRuleSentence(rule)}
                    </p>
                    
                    {rule.description && (
                      <p className="text-xs text-muted-foreground mt-2 italic">
                        Note: {rule.description}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <Switch
                              checked={rule.is_active}
                              onCheckedChange={() => handleToggleActive(rule)}
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {rule.is_active ? 'Click to disable' : 'Click to enable'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(rule)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(rule)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
