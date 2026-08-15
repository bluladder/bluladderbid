import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  decidePublicSurface,
  KLAMATH_PUBLIC_HOSTNAME,
  parsePublicSiteBootstrap,
  type PublicSiteBootstrap,
} from '@/lib/publicSite/klamathPublicSurface';
import { KlamathCompliancePage } from '@/pages/KlamathCompliancePage';

function Unavailable({ loading = false }: { loading?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="max-w-xl space-y-3 text-center">
        <h1 className="text-3xl font-bold">BluLadder site unavailable</h1>
        <p className="text-muted-foreground">
          {loading
            ? 'We are verifying this site before showing customer information.'
            : 'This site is not accepting public requests yet.'}
        </p>
      </div>
    </main>
  );
}

export function PublicSiteBoundary({ children }: { children: ReactNode }) {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
  const isKlamath = hostname.trim().toLowerCase().replace(/\.$/, '') === KLAMATH_PUBLIC_HOSTNAME;
  const [loading, setLoading] = useState(isKlamath);
  const [bootstrap, setBootstrap] = useState<PublicSiteBootstrap | null>(null);

  useEffect(() => {
    if (!isKlamath) return;
    let active = true;
    void supabase.functions.invoke('public-site-bootstrap', { body: {} })
      .then(({ data, error }) => {
        if (!active) return;
        setBootstrap(error ? null : parsePublicSiteBootstrap(data));
      })
      .catch(() => {
        if (active) setBootstrap(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isKlamath]);

  const decision = useMemo(
    () => decidePublicSurface(hostname, pathname, bootstrap),
    [bootstrap, hostname, pathname],
  );

  if (decision.mode === 'existing_dfw' || decision.mode === 'development_preview') {
    return <>{children}</>;
  }
  if (loading) return <Unavailable loading />;
  if (decision.mode === 'klamath_compliance') {
    return <KlamathCompliancePage {...decision} />;
  }
  return <Unavailable />;
}
