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
import { Plus, Pencil, Trash2, Users, Save, X, RefreshCw, MapPin } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface Technician {
  id: string;
  jobber_user_id: string;
  name: string;
  email: string | null;
  is_active: boolean;
  starting_address: string | null;
  location_type: 'office' | 'home';
}

const SERVICE_TYPES = [
  { value: 'windows_exterior', label: 'Windows (Exterior)' },
  { value: 'windows_interior', label: 'Windows (Interior)' },
  { value: 'gutters', label: 'Gutter Cleaning' },
  { value: 'house_wash', label: 'House Wash' },
  { value: 'roof_wash', label: 'Roof Wash' },
  { value: 'driveway', label: 'Driveway/Pressure Wash' },
  { value: 'pressure_wash_addon', label: 'PW Add-ons' },
];

interface ServiceRate {
  service_type: string;
  dollars_per_hour: number;
  buffer_minutes: number;
}

export function TechnicianManager() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRatesDialogOpen, setIsRatesDialogOpen] = useState(false);
  const [editingTech, setEditingTech] = useState<Technician | null>(null);
  const [selectedTechRates, setSelectedTechRates] = useState<ServiceRate[]>([]);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    jobber_user_id: '',
    email: '',
    is_active: true,
    starting_address: '',
    location_type: 'office' as 'office' | 'home',
  });

  const fetchTechnicians = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('technicians')
        .select('*')
        .order('name');

      if (error) throw error;
      setTechnicians((data || []).map(t => ({
        ...t,
        location_type: t.location_type as 'office' | 'home',
      })));
    } catch (error) {
      console.error('Failed to fetch technicians:', error);
      toast.error('Failed to load technicians');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTechnicians();
  }, []);

  const handleSyncFromJobber = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-sync-users');
      
      if (error) {
        throw new Error(error.message || 'Failed to sync');
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }
      
      if (data.newUsersSynced > 0) {
        toast.success(`Synced ${data.newUsersSynced} new technician(s) from Jobber`);
        fetchTechnicians();
      } else if (data.alreadyExisted > 0) {
        toast.info(`All ${data.alreadyExisted} Jobber user(s) already exist`);
      } else {
        toast.info('No users found in Jobber');
      }
    } catch (error) {
      console.error('Failed to sync from Jobber:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sync from Jobber');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.jobber_user_id) {
      toast.error('Name and Jobber User ID are required');
      return;
    }

    try {
      if (editingTech) {
        const { error } = await supabase
          .from('technicians')
          .update({
            name: formData.name,
            jobber_user_id: formData.jobber_user_id,
            email: formData.email || null,
            is_active: formData.is_active,
            starting_address: formData.starting_address || null,
            location_type: formData.location_type,
          })
          .eq('id', editingTech.id);

        if (error) throw error;
        toast.success('Technician updated');
      } else {
        const { error } = await supabase
          .from('technicians')
          .insert({
            name: formData.name,
            jobber_user_id: formData.jobber_user_id,
            email: formData.email || null,
            is_active: formData.is_active,
            starting_address: formData.starting_address || null,
            location_type: formData.location_type,
          });

        if (error) throw error;
        toast.success('Technician added');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchTechnicians();
    } catch (error: any) {
      console.error('Failed to save technician:', error);
      if (error.code === '23505') {
        toast.error('A technician with this Jobber User ID already exists');
      } else {
        toast.error('Failed to save technician');
      }
    }
  };

  const handleDelete = async (tech: Technician) => {
    if (!confirm(`Delete ${tech.name}? This will also remove their service rates.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('technicians')
        .delete()
        .eq('id', tech.id);

      if (error) throw error;
      toast.success('Technician deleted');
      fetchTechnicians();
    } catch (error) {
      console.error('Failed to delete technician:', error);
      toast.error('Failed to delete technician');
    }
  };

  const openRatesDialog = async (tech: Technician) => {
    setSelectedTechId(tech.id);
    
    try {
      const { data, error } = await supabase
        .from('technician_service_rates')
        .select('*')
        .eq('technician_id', tech.id);

      if (error) throw error;

      // Initialize rates for all service types
      const rates: ServiceRate[] = SERVICE_TYPES.map(st => {
        const existing = data?.find(r => r.service_type === st.value);
        return {
          service_type: st.value,
          dollars_per_hour: existing?.dollars_per_hour || 0,
          buffer_minutes: existing?.buffer_minutes || 0,
        };
      });

      setSelectedTechRates(rates);
      setIsRatesDialogOpen(true);
    } catch (error) {
      console.error('Failed to fetch rates:', error);
      toast.error('Failed to load service rates');
    }
  };

  const handleSaveRates = async () => {
    if (!selectedTechId) return;

    try {
      // Upsert all rates one by one using the correct types
      for (const rate of selectedTechRates) {
        // First try to update
        const { data: existing } = await supabase
          .from('technician_service_rates')
          .select('id')
          .eq('technician_id', selectedTechId)
          .eq('service_type', rate.service_type as any)
          .maybeSingle();

        if (existing) {
          // Update existing
          const { error } = await supabase
            .from('technician_service_rates')
            .update({
              dollars_per_hour: rate.dollars_per_hour,
              buffer_minutes: rate.buffer_minutes,
            })
            .eq('id', existing.id);

          if (error) throw error;
        } else {
          // Insert new
          const { error } = await supabase
            .from('technician_service_rates')
            .insert({
              technician_id: selectedTechId,
              service_type: rate.service_type as any,
              dollars_per_hour: rate.dollars_per_hour,
              buffer_minutes: rate.buffer_minutes,
            });

          if (error) throw error;
        }
      }

      toast.success('Service rates saved');
      setIsRatesDialogOpen(false);
    } catch (error) {
      console.error('Failed to save rates:', error);
      toast.error('Failed to save service rates');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      jobber_user_id: '',
      email: '',
      is_active: true,
      starting_address: '',
      location_type: 'office',
    });
    setEditingTech(null);
  };

  const openEditDialog = (tech: Technician) => {
    setEditingTech(tech);
    setFormData({
      name: tech.name,
      jobber_user_id: tech.jobber_user_id,
      email: tech.email || '',
      is_active: tech.is_active,
      starting_address: tech.starting_address || '',
      location_type: tech.location_type,
    });
    setIsDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Technicians & Service Rates
            </CardTitle>
            <CardDescription>
              Manage technicians and their per-service hourly rates for duration calculation
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSyncFromJobber} disabled={isSyncing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync from Jobber'}
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Technician
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingTech ? 'Edit Technician' : 'Add Technician'}</DialogTitle>
                <DialogDescription>
                  Enter the technician's details. The Jobber User ID can be found in Jobber's team settings.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="John Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jobber_user_id">Jobber User ID *</Label>
                  <Input
                    id="jobber_user_id"
                    value={formData.jobber_user_id}
                    onChange={(e) => setFormData({ ...formData, jobber_user_id: e.target.value })}
                    placeholder="e.g., Z2lkOi8vam9iYmVyL1VzZXIvMTIzNDU="
                  />
                  <p className="text-xs text-muted-foreground">
                    Find this in Jobber under Settings → Team → Click on user → copy the ID from URL
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location_type">Starting Location</Label>
                  <Select
                    value={formData.location_type}
                    onValueChange={(v) => setFormData({ ...formData, location_type: v as 'office' | 'home' })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="office">Starts from Office</SelectItem>
                      <SelectItem value="home">Starts from Home</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formData.location_type === 'home' && (
                  <div className="space-y-2">
                    <Label htmlFor="starting_address" className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Home Address
                    </Label>
                    <Input
                      id="starting_address"
                      value={formData.starting_address}
                      onChange={(e) => setFormData({ ...formData, starting_address: e.target.value })}
                      placeholder="123 Main St, City, State ZIP"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="is_active">Active</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit}>
                  {editingTech ? 'Update' : 'Add'} Technician
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading technicians...</p>
          </div>
        ) : technicians.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No technicians added yet.</p>
            <p className="text-sm">Add technicians to enable instant booking.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {technicians.map((tech) => (
                <TableRow key={tech.id}>
                  <TableCell className="font-medium">{tech.name}</TableCell>
                  <TableCell>{tech.email || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={tech.is_active ? 'default' : 'secondary'}>
                      {tech.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openRatesDialog(tech)}
                      >
                        $ Rates
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(tech)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(tech)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Service Rates Dialog */}
        <Dialog open={isRatesDialogOpen} onOpenChange={setIsRatesDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Service Rates</DialogTitle>
              <DialogDescription>
                Set hourly rates for each service. Rate = $0 means this technician cannot perform that service.
                Duration = (Price ÷ Rate) × 60 + Buffer minutes.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>$/Hour</TableHead>
                    <TableHead>Buffer (min)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTechRates.map((rate, index) => {
                    const serviceLabel = SERVICE_TYPES.find(s => s.value === rate.service_type)?.label || rate.service_type;
                    return (
                      <TableRow key={rate.service_type}>
                        <TableCell className="font-medium">{serviceLabel}</TableCell>
                        <TableCell>
                          <div className="relative w-24">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={rate.dollars_per_hour}
                              onChange={(e) => {
                                const newRates = [...selectedTechRates];
                                newRates[index].dollars_per_hour = parseFloat(e.target.value) || 0;
                                setSelectedTechRates(newRates);
                              }}
                              className="pl-7"
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="5"
                            value={rate.buffer_minutes}
                            onChange={(e) => {
                              const newRates = [...selectedTechRates];
                              newRates[index].buffer_minutes = parseInt(e.target.value) || 0;
                              setSelectedTechRates(newRates);
                            }}
                            className="w-20"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRatesDialogOpen(false)}>
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSaveRates}>
                <Save className="w-4 h-4 mr-2" />
                Save Rates
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
