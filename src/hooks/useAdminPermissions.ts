import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type AdminLevel = 'owner_admin' | 'admin' | 'operations_admin' | 'read_only_admin' | 'user' | null;

export interface AdminPermissions {
  level: AdminLevel;
  canEditCrewRules: boolean;
  canOverrideBookings: boolean;
  canManageScheduleBlocks: boolean;
  canEditPricing: boolean;
  canManageIntegrations: boolean;
  canViewAnalytics: boolean;
  canManageDiscountCodes: boolean;
  isReadOnly: boolean;
  loading: boolean;
}

const PERMISSION_HIERARCHY: Record<string, number> = {
  'owner_admin': 4,
  'admin': 4, // Legacy admin has same permissions as owner
  'operations_admin': 3,
  'read_only_admin': 2,
  'user': 1,
};

export function useAdminPermissions(): AdminPermissions {
  const { user, loading: authLoading } = useAuth();
  const [level, setLevel] = useState<AdminLevel>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    
    if (!user) {
      setLevel(null);
      setLoading(false);
      return;
    }

    const checkLevel = async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);
        
        if (error) {
          console.error('Error checking admin level:', error);
          setLevel(null);
        } else if (data && data.length > 0) {
          // Get the highest permission level from all roles
          const roles = data.map(r => r.role as string);
          const highestRole = roles.reduce((highest, current) => {
            const currentLevel = PERMISSION_HIERARCHY[current] || 0;
            const highestLevel = PERMISSION_HIERARCHY[highest] || 0;
            return currentLevel > highestLevel ? current : highest;
          }, 'user');
          setLevel(highestRole as AdminLevel);
        } else {
          setLevel('user');
        }
      } catch (err) {
        console.error('Error checking admin level:', err);
        setLevel(null);
      }
      setLoading(false);
    };

    checkLevel();
  }, [user, authLoading]);

  const permissionLevel = PERMISSION_HIERARCHY[level || 'user'] || 0;
  const isAtLeast = (minLevel: string) => permissionLevel >= (PERMISSION_HIERARCHY[minLevel] || 0);

  return {
    level,
    // Owner/Admin level required
    canEditPricing: isAtLeast('owner_admin'),
    canManageIntegrations: isAtLeast('owner_admin'),
    // Operations level required
    canEditCrewRules: isAtLeast('operations_admin'),
    canOverrideBookings: isAtLeast('operations_admin'),
    canManageScheduleBlocks: isAtLeast('operations_admin'),
    canManageDiscountCodes: isAtLeast('operations_admin'),
    // Read-only level required
    canViewAnalytics: isAtLeast('read_only_admin'),
    // Check if strictly read-only
    isReadOnly: level === 'read_only_admin',
    loading: loading || authLoading,
  };
}
