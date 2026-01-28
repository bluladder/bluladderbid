import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Loader2,
  CalendarOff,
  Palmtree,
  Clock,
  User,
  MapPin,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  format, 
  parseISO, 
  addDays, 
  subDays, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval,
  isSameDay,
  getHours,
  differenceInMinutes,
  setHours,
  setMinutes
} from 'date-fns';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

interface Technician {
  id: string;
  name: string;
  jobber_user_id: string;
  is_active: boolean;
  schedule_start_hour: number;
  schedule_end_hour: number;
}

interface BusyBlock {
  id: string;
  crew_id: string;
  start_at: string;
  end_at: string;
  jobber_visit_id: string | null;
  jobber_job_id: string | null;
  client_name: string | null;
  client_address: string | null;
  status: string | null;
  source: string;
}

interface ScheduleBlock {
  id: string;
  technician_id: string;
  start_at: string;
  end_at: string;
  block_type: string;
  block_category: string;
  is_all_day: boolean;
  reason: string | null;
  notes: string | null;
}

type BlockCategory = 'vacation' | 'pto' | 'blackout' | 'manual';

const BLOCK_CATEGORIES: { value: BlockCategory; label: string; color: string }[] = [
  { value: 'vacation', label: 'Vacation', color: 'bg-amber-200' },
  { value: 'pto', label: 'PTO', color: 'bg-blue-200' },
  { value: 'blackout', label: 'Blackout', color: 'bg-red-200' },
  { value: 'manual', label: 'Manual Block', color: 'bg-gray-200' },
];

const HOURS = Array.from({ length: 12 }, (_, i) => i + 6); // 6 AM to 6 PM

