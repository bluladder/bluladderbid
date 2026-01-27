import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EmbedPreset {
  id: string;
  name: string;
  description: string | null;
  selected_page: string;
  embed_width: string;
  embed_height: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EmbedPresetInput {
  name: string;
  description?: string;
  selected_page: string;
  embed_width: string;
  embed_height: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export function useEmbedPresets() {
  return useQuery({
    queryKey: ['embed-presets'],
    queryFn: async (): Promise<EmbedPreset[]> => {
      const { data, error } = await supabase
        .from('embed_presets')
        .select('*')
        .order('name');
      
      if (error) {
        console.error('Error fetching embed presets:', error);
        throw error;
      }
      
      return data || [];
    },
  });
}

export function useCreateEmbedPreset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (preset: EmbedPresetInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('embed_presets')
        .insert([{
          name: preset.name,
          description: preset.description || null,
          selected_page: preset.selected_page,
          embed_width: preset.embed_width,
          embed_height: preset.embed_height,
          utm_source: preset.utm_source || null,
          utm_medium: preset.utm_medium || null,
          utm_campaign: preset.utm_campaign || null,
          utm_term: preset.utm_term || null,
          utm_content: preset.utm_content || null,
          created_by: user.id,
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embed-presets'] });
      toast.success('Preset saved successfully');
    },
    onError: (error) => {
      console.error('Error saving preset:', error);
      toast.error('Failed to save preset');
    },
  });
}

export function useDeleteEmbedPreset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('embed_presets')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embed-presets'] });
      toast.success('Preset deleted');
    },
    onError: (error) => {
      console.error('Error deleting preset:', error);
      toast.error('Failed to delete preset');
    },
  });
}
