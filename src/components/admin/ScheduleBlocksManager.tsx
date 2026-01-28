import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calendar, Plus, Trash2, Loader2, CalendarOff, Palmtree, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

type BlockCategory = 'vacation' | 'pto' | 'sick' | 'training' | 'blackout' | 'manual' | 'appointment';

interface ScheduleBlock {
  id: string;
  technician_id: string;
  technician_name?: string;
  start_at: string;
  end_at: string;
  block_type: string;
  block_category: BlockCategory;
  is_all_day: boolean;
  reason: string | null;
  notes: string | null;
  created_at: string;
}

interface Technician {
  id: string;
  name: string;
  is_active: boolean;
}

const BLOCK_CATEGORIES: { value: BlockCategory; label: string; icon: typeof Calendar; color: string; description: string }[] = [
  { value: 'vacation', label: 'Vacation', icon: Palmtree, color: 'bg-amber-100 text-amber-800', description: 'Planned vacation time' },
  { value: 'pto', label: 'PTO', icon: Calendar, color: 'bg-blue-100 text-blue-800', description: 'Paid time off' },
  { value: 'sick', label: 'Sick', icon: AlertCircle, color: 'bg-orange-100 text-orange-800', description: 'Sick leave' },
  { value: 'training', label: 'Training', icon: Clock, color: 'bg-purple-100 text-purple-800', description: 'Training or meetings' },
  { value: 'blackout', label: 'Blackout', icon: CalendarOff, color: 'bg-red-100 text-red-800', description: 'No booking allowed (hard block)' },
  { value: 'manual', label: 'Manual Block', icon: Clock, color: 'bg-gray-100 text-gray-800', description: 'Custom time block' },
];

