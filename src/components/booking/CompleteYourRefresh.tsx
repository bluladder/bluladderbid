import { Plus, Check, Sparkles, Home, Droplets, Trees, Sun, PanelTop, Grid3x3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AdditionalServices } from '@/types/homeowner';

// Presentation-only anchor prices — used strictly as "starting from" marketing anchors.
// Actual booking price is always driven by the canonical pricing engine once selected.
const UPSELL_CATALOG = [
  {
    key: 'houseWash',
    name: 'House Washing',
    benefit: "Restore your home's appearance and remove dirt, algae, and mildew.",
    from: 199,
    Icon: Home,
    gradient: 'from-sky-400/25 via-cyan-400/15 to-blue-500/10',
    sellingCopy: 'Since we\'re already at your home — most customers add this.',
  },
  {
    key: 'drivewayCleaning',
    name: 'Driveway Cleaning',
    benefit: 'Lift oil stains and years of grime from your concrete or pavers.',
    from: 99,
    Icon: Grid3x3,
    gradient: 'from-slate-400/25 via-zinc-400/15 to-stone-500/10',
    sellingCopy: 'Instant curb-appeal boost.',
  },
  {
    key: 'gutterCleaning',
    name: 'Gutter Cleaning',
    benefit: 'Prevent water damage and clogged downspouts with a full flush-out.',
    from: 149,
    Icon: Trees,
    gradient: 'from-emerald-400/25 via-green-400/15 to-teal-500/10',
    sellingCopy: 'One of our most popular add-ons.',
  },
  {
    key: 'roofCleaning',
    name: 'Roof Washing',
    benefit: 'Remove black streaks and algae — protects your shingles for years.',
    from: 299,
    Icon: Home,
    gradient: 'from-amber-400/25 via-orange-400/15 to-red-400/10',
    sellingCopy: 'Extend roof life without replacement.',
  },
  {
    key: 'solarPanelCleaning',
    name: 'Solar Panel Cleaning',
    benefit: 'Recover lost energy output from dust, pollen, and bird droppings.',
    from: 200,
    Icon: Sun,
    gradient: 'from-yellow-400/25 via-amber-400/15 to-orange-400/10',
    sellingCopy: 'Boosts panel efficiency measurably.',
  },
  {
    key: 'screenRepair',
    name: 'Screen Repair',
    benefit: 'On-site re-screening while our team is already at your home.',
    from: 35,
    Icon: PanelTop,
    gradient: 'from-purple-400/25 via-fuchsia-400/15 to-pink-400/10',
    sellingCopy: 'Convenient — no separate trip needed.',
  },
  {
    key: 'windowCleaning',
    name: 'Window Cleaning',
    benefit: 'Streak-free inside and out — see the difference instantly.',
    from: 189,
    Icon: Droplets,
    gradient: 'from-cyan-400/25 via-sky-400/15 to-indigo-400/10',
    sellingCopy: 'A BluLadder favorite.',
  },
] as const;

type UpsellKey = typeof UPSELL_CATALOG[number]['key'];

function isSelected(services: AdditionalServices, key: UpsellKey): boolean {
  switch (key) {
    case 'windowCleaning': return services.windowCleaning;
    case 'houseWash': return services.houseWash;
    case 'gutterCleaning': return services.gutterCleaning;
    case 'roofCleaning': return services.roofCleaning;
    case 'drivewayCleaning': return services.drivewayCleaning.enabled;
    case 'solarPanelCleaning': return services.solarPanelCleaning.enabled;
    case 'screenRepair': return services.screenRepair.enabled;
  }
}

function enableService(prev: AdditionalServices, key: UpsellKey): AdditionalServices {
  switch (key) {
    case 'windowCleaning': return { ...prev, windowCleaning: true };
    case 'houseWash': return { ...prev, houseWash: true };
    case 'gutterCleaning': return { ...prev, gutterCleaning: true };
    case 'roofCleaning': return { ...prev, roofCleaning: true };
    case 'drivewayCleaning':
      return { ...prev, drivewayCleaning: { ...prev.drivewayCleaning, enabled: true } };
    case 'solarPanelCleaning':
      return { ...prev, solarPanelCleaning: { ...prev.solarPanelCleaning, enabled: true } };
    case 'screenRepair':
      return { ...prev, screenRepair: { ...prev.screenRepair, enabled: true } };
  }
}

interface CompleteYourRefreshProps {
  additionalServices: AdditionalServices;
  onAdd: (updater: (prev: AdditionalServices) => AdditionalServices) => void;
  title?: string;
  subtitle?: string;
  variant?: 'full' | 'compact';
}

/**
 * "Complete Your Exterior Refresh" upsell — displays services the customer has
 * NOT selected as friendly cards with a benefit, a starting anchor price, and
 * a one-click Add button. Pure presentation: uses existing selection state and
 * lets the canonical pricing engine compute the real price after add.
 */
export function CompleteYourRefresh({
  additionalServices,
  onAdd,
  title = 'Complete Your Exterior Refresh',
  subtitle = "Since we're already coming out — most customers add one of these.",
  variant = 'full',
}: CompleteYourRefreshProps) {
  const missing = UPSELL_CATALOG.filter((s) => !isSelected(additionalServices, s.key));
  if (missing.length === 0) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-success/15 flex items-center justify-center">
          <Check className="w-5 h-5 text-success" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Great choice!</p>
          <p className="text-xs text-muted-foreground">
            You&apos;ve unlocked our full exterior refresh — one visit, one crew, one great result.
          </p>
        </div>
      </div>
    );
  }

  const items = variant === 'compact' ? missing.slice(0, 3) : missing;

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-border/70 bg-gradient-to-br from-background to-muted/30 p-4 space-y-3"
    >
      <header className="flex items-start gap-2">
        <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
          <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
        </div>
      </header>

      {/* Mobile: horizontal snap scroll; sm+: 2-col grid so nothing feels overwhelming. */}
      <div
        className="flex sm:grid sm:grid-cols-2 gap-3 overflow-x-auto sm:overflow-visible -mx-4 sm:mx-0 px-4 sm:px-0 snap-x snap-mandatory sm:snap-none pb-1"
        role="list"
      >
        {items.map((item) => {
          const { Icon } = item;
          return (
            <div
              key={item.key}
              role="listitem"
              className="group relative flex flex-col shrink-0 w-[85%] sm:w-auto snap-start rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              {/* "Photo" placeholder tile — premium gradient with service icon */}
              <div
                className={`relative h-24 sm:h-28 w-full bg-gradient-to-br ${item.gradient} flex items-center justify-center`}
                aria-hidden="true"
              >
                <Icon className="w-10 h-10 text-foreground/70" strokeWidth={1.5} />
                <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wider font-semibold text-foreground/60 bg-background/70 backdrop-blur px-2 py-0.5 rounded-full">
                  Add-on
                </span>
              </div>

              <div className="p-3 flex flex-col gap-2 flex-1">
                <div>
                  <h4 className="text-sm font-semibold text-foreground leading-tight">{item.name}</h4>
                  <p className="text-xs text-muted-foreground leading-snug mt-1 line-clamp-2">
                    {item.benefit}
                  </p>
                </div>
                <p className="text-[11px] text-primary/80 italic leading-snug">{item.sellingCopy}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">
                    From <span className="font-bold text-foreground">${item.from}</span>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => onAdd((prev) => enableService(prev, item.key))}
                    className="h-8 px-3 text-xs font-semibold gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
