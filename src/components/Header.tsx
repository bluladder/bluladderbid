import { Wrench, FileText, ClipboardList } from 'lucide-react';

export type ViewMode = 'builder' | 'preview' | 'agreement';

interface HeaderProps {
  businessName: string;
  onBusinessNameChange: (name: string) => void;
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export function Header({
  businessName,
  onBusinessNameChange,
  currentView,
  onViewChange,
}: HeaderProps) {
  return (
    <header className="border-b border-border/60 relative overflow-hidden">
      {/* Subtle gradient background */}
      <div 
        className="absolute inset-0 opacity-50"
        style={{ background: 'linear-gradient(135deg, hsl(193 100% 98%) 0%, hsl(0 0% 100%) 50%, hsl(210 30% 98%) 100%)' }}
      />
      
      <div className="container py-4 relative">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <Wrench className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              {currentView === 'builder' ? (
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => onBusinessNameChange(e.target.value)}
                  className="bg-transparent border-b-2 border-border focus:border-primary outline-none font-display text-xl font-bold text-foreground w-64 transition-colors"
                  placeholder="Your Business Name"
                  maxLength={100}
                />
              ) : (
                <h1 className="font-display text-xl font-bold text-foreground">{businessName}</h1>
              )}
              <p className="text-sm text-muted-foreground">
                Service Plan Builder
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-muted/60 backdrop-blur-sm rounded-xl p-1 border border-border/40">
            <TabButton
              active={currentView === 'builder'}
              onClick={() => onViewChange('builder')}
              icon={<Wrench className="w-4 h-4" />}
              label="Builder"
            />
            <TabButton
              active={currentView === 'preview'}
              onClick={() => onViewChange('preview')}
              icon={<ClipboardList className="w-4 h-4" />}
              label="Proposal"
            />
            <TabButton
              active={currentView === 'agreement'}
              onClick={() => onViewChange('agreement')}
              icon={<FileText className="w-4 h-4" />}
              label="Agreement"
            />
          </nav>
        </div>
      </div>
    </header>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
        active
          ? 'bg-card text-foreground shadow-md border border-border/40'
          : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
      }`}
      style={active ? { background: 'var(--gradient-card)' } : {}}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}