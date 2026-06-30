// Shared authentication / authorization helpers for edge functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export function getBearer(req: Request): string | null {
  const h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return t.length ? t : null;
}

// True when the caller authenticated with the service-role key (internal / cron).
export function isServiceRoleToken(token: string | null): boolean {
  return !!token && !!SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY;
}

// Returns the admin user's id when the token belongs to an admin of at least
// `minLevel`, otherwise null.
export async function verifyAdmin(
  token: string | null,
  minLevel = "operations_admin",
): Promise<string | null> {
  if (!token) return null;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData } = await userClient.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return null;
    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: ok } = await service.rpc("has_admin_level", {
      _user_id: uid,
      _min_level: minLevel,
    });
    return ok ? uid : null;
  } catch (_e) {
    return null;
  }
}

// Allow either internal service-role calls (cron / server-to-server) or admins.
export async function requireAdminOrService(
  req: Request,
  minLevel = "operations_admin",
): Promise<{ ok: boolean; userId: string | null; service: boolean }> {
  const token = getBearer(req);
  if (isServiceRoleToken(token)) return { ok: true, userId: null, service: true };
  const uid = await verifyAdmin(token, minLevel);
  return { ok: !!uid, userId: uid, service: false };
}
