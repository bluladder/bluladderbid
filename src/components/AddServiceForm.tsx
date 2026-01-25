import { useState } from 'react';
import { ServiceFrequency, FREQUENCY_LABELS } from '@/types/servicePlan';
import { Plus, X } from 'lucide-react';

interface AddServiceFormProps {
  onAdd: (name: string, price: number, frequency: ServiceFrequency, description: string) => void;
}

export function AddServiceForm({ onAdd }: AddServiceFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(150);
  const [frequency, setFrequency] = useState<ServiceFrequency>('annual');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAdd(name.trim(), price, frequency, description.trim());
    
    // Reset form
    setName('');
    setPrice(150);
    setFrequency('annual');
    setDescription('');
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="card-elevated p-5 w-full flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all group"
      >
        <div className="w-10 h-10 rounded-lg bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
          <Plus className="w-5 h-5" />
        </div>
        <span className="font-medium">Add Custom Service</span>
      </button>
    );
  }

  return (
    <div className="card-elevated p-5 ring-2 ring-primary/20 animate-scale-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">New Custom Service</h3>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Service Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Patio Furniture Cleaning"
            className="input-field mt-1"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the service"
            className="input-field mt-1"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Base Price
            </label>
            <div className="mt-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                className="input-field pl-7 text-lg font-semibold"
                min={0}
                step={5}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Frequency
            </label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ServiceFrequency)}
              className="input-field mt-1"
            >
              {(Object.keys(FREQUENCY_LABELS) as ServiceFrequency[]).map((freq) => (
                <option key={freq} value={freq}>
                  {FREQUENCY_LABELS[freq]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex-1 px-4 py-2 rounded-lg font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 btn-primary"
          >
            Add Service
          </button>
        </div>
      </form>
    </div>
  );
}
