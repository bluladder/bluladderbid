import { useState } from 'react';
import { Perk } from '@/types/servicePlan';
import { Plus, X } from 'lucide-react';

interface AddPerkFormProps {
  onAdd: (name: string, description: string, tier: Perk['tier']) => void;
}

export function AddPerkForm({ onAdd }: AddPerkFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<Perk['tier']>('good');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAdd(name.trim(), description.trim(), tier);
    
    // Reset form
    setName('');
    setDescription('');
    setTier('good');
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center justify-center gap-2 p-4 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all group"
      >
        <Plus className="w-4 h-4" />
        <span className="font-medium text-sm">Add Custom Benefit</span>
      </button>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 animate-scale-in col-span-full sm:col-span-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground text-sm">New Custom Benefit</h3>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Benefit Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., VIP Support Line"
            className="input-field mt-1 text-sm py-2"
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
            placeholder="Brief description of the perk"
            className="input-field mt-1 text-sm py-2"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Available In
          </label>
          <div className="flex gap-2 mt-1">
            {(['good', 'better', 'best'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
                  tier === t
                    ? t === 'good'
                      ? 'bg-tier-good text-white'
                      : t === 'better'
                      ? 'bg-tier-better text-primary-foreground'
                      : 'bg-tier-best text-success-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {t}+
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 btn-primary text-sm"
          >
            Add Benefit
          </button>
        </div>
      </form>
    </div>
  );
}
