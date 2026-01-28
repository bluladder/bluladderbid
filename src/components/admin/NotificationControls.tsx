import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Bell, BellOff, MessageSquare, DollarSign } from 'lucide-react';

interface NotificationControlsProps {
  notifyCustomer: boolean;
  onNotifyCustomerChange: (value: boolean) => void;
  requireConfirmation: boolean;
  onRequireConfirmationChange: (value: boolean) => void;
  showPriceChange: boolean;
  onShowPriceChangeChange: (value: boolean) => void;
  adminNote: string;
  onAdminNoteChange: (value: string) => void;
  showPriceOption?: boolean;
}

export function NotificationControls({
  notifyCustomer,
  onNotifyCustomerChange,
  requireConfirmation,
  onRequireConfirmationChange,
  showPriceChange,
  onShowPriceChangeChange,
  adminNote,
  onAdminNoteChange,
  showPriceOption = true,
}: NotificationControlsProps) {
  return (
    <div className="space-y-4">
      <Separator />
      
      <div className="space-y-3">
        <p className="text-sm font-medium flex items-center gap-2">
          {notifyCustomer ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          Customer Notification
        </p>
        
        <div className="space-y-3 pl-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="notify-customer"
              checked={notifyCustomer}
              onCheckedChange={(checked) => onNotifyCustomerChange(checked === true)}
            />
            <Label htmlFor="notify-customer" className="text-sm font-normal cursor-pointer">
              Notify customer of this change
            </Label>
          </div>

          {notifyCustomer && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="require-confirmation"
                  checked={requireConfirmation}
                  onCheckedChange={(checked) => onRequireConfirmationChange(checked === true)}
                />
                <Label htmlFor="require-confirmation" className="text-sm font-normal cursor-pointer">
                  Require customer confirmation
                </Label>
              </div>

              {showPriceOption && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="show-price"
                    checked={showPriceChange}
                    onCheckedChange={(checked) => onShowPriceChangeChange(checked === true)}
                  />
                  <Label htmlFor="show-price" className="text-sm font-normal cursor-pointer flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    Show price in notification
                  </Label>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {notifyCustomer && (
        <div className="space-y-2">
          <Label htmlFor="admin-note" className="text-sm flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            Note to customer (optional)
          </Label>
          <Textarea
            id="admin-note"
            value={adminNote}
            onChange={(e) => onAdminNoteChange(e.target.value)}
            placeholder="Add a message that will be shown to the customer..."
            rows={2}
            className="text-sm"
          />
        </div>
      )}
    </div>
  );
}
