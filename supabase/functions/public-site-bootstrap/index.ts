import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolvePublicSitePublicationAuthority } from "../_shared/publicSitePublicationAuthority.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

const allowHeaders = "authorization, x-client-info, apikey, content-type";

function headers(origin: string | null): HeadersInit {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headers(origin) });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "unavailable" }), {
      status: 405,
      headers: headers(null),
    });
  }

  const limiter = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!limiter.allowed) {
    return new Response(JSON.stringify({ status: "unavailable" }), {
      status: 429,
      headers: headers(null),
    });
  }

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const authority = await resolvePublicSitePublicationAuthority(service, req);
  if (authority.status !== "resolved") {
    return new Response(JSON.stringify({ status: "unavailable" }), {
      status: 404,
      headers: headers(null),
    });
  }

  return new Response(
    JSON.stringify({
      status: "resolved",
      tenantKey: authority.tenantKey,
      publicName: authority.publicName,
      tagline: authority.tagline,
      accessMode: authority.accessMode,
      complianceRoutes: ["/privacy", "/terms", "/contact"],
      publicContactReady: authority.publicContactReady,
      publicContacts: authority.publicContacts,
      // A separate reviewed release must adopt tenant-aware quote, booking,
      // portal, chat, contact-write, pricing, and provider runtimes. The public
      // bootstrap can never activate them by itself.
      customerRuntimeReady: false,
    }),
    {
      status: 200,
      headers: headers(origin),
    },
  );
});
