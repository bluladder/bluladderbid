import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CustomerHeader } from "@/components/CustomerHeader";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Post-OAuth / magic-link landing page. Waits for the Supabase session to
// hydrate (from the URL hash), calls customer-auth-link to bind the auth
// user to a customer identity, then routes to the intended destination.
//
// Redirect target is read from sessionStorage (set before signIn); it MUST be
// a same-origin relative path — never taken directly from an untrusted URL
// parameter — to prevent open redirects.
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/customer-portal";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/customer-portal";
  if (raw.startsWith("/admin")) return "/customer-portal";
  return raw;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const next = sanitizeNext(sessionStorage.getItem("bl_auth_next"));

    const finish = async () => {
      try {
        // Ask the edge function to bind auth.user → customer_accounts.
        const { data, error: linkErr } = await supabase.functions.invoke("customer-auth-link");
        if (cancelled) return;
        if (linkErr) {
          setError("We couldn't set up your account. Please try again or contact support.");
          return;
        }
        if ((data as { status?: string })?.status === "ambiguous") {
          setError("We found multiple accounts matching your email. Please contact support so we can link you to the right one.");
          return;
        }
        sessionStorage.removeItem("bl_auth_next");
        navigate(next, { replace: true });
      } catch {
        if (!cancelled) setError("Something went wrong finishing sign-in. Please try again.");
      }
    };

    // If session already present, link immediately; otherwise wait for it.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) void finish();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")) {
        void finish();
      }
    });
    // Bail out if no session materializes within a few seconds.
    const t = setTimeout(() => {
      if (!cancelled) {
        supabase.auth.getSession().then(({ data }) => {
          if (!data.session && !cancelled) {
            setError("Sign-in didn't complete. The link may have expired — please try again.");
          }
        });
      }
    }, 6000);
    return () => { cancelled = true; sub.subscription.unsubscribe(); clearTimeout(t); };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <CustomerHeader />
      <main className="container py-16 max-w-md mx-auto text-center space-y-4">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Sign-in problem</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button className="min-h-11" onClick={() => navigate("/customer-portal", { replace: true })}>
              Back to sign-in
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
          </>
        )}
      </main>
    </div>
  );
}