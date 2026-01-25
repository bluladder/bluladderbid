import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { HomeDetails, AdditionalServices } from '@/types/homeowner';
import type { Json } from '@/integrations/supabase/types';

export interface SavedScenario {
  id: string;
  name: string;
  description: string | null;
  home_details: HomeDetails;
  additional_services: AdditionalServices;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface DbScenarioRow {
  id: string;
  name: string;
  description: string | null;
  home_details: Json;
  additional_services: Json;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useSavedScenarios() {
  return useQuery({
    queryKey: ['saved-scenarios'],
    queryFn: async (): Promise<SavedScenario[]> => {
      const { data, error } = await supabase
        .from('saved_scenarios')
        .select('*')
        .order('name');
      
      if (error) {
        console.error('Error fetching scenarios:', error);
        throw error;
      }
      
      // Transform database rows to typed scenarios
      return (data || []).map((row: DbScenarioRow) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        home_details: row.home_details as unknown as HomeDetails,
        additional_services: row.additional_services as unknown as AdditionalServices,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    },
  });
}

export function useCreateScenario() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      name, 
      description,
      homeDetails, 
      additionalServices 
    }: { 
      name: string;
      description?: string;
      homeDetails: HomeDetails;
      additionalServices: AdditionalServices;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const { data, error } = await supabase
        .from('saved_scenarios')
        .insert([{
          name,
          description: description || null,
          home_details: homeDetails as unknown as Json,
          additional_services: additionalServices as unknown as Json,
          created_by: user.id,
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] });
      toast.success('Scenario saved successfully');
    },
    onError: (error) => {
      console.error('Error saving scenario:', error);
      toast.error('Failed to save scenario');
    },
  });
}

export function useDeleteScenario() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('saved_scenarios')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-scenarios'] });
      toast.success('Scenario deleted');
    },
    onError: (error) => {
      console.error('Error deleting scenario:', error);
      toast.error('Failed to delete scenario');
    },
  });
}
