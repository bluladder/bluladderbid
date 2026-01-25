import { useState } from 'react';
import { format } from 'date-fns';
import { Plus, Trash2, Pencil, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  useDiscountCodes,
  useCreateDiscountCode,
  useUpdateDiscountCode,
  useDeleteDiscountCode,
  useToggleDiscountCode,
  type DiscountCode,
  type CreateDiscountCodeInput,
} from '@/hooks/useDiscountCodes';

export function DiscountCodesManager() {
  const { data: codes, isLoading } = useDiscountCodes();
  const createCode = useCreateDiscountCode();
  const updateCode = useUpdateDiscountCode();
  const deleteCode = useDeleteDiscountCode();
  const toggleCode = useToggleDiscountCode();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<DiscountCode | null>(null);

  const handleCreate = async (input: CreateDiscountCodeInput) => {
    await createCode.mutateAsync(input);
    setIsCreateOpen(false);
  };

  const handleUpdate = async (input: Partial<DiscountCode> & { id: string }) => {
    await updateCode.mutateAsync(input);
    setEditingCode(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this discount code?')) {
      await deleteCode.mutateAsync(id);
    }
  };

  const handleToggle = async (id: string, currentState: boolean) => {
    await toggleCode.mutateAsync({ id, is_active: !currentState });
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading discount codes...</div>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Discount Codes</CardTitle>
          <CardDescription>Manage promotional codes for customer discounts</CardDescription>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Code
            </Button>
          </DialogTrigger>
          <DiscountCodeForm
            onSubmit={handleCreate}
            onCancel={() => setIsCreateOpen(false)}
            isLoading={createCode.isPending}
          />
        </Dialog>
      </CardHeader>
      <CardContent>
        {codes && codes.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((code) => (
                <TableRow key={code.id}>
                  <TableCell>
                    <div>
                      <span className="font-mono font-semibold">{code.code}</span>
                      {code.description && (
                        <p className="text-xs text-muted-foreground">{code.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {code.discount_type === 'percentage'
                      ? `${code.discount_value}%`
                      : `$${code.discount_value.toFixed(2)}`}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={code.is_active}
                        onCheckedChange={() => handleToggle(code.id, code.is_active)}
                      />
                      {isExpired(code.expires_at) ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : code.is_active ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {code.expires_at
                      ? format(new Date(code.expires_at), 'MMM d, yyyy')
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    {code.usage_count}
                    {code.max_uses ? ` / ${code.max_uses}` : ''}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Dialog
                        open={editingCode?.id === code.id}
                        onOpenChange={(open) => !open && setEditingCode(null)}
                      >
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingCode(code)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        {editingCode && (
                          <DiscountCodeForm
                            initialData={editingCode}
                            onSubmit={(data) => handleUpdate({ id: editingCode.id, ...data })}
                            onCancel={() => setEditingCode(null)}
                            isLoading={updateCode.isPending}
                          />
                        )}
                      </Dialog>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(code.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No discount codes yet. Create one to get started.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface DiscountCodeFormProps {
  initialData?: DiscountCode;
  onSubmit: (data: CreateDiscountCodeInput) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

function DiscountCodeForm({ initialData, onSubmit, onCancel, isLoading }: DiscountCodeFormProps) {
  const [code, setCode] = useState(initialData?.code || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>(
    initialData?.discount_type || 'percentage'
  );
  const [discountValue, setDiscountValue] = useState(
    initialData?.discount_value?.toString() || ''
  );
  const [isActive, setIsActive] = useState(initialData?.is_active ?? true);
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(
    initialData?.expires_at ? new Date(initialData.expires_at) : undefined
  );
  const [maxUses, setMaxUses] = useState(initialData?.max_uses?.toString() || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code.trim() || !discountValue) {
      return;
    }

    await onSubmit({
      code: code.trim(),
      description: description.trim() || undefined,
      discount_type: discountType,
      discount_value: parseFloat(discountValue),
      is_active: isActive,
      expires_at: expiresAt?.toISOString() || null,
      max_uses: maxUses ? parseInt(maxUses) : null,
    });
  };

  return (
    <DialogContent>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>{initialData ? 'Edit Discount Code' : 'Create Discount Code'}</DialogTitle>
          <DialogDescription>
            {initialData
              ? 'Update the discount code settings'
              : 'Create a new promotional discount code'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SUMMER20"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Summer promotion - 20% off"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Discount Type</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as 'percentage' | 'fixed')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                  <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="value">Value</Label>
              <Input
                id="value"
                type="number"
                min="0"
                step={discountType === 'percentage' ? '1' : '0.01'}
                max={discountType === 'percentage' ? '100' : undefined}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'percentage' ? '20' : '25.00'}
                required
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Expiration Date (optional)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'justify-start text-left font-normal',
                    !expiresAt && 'text-muted-foreground'
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {expiresAt ? format(expiresAt, 'PPP') : 'No expiration'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={expiresAt}
                  onSelect={setExpiresAt}
                  disabled={(date) => date < new Date()}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
                {expiresAt && (
                  <div className="p-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => setExpiresAt(undefined)}
                    >
                      Clear expiration
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="maxUses">Max Uses (optional)</Label>
            <Input
              id="maxUses"
              type="number"
              min="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Unlimited"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label>Code is active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Saving...' : initialData ? 'Update Code' : 'Create Code'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
