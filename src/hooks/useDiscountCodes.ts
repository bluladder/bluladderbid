import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface DiscountCode {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  is_active: boolean;
  expires_at: string | null;
  usage_count: number;
  max_uses: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDiscountCodeInput {
  code: string;
  description?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  is_active?: boolean;
  expires_at?: string | null;
  max_uses?: number | null;
}

export function useDiscountCodes() {
  return useQuery({
    queryKey: ['discount-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as DiscountCode[];
    },
  });
}

export function useCreateDiscountCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateDiscountCodeInput) => {
      const { error } = await supabase
        .from('discount_codes')
        .insert({
          code: input.code.toUpperCase().trim(),
          description: input.description || null,
          discount_type: input.discount_type,
          discount_value: input.discount_value,
          is_active: input.is_active ?? true,
          expires_at: input.expires_at || null,
          max_uses: input.max_uses || null,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-codes'] });
      toast.success('Discount code created');
    },
    onError: (error: Error) => {
      console.error('Error creating discount code:', error);
      if (error.message.includes('duplicate')) {
        toast.error('A code with this name already exists');
      } else {
        toast.error('Failed to create discount code');
      }
    },
  });
}

export function useUpdateDiscountCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DiscountCode> & { id: string }) => {
      const { error } = await supabase
        .from('discount_codes')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-codes'] });
      toast.success('Discount code updated');
    },
    onError: (error) => {
      console.error('Error updating discount code:', error);
      toast.error('Failed to update discount code');
    },
  });
}

export function useDeleteDiscountCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('discount_codes')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discount-codes'] });
      toast.success('Discount code deleted');
    },
    onError: (error) => {
      console.error('Error deleting discount code:', error);
      toast.error('Failed to delete discount code');
    },
  });
}

export function useToggleDiscountCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('discount_codes')
        .update({ is_active })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: (_, { is_active }) => {
      queryClient.invalidateQueries({ queryKey: ['discount-codes'] });
      toast.success(is_active ? 'Code activated' : 'Code deactivated');
    },
    onError: (error) => {
      console.error('Error toggling discount code:', error);
      toast.error('Failed to toggle discount code');
    },
  });
}

export interface ValidatedDiscount {
  type: 'percentage' | 'fixed';
  value: number;
  code: string;
}

export async function validateDiscountCode(code: string): Promise<{ valid: boolean; discount?: ValidatedDiscount; error?: string }> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-discount-code`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ code }),
      }
    );

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error validating discount code:', error);
    return { valid: false, error: 'Failed to validate code' };
  }
}
