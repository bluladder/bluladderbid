import { Link } from 'react-router-dom';

interface CustomerFooterProps {
  embed?: boolean;
}

/** Unified customer-facing footer with consistent BluLadder branding. */
export function CustomerFooter({ embed }: CustomerFooterProps) {
  if (embed) return null;

  return (
    <footer className="border-t border-border mt-16">
      <div className="container py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <Link to="/" className="hover:opacity-80 transition-opacity">
            <span className="font-display font-bold text-primary">BluLadder</span>
            <span className="ml-2">Next Level Clean</span>
          </Link>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link to="/services" className="hover:text-foreground transition-colors">Services</Link>
            <Link to="/plan-builder" className="hover:text-foreground transition-colors">Service Plans</Link>
            <Link to="/customer-portal" className="hover:text-foreground transition-colors">Customer Portal</Link>
            <Link to="/preferences" className="hover:text-foreground transition-colors">Message Preferences</Link>
          </nav>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} BluLadder • Next Level Clean
        </p>
      </div>
    </footer>
  );
}
