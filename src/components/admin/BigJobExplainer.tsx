import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Users2, DollarSign, Clock, AlertCircle, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface BigJobSettings {
  big_job_value_threshold: number;
  big_job_solo_hours_threshold: number | null;
  big_job_trigger_mode: string;
  crew_efficiency_factor: number;
  auto_assign_two_techs: boolean;
  workday_length_hours: number;
  min_buffer_minutes: number;
}

export function BigJobExplainer() {
  const [settings, setSettings] = useState<BigJobSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('big_job_settings')
          .select('*')
          .eq('id', 'default')
          .single();

        if (error && error.code !== 'PGRST116') throw error;
        if (data) {
          setSettings({
            big_job_value_threshold: data.big_job_value_threshold,
            big_job_solo_hours_threshold: data.big_job_solo_hours_threshold,
            big_job_trigger_mode: data.big_job_trigger_mode || 'FITS_IN_DAY',
            crew_efficiency_factor: Number(data.crew_efficiency_factor) || 1.8,
            auto_assign_two_techs: data.auto_assign_two_techs,
            workday_length_hours: Number(data.workday_length_hours) || 8,
            min_buffer_minutes: data.min_buffer_minutes || 30,
          });
        }
      } catch (error) {
        console.error('Failed to fetch big job settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  if (isLoading || !settings) {
    return null;
  }

  const getTriggerDescription = () => {
    switch (settings.big_job_trigger_mode) {
      case 'PRICE_ONLY':
        return `Job price exceeds $${settings.big_job_value_threshold}`;
      case 'HOURS_ONLY':
        return `Estimated solo hours exceeds ${settings.big_job_solo_hours_threshold || 8} hours`;
      case 'PRICE_OR_HOURS':
        return `Price exceeds $${settings.big_job_value_threshold} OR solo hours exceeds ${settings.big_job_solo_hours_threshold || 8}`;
      case 'FITS_IN_DAY':
        const availableHours = (settings.workday_length_hours * 60 - settings.min_buffer_minutes) / 60;
        return `Solo duration exceeds ${availableHours.toFixed(1)} available hours in a workday`;
      default:
        return 'Custom trigger conditions';
    }
  };

  return (
    <TooltipProvider>
      <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
            <Users2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-blue-900 dark:text-blue-100">
                Multi-Technician Jobs
              </h4>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-[10px] cursor-help">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Affects Booking
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>This setting affects how jobs are scheduled and displayed to customers online.</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium text-blue-800 dark:text-blue-200">Triggered when: </span>
                  <span className="text-blue-700 dark:text-blue-300">{getTriggerDescription()}</span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium text-blue-800 dark:text-blue-200">Effect: </span>
                  <span className="text-blue-700 dark:text-blue-300">
                    {settings.auto_assign_two_techs 
                      ? `Two technicians scheduled together (${settings.crew_efficiency_factor}x faster)`
                      : 'Large job flag set, manual assignment required'
                    }
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                <DollarSign className="w-3 h-3 mr-1" />
                ${settings.big_job_value_threshold}+ threshold
              </Badge>
              {settings.big_job_solo_hours_threshold && (
                <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                  <Clock className="w-3 h-3 mr-1" />
                  {settings.big_job_solo_hours_threshold}hr+ solo
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                <Users2 className="w-3 h-3 mr-1" />
                {settings.crew_efficiency_factor}x crew efficiency
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
