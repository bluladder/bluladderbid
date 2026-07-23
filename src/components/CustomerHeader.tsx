import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';

interface CustomerHeaderProps {
  /** When true, the header is not rendered (used for iframe embeds). */
  embed?: boolean;
}

const NAV_LINKS = [
  { to: '/services', label: 'Services' },
  { to: '/plan-builder', label: 'Service Plans' },
  { to: '/customer-portal', label: 'Customer Portal' },
];

/**
 * Unified customer-facing header used across every public route so the
 * BluLadder brand and navigation stay consistent. Includes a mobile
 * hamburger menu so phone visitors can still reach every page.
 */
export function CustomerHeader({ embed }: CustomerHeaderProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  if (embed) return null;

  const isActive = (to: string) => location.pathname === to;

  return (
    <header className="border-b border-border bg-card sticky top-0 z-50">
      <div className="container py-3.5">
        <div className="flex items-center justify-between gap-4">
          {/* Brand */}
          <Link to="/" className="flex flex-col leading-none hover:opacity-80 transition-opacity">
            <span className="text-xl font-display font-bold text-primary">BluLadder</span>
            <span className="text-xs text-muted-foreground">Next Level Clean</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`text-sm transition-colors ${
                  isActive(link.to)
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Button asChild size="sm">
              <Link to="/">Get a Quote</Link>
            </Button>
          </nav>

          {/* Mobile menu */}
          <div className="md:hidden flex items-center gap-2">
            <Button asChild size="sm">
              <Link to="/">Get a Quote</Link>
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Open menu">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader className="text-left">
                  <SheetTitle>
                    <span className="text-primary font-display">BluLadder</span>
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1">
                  {NAV_LINKS.map((link) => (
                    <SheetClose asChild key={link.to}>
                      <Link
                        to={link.to}
                        className={`px-3 py-3 rounded-lg text-base transition-colors ${
                          isActive(link.to)
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-foreground hover:bg-muted'
                        }`}
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  ))}
                  <SheetClose asChild>
                    <Link
                      to="/"
                      className="mt-3 px-3 py-3 rounded-lg text-base font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Get a Quote
                    </Link>
                  </SheetClose>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
