import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, Plus, Trash2, Loader2, AlertCircle, Crown, Shield, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';

type AppRole = 'admin' | 'owner_admin' | 'operations_admin' | 'read_only_admin' | 'user';

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
  user_email?: string;
}

const ROLE_OPTIONS: { value: AppRole; label: string; description: string; icon: typeof Shield }[] = [
  { 
    value: 'owner_admin', 
    label: 'Owner Admin', 
    description: 'Full access to all features including integrations and pricing',
    icon: Crown,
  },
  { 
    value: 'operations_admin', 
    label: 'Operations Admin', 
    description: 'Can manage crew, schedule blocks, and override bookings',
    icon: Shield,
  },
  { 
    value: 'read_only_admin', 
    label: 'Read-Only Admin', 
    description: 'Can view analytics and data but cannot make changes',
    icon: Eye,
  },
];

const ROLE_COLORS: Record<AppRole, string> = {
  'owner_admin': 'bg-amber-100 text-amber-800 border-amber-300',
  'admin': 'bg-amber-100 text-amber-800 border-amber-300',
  'operations_admin': 'bg-blue-100 text-blue-800 border-blue-300',
  'read_only_admin': 'bg-gray-100 text-gray-800 border-gray-300',
  'user': 'bg-green-100 text-green-800 border-green-300',
};

export function AdminRoleManager() {
  const { level: currentLevel } = useAdminPermissions();
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    user_id: '',
    role: 'read_only_admin' as AppRole,
  });

  const canManageRoles = currentLevel === 'owner_admin' || currentLevel === 'admin';

  const fetchRoles = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUserRoles((data || []).map(r => ({
        ...r,
        role: r.role as AppRole,
      })));
    } catch (error) {
      console.error('Failed to fetch user roles:', error);
      toast.error('Failed to load user roles');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleSubmit = async () => {
    if (!formData.user_id) {
      toast.error('Please enter a user ID');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.from('user_roles').insert({
        user_id: formData.user_id,
        role: formData.role,
      });

      if (error) {
        if (error.code === '23505') {
          toast.error('This user already has a role assigned');
        } else {
          throw error;
        }
        return;
      }

      toast.success('User role added');
      setIsDialogOpen(false);
      setFormData({ user_id: '', role: 'read_only_admin' });
      fetchRoles();
    } catch (error) {
      console.error('Failed to add user role:', error);
      toast.error('Failed to add user role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (role: UserRole) => {
    if (!confirm(`Remove ${role.role} role from this user?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('id', role.id);

      if (error) throw error;
      toast.success('User role removed');
      fetchRoles();
    } catch (error) {
      console.error('Failed to delete user role:', error);
      toast.error('Failed to delete user role');
    }
  };

  const getRoleBadge = (role: AppRole) => {
    const roleConfig = ROLE_OPTIONS.find(r => r.value === role);
    const Icon = roleConfig?.icon || Shield;
    const color = ROLE_COLORS[role] || ROLE_COLORS['user'];
    const label = roleConfig?.label || (role === 'admin' ? 'Admin (Legacy)' : role);
    
    return (
      <Badge className={`${color} font-normal`}>
        <Icon className="w-3 h-3 mr-1" />
        {label}
      </Badge>
    );
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
              <ShieldCheck className="w-5 h-5" />
              Admin Roles
            </CardTitle>
            <CardDescription>
              Manage who has access to the admin panel and their permission levels
            </CardDescription>
          </div>
          {canManageRoles && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Role
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Admin Role</DialogTitle>
                  <DialogDescription>
                    Grant admin access to a user. You'll need their user ID from the authentication system.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>User ID (UUID) *</Label>
                    <Input
                      value={formData.user_id}
                      onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                      placeholder="e.g., 123e4567-e89b-12d3-a456-426614174000"
                    />
                    <p className="text-xs text-muted-foreground">
                      The user must already have an account. Get their ID from the Users section.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select
                      value={formData.role}
                      onValueChange={(v) => setFormData({ ...formData, role: v as AppRole })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map(role => (
                          <SelectItem key={role.value} value={role.value}>
                            <div className="flex items-center gap-2">
                              <role.icon className="w-4 h-4" />
                              <div>
                                <div>{role.label}</div>
                                <div className="text-xs text-muted-foreground">{role.description}</div>
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Permission Hierarchy:</strong>
                      <ul className="list-disc list-inside mt-1 text-sm">
                        <li><strong>Owner Admin:</strong> Full access to everything</li>
                        <li><strong>Operations Admin:</strong> Crew, schedule blocks, booking overrides</li>
                        <li><strong>Read-Only:</strong> View analytics and data only</li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={isSaving}>
                    {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Add Role
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!canManageRoles && (
          <Alert className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Only Owner Admins can manage admin roles.
            </AlertDescription>
          </Alert>
        )}

        {userRoles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No admin roles configured</p>
            <p className="text-sm">Add admin users to grant access to this panel</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                {canManageRoles && <TableHead className="w-[50px]"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {userRoles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-mono text-xs">
                    {role.user_id}
                  </TableCell>
                  <TableCell>{getRoleBadge(role.role)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(role.created_at).toLocaleDateString()}
                  </TableCell>
                  {canManageRoles && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(role)}
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