export function ScheduleBlocksManager() {
  const { canManageScheduleBlocks, isReadOnly } = useAdminPermissions();
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    technician_id: '',
    start_date: '',
    start_time: '09:00',
    end_date: '',
    end_time: '17:00',
    block_category: 'vacation' as BlockCategory,
    is_all_day: true,
    reason: '',
    notes: '',
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [blocksRes, techsRes] = await Promise.all([
        supabase
          .from('schedule_blocks')
          .select('*')
          .order('start_at', { ascending: false }),
        supabase
          .from('technicians')
          .select('id, name, is_active')
          .eq('is_active', true)
          .order('name'),
      ]);

      if (blocksRes.error) throw blocksRes.error;
      if (techsRes.error) throw techsRes.error;

      // Map technician names to blocks
      const techMap = new Map((techsRes.data || []).map(t => [t.id, t.name]));
      const blocksWithNames = (blocksRes.data || []).map(b => ({
        ...b,
        technician_name: techMap.get(b.technician_id) || 'Unknown',
        block_category: (b.block_category || 'manual') as BlockCategory,
        is_all_day: b.is_all_day ?? false,
      }));

      setBlocks(blocksWithNames);
      setTechnicians(techsRes.data || []);
    } catch (error) {
      console.error('Failed to fetch schedule blocks:', error);
      toast.error('Failed to load schedule blocks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async () => {
    if (!formData.technician_id || !formData.start_date || !formData.end_date) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    try {
      let startAt: string;
      let endAt: string;

      if (formData.is_all_day) {
        startAt = `${formData.start_date}T00:00:00`;
        endAt = `${formData.end_date}T23:59:59`;
      } else {
        startAt = `${formData.start_date}T${formData.start_time}:00`;
        endAt = `${formData.end_date}T${formData.end_time}:00`;
      }

      const { error } = await supabase.from('schedule_blocks').insert({
        technician_id: formData.technician_id,
        start_at: startAt,
        end_at: endAt,
        block_type: formData.block_category,
        block_category: formData.block_category,
        is_all_day: formData.is_all_day,
        reason: formData.reason || null,
        notes: formData.notes || null,
      });

      if (error) throw error;

      toast.success('Schedule block created');
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Failed to create schedule block:', error);
      toast.error('Failed to create schedule block');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (block: ScheduleBlock) => {
    if (!confirm(`Delete this ${block.block_category} block for ${block.technician_name}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('schedule_blocks')
        .delete()
        .eq('id', block.id);

      if (error) throw error;
      toast.success('Schedule block deleted');
      fetchData();
    } catch (error) {
      console.error('Failed to delete schedule block:', error);
      toast.error('Failed to delete schedule block');
    }
  };

  const resetForm = () => {
    setFormData({
      technician_id: '',
      start_date: '',
      start_time: '09:00',
      end_date: '',
      end_time: '17:00',
      block_category: 'vacation',
      is_all_day: true,
      reason: '',
      notes: '',
    });
  };

  const getCategoryBadge = (category: BlockCategory) => {
    const cat = BLOCK_CATEGORIES.find(c => c.value === category) || BLOCK_CATEGORIES[3];
    const Icon = cat.icon;
    return (
      <Badge className={`${cat.color} font-normal`}>
        <Icon className="w-3 h-3 mr-1" />
        {cat.label}
      </Badge>
    );
  };

  const formatDateRange = (start: string, end: string, isAllDay: boolean) => {
    const startDate = parseISO(start);
    const endDate = parseISO(end);
    
    if (isAllDay) {
      if (format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd')) {
        return format(startDate, 'MMM d, yyyy');
      }
      return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
    }
    
    return `${format(startDate, 'MMM d, h:mm a')} - ${format(endDate, 'MMM d, h:mm a')}`;
  };

  const isActive = (block: ScheduleBlock) => {
    const now = new Date();
    return isAfter(parseISO(block.end_at), now) && isBefore(parseISO(block.start_at), now);
  };

  const isFuture = (block: ScheduleBlock) => {
    return isAfter(parseISO(block.start_at), new Date());
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="w-5 h-5" />
              Schedule Blocks
            </CardTitle>
            <CardDescription>
              Manage vacation, PTO, and blackout dates for technicians
            </CardDescription>
          </div>
          {canManageScheduleBlocks && !isReadOnly && (
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Block
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Schedule Block</DialogTitle>
                  <DialogDescription>
                    Block time off for a technician. This will prevent bookings during this period.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Technician *</Label>
                    <Select
                      value={formData.technician_id}
                      onValueChange={(v) => setFormData({ ...formData, technician_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select technician" />
                      </SelectTrigger>
                      <SelectContent>
                        {technicians.map(tech => (
                          <SelectItem key={tech.id} value={tech.id}>
                            {tech.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Block Type</Label>
                    <Select
                      value={formData.block_category}
                      onValueChange={(v) => setFormData({ ...formData, block_category: v as BlockCategory })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BLOCK_CATEGORIES.map(cat => (
                          <SelectItem key={cat.value} value={cat.value}>
                            <div className="flex items-center gap-2">
                              <cat.icon className="w-4 h-4" />
                              <div>
                                <span>{cat.label}</span>
                                <span className="text-xs text-muted-foreground ml-2">- {cat.description}</span>
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="all-day">All Day</Label>
                    <Switch
                      id="all-day"
                      checked={formData.is_all_day}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_all_day: checked })}
                    />
                  </div>

                  <div className="grid gap-4 grid-cols-2">
                    <div className="space-y-2">
                      <Label>Start Date *</Label>
                      <Input
                        type="date"
                        value={formData.start_date}
                        onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                      />
                    </div>
                    {!formData.is_all_day && (
                      <div className="space-y-2">
                        <Label>Start Time</Label>
                        <Input
                          type="time"
                          value={formData.start_time}
                          onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 grid-cols-2">
                    <div className="space-y-2">
                      <Label>End Date *</Label>
                      <Input
                        type="date"
                        value={formData.end_date}
                        onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      />
                    </div>
                    {!formData.is_all_day && (
                      <div className="space-y-2">
                        <Label>End Time</Label>
                        <Input
                          type="time"
                          value={formData.end_time}
                          onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Input
                      value={formData.reason}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      placeholder="e.g., Family vacation"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Notes (Internal)</Label>
                    <Textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Additional notes..."
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={isSaving}>
                    {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Create Block
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isReadOnly && (
          <Alert className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              You have read-only access. Contact an administrator to make changes.
            </AlertDescription>
          </Alert>
        )}

        {blocks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CalendarOff className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No schedule blocks configured</p>
            <p className="text-sm">Add vacation, PTO, or blackout dates to prevent bookings</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Technician</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                {canManageScheduleBlocks && !isReadOnly && (
                  <TableHead className="w-[50px]"></TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.map((block) => (
                <TableRow key={block.id}>
                  <TableCell className="font-medium">{block.technician_name}</TableCell>
                  <TableCell>{getCategoryBadge(block.block_category)}</TableCell>
                  <TableCell className="text-sm">
                    {formatDateRange(block.start_at, block.end_at, block.is_all_day)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {block.reason || '—'}
                  </TableCell>
                  <TableCell>
                    {isActive(block) ? (
                      <Badge variant="default">Active</Badge>
                    ) : isFuture(block) ? (
                      <Badge variant="outline">Upcoming</Badge>
                    ) : (
                      <Badge variant="secondary">Past</Badge>
                    )}
                  </TableCell>
                  {canManageScheduleBlocks && !isReadOnly && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(block)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