export function AdminScheduleCalendar() {
  const { canManageScheduleBlocks } = useAdminPermissions();
  const [view, setView] = useState<'day' | 'week'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Add block dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedTech, setSelectedTech] = useState<string>('');
  const [blockForm, setBlockForm] = useState({
    start_date: format(new Date(), 'yyyy-MM-dd'),
    start_time: '09:00',
    end_date: format(new Date(), 'yyyy-MM-dd'),
    end_time: '17:00',
    is_all_day: true,
    block_category: 'vacation' as BlockCategory,
    reason: '',
    notes: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const dateRange = useMemo(() => {
    if (view === 'day') {
      return { start: currentDate, end: currentDate };
    }
    const start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday
    const end = endOfWeek(currentDate, { weekStartsOn: 1 }); // Sunday
    return { start, end };
  }, [view, currentDate]);

  const daysInView = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
  }, [dateRange]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const startStr = format(dateRange.start, 'yyyy-MM-dd');
      const endStr = format(addDays(dateRange.end, 1), 'yyyy-MM-dd');

      const [techsRes, busyRes, blocksRes] = await Promise.all([
        supabase
          .from('technicians')
          .select('id, name, jobber_user_id, is_active, schedule_start_hour, schedule_end_hour')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('jobber_busy_blocks')
          .select('*')
          .lt('start_at', endStr)
          .gt('end_at', startStr),
        supabase
          .from('schedule_blocks')
          .select('*')
          .lt('start_at', endStr)
          .gt('end_at', startStr),
      ]);

      if (techsRes.error) throw techsRes.error;
      if (busyRes.error) throw busyRes.error;
      if (blocksRes.error) throw blocksRes.error;

      setTechnicians(techsRes.data || []);
      setBusyBlocks(busyRes.data || []);
      setScheduleBlocks(blocksRes.data || []);
    } catch (error) {
      console.error('Failed to fetch schedule data:', error);
      toast.error('Failed to load schedule');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange.start.toISOString(), dateRange.end.toISOString()]);

  const handleAddBlock = async () => {
    if (!selectedTech) {
      toast.error('Please select a technician');
      return;
    }

    setIsSaving(true);
    try {
      let startAt: string;
      let endAt: string;

      if (blockForm.is_all_day) {
        startAt = `${blockForm.start_date}T00:00:00`;
        endAt = `${blockForm.end_date}T23:59:59`;
      } else {
        startAt = `${blockForm.start_date}T${blockForm.start_time}:00`;
        endAt = `${blockForm.end_date}T${blockForm.end_time}:00`;
      }

      const { error } = await supabase.from('schedule_blocks').insert({
        technician_id: selectedTech,
        start_at: startAt,
        end_at: endAt,
        block_type: blockForm.block_category,
        block_category: blockForm.block_category,
        is_all_day: blockForm.is_all_day,
        reason: blockForm.reason || null,
        notes: blockForm.notes || null,
      });

      if (error) throw error;

      toast.success('Block created - availability updated immediately');
      setShowAddDialog(false);
      resetBlockForm();
      fetchData();
    } catch (error) {
      console.error('Failed to create block:', error);
      toast.error('Failed to create block');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    if (!confirm('Delete this block? Availability will be restored immediately.')) return;

    try {
      const { error } = await supabase
        .from('schedule_blocks')
        .delete()
        .eq('id', blockId);

      if (error) throw error;
      toast.success('Block deleted');
      fetchData();
    } catch (error) {
      console.error('Failed to delete block:', error);
      toast.error('Failed to delete block');
    }
  };

  const resetBlockForm = () => {
    setBlockForm({
      start_date: format(currentDate, 'yyyy-MM-dd'),
      start_time: '09:00',
      end_date: format(currentDate, 'yyyy-MM-dd'),
      end_time: '17:00',
      is_all_day: true,
      block_category: 'vacation',
      reason: '',
      notes: '',
    });
    setSelectedTech('');
  };

  const getBlocksForTechAndDay = (techId: string, jobberUserId: string, day: Date) => {
    const dayStart = setMinutes(setHours(day, 0), 0);
    const dayEnd = setMinutes(setHours(day, 23), 59);

    // Get Jobber busy blocks (appointments)
    const appointments = busyBlocks.filter(block => {
      const blockStart = parseISO(block.start_at);
      const blockEnd = parseISO(block.end_at);
      return block.crew_id === jobberUserId && 
        blockStart < dayEnd && 
        blockEnd > dayStart;
    });

    // Get manual schedule blocks
    const manualBlocks = scheduleBlocks.filter(block => {
      const blockStart = parseISO(block.start_at);
      const blockEnd = parseISO(block.end_at);
      return block.technician_id === techId && 
        blockStart < dayEnd && 
        blockEnd > dayStart;
    });

    return { appointments, manualBlocks };
  };

  const getBlockPosition = (blockStart: Date, blockEnd: Date, day: Date) => {
    const dayStart = setMinutes(setHours(day, HOURS[0]), 0);
    const dayEnd = setMinutes(setHours(day, HOURS[HOURS.length - 1] + 1), 0);
    
    const clampedStart = blockStart < dayStart ? dayStart : blockStart;
    const clampedEnd = blockEnd > dayEnd ? dayEnd : blockEnd;
    
    const totalMinutes = (HOURS.length) * 60;
    const startMinutes = differenceInMinutes(clampedStart, dayStart);
    const duration = differenceInMinutes(clampedEnd, clampedStart);
    
    const top = (startMinutes / totalMinutes) * 100;
    const height = (duration / totalMinutes) * 100;
    
    return { top: `${Math.max(0, top)}%`, height: `${Math.min(100 - top, height)}%` };
  };

  const getCategoryColor = (category: string) => {
    return BLOCK_CATEGORIES.find(c => c.value === category)?.color || 'bg-gray-200';
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const days = view === 'day' ? 1 : 7;
    setCurrentDate(direction === 'prev' ? subDays(currentDate, days) : addDays(currentDate, days));
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
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Schedule Calendar
            </CardTitle>
            <CardDescription>
              View appointments and manage time blocks
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={view} onValueChange={(v) => setView(v as 'day' | 'week')}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
              </SelectContent>
            </Select>

            {canManageScheduleBlocks && (
              <Dialog open={showAddDialog} onOpenChange={(open) => {
                setShowAddDialog(open);
                if (!open) resetBlockForm();
              }}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Block
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Schedule Block</DialogTitle>
                    <DialogDescription>
                      Block time to prevent customer bookings
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Technician *</Label>
                      <Select value={selectedTech} onValueChange={setSelectedTech}>
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
                        value={blockForm.block_category}
                        onValueChange={(v) => setBlockForm({ ...blockForm, block_category: v as BlockCategory })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BLOCK_CATEGORIES.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between">
                      <Label>All Day</Label>
                      <Switch
                        checked={blockForm.is_all_day}
                        onCheckedChange={(checked) => setBlockForm({ ...blockForm, is_all_day: checked })}
                      />
                    </div>

                    <div className="grid gap-4 grid-cols-2">
                      <div className="space-y-2">
                        <Label>Start Date *</Label>
                        <Input
                          type="date"
                          value={blockForm.start_date}
                          onChange={(e) => setBlockForm({ ...blockForm, start_date: e.target.value })}
                        />
                      </div>
                      {!blockForm.is_all_day && (
                        <div className="space-y-2">
                          <Label>Start Time</Label>
                          <Input
                            type="time"
                            value={blockForm.start_time}
                            onChange={(e) => setBlockForm({ ...blockForm, start_time: e.target.value })}
                          />
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 grid-cols-2">
                      <div className="space-y-2">
                        <Label>End Date *</Label>
                        <Input
                          type="date"
                          value={blockForm.end_date}
                          onChange={(e) => setBlockForm({ ...blockForm, end_date: e.target.value })}
                        />
                      </div>
                      {!blockForm.is_all_day && (
                        <div className="space-y-2">
                          <Label>End Time</Label>
                          <Input
                            type="time"
                            value={blockForm.end_time}
                            onChange={(e) => setBlockForm({ ...blockForm, end_time: e.target.value })}
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Reason</Label>
                      <Input
                        value={blockForm.reason}
                        onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })}
                        placeholder="e.g., Family vacation"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Notes (Internal)</Label>
                      <Textarea
                        value={blockForm.notes}
                        onChange={(e) => setBlockForm({ ...blockForm, notes: e.target.value })}
                        placeholder="Additional notes..."
                        rows={2}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddBlock} disabled={isSaving || !selectedTech}>
                      {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Create Block
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Date Navigation */}
        <div className="flex items-center justify-between mt-4">
          <Button variant="outline" size="sm" onClick={() => navigateDate('prev')}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="font-medium">
            {view === 'day' 
              ? format(currentDate, 'EEEE, MMMM d, yyyy')
              : `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`
            }
          </div>
          <Button variant="outline" size="sm" onClick={() => navigateDate('next')}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <ScrollArea className="h-[600px]">
          <div className="min-w-[800px]">
            {/* Header Row */}
            <div className="grid border-b bg-muted/50 sticky top-0 z-10" 
              style={{ gridTemplateColumns: `150px repeat(${daysInView.length}, 1fr)` }}>
              <div className="p-2 border-r font-medium text-sm">Technician</div>
              {daysInView.map(day => (
                <div key={day.toISOString()} className="p-2 border-r text-center">
                  <div className="font-medium text-sm">{format(day, 'EEE')}</div>
                  <div className="text-xs text-muted-foreground">{format(day, 'MMM d')}</div>
                </div>
              ))}
            </div>

            {/* Technician Rows */}
            {technicians.map(tech => (
              <div 
                key={tech.id} 
                className="grid border-b"
                style={{ gridTemplateColumns: `150px repeat(${daysInView.length}, 1fr)` }}
              >
                {/* Tech Name */}
                <div className="p-2 border-r bg-muted/30">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm truncate">{tech.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tech.schedule_start_hour || 9}:00 - {tech.schedule_end_hour || 17}:00
                  </div>
                </div>

                {/* Day Columns */}
                {daysInView.map(day => {
                  const { appointments, manualBlocks } = getBlocksForTechAndDay(tech.id, tech.jobber_user_id, day);
                  const totalBlocks = appointments.length + manualBlocks.length;

                  return (
                    <div 
                      key={day.toISOString()} 
                      className="border-r relative min-h-[80px] bg-background hover:bg-muted/20"
                    >
                      {/* Hour grid lines (subtle) */}
                      <div className="absolute inset-0 pointer-events-none">
                        {HOURS.map((_, idx) => (
                          <div 
                            key={idx} 
                            className="border-t border-muted/30"
                            style={{ position: 'absolute', top: `${(idx / HOURS.length) * 100}%`, left: 0, right: 0 }}
                          />
                        ))}
                      </div>

                      {/* Appointments */}
                      {appointments.map(block => {
                        const pos = getBlockPosition(parseISO(block.start_at), parseISO(block.end_at), day);
                        return (
                          <div
                            key={block.id}
                            className="absolute left-1 right-1 rounded text-xs p-1 bg-primary/80 text-primary-foreground overflow-hidden cursor-default"
                            style={{ top: pos.top, height: pos.height, minHeight: '20px' }}
                            title={`${block.client_name || 'Appointment'}\n${format(parseISO(block.start_at), 'h:mm a')} - ${format(parseISO(block.end_at), 'h:mm a')}`}
                          >
                            <div className="font-medium truncate">{block.client_name || 'Appointment'}</div>
                            <div className="text-[10px] opacity-80">
                              {format(parseISO(block.start_at), 'h:mm a')}
                            </div>
                          </div>
                        );
                      })}

                      {/* Manual Blocks */}
                      {manualBlocks.map(block => {
                        const pos = getBlockPosition(parseISO(block.start_at), parseISO(block.end_at), day);
                        const bgColor = getCategoryColor(block.block_category);
                        return (
                          <div
                            key={block.id}
                            className={`absolute left-1 right-1 rounded text-xs p-1 ${bgColor} border-2 border-dashed overflow-hidden group cursor-pointer`}
                            style={{ top: pos.top, height: pos.height, minHeight: '20px' }}
                            title={`${block.block_category}: ${block.reason || 'No reason'}`}
                          >
                            <div className="font-medium truncate capitalize flex items-center gap-1">
                              {block.block_category === 'vacation' && <Palmtree className="w-3 h-3" />}
                              {block.block_category === 'pto' && <CalendarOff className="w-3 h-3" />}
                              {block.block_category}
                            </div>
                            {block.reason && (
                              <div className="text-[10px] opacity-70 truncate">{block.reason}</div>
                            )}
                            {canManageScheduleBlocks && (
                              <button
                                onClick={() => handleDeleteBlock(block.id)}
                                className="absolute top-0.5 right-0.5 p-0.5 bg-white/80 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {/* Empty state */}
                      {totalBlocks === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/50">
                          Available
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Legend */}
        <div className="border-t p-3 flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-primary/80" />
            <span>Appointment</span>
          </div>
          {BLOCK_CATEGORIES.map(cat => (
            <div key={cat.value} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded border-2 border-dashed ${cat.color}`} />
              <span>{cat.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
