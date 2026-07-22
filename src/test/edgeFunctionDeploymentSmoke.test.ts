// ============================================================================
// Edge-function deployment smoke test.
//
// Regression guard for the Turn 1 P1 outage: the customer-facing booking flow
// broke because `calculate-plan-options`, `save-quote`, and `jobber-availability`
// were missing from the deployed Edge Functions (404 NOT_FOUND_FUNCTION_BLOB),
// so the plan card, "Email me this bid", and the scheduling step all failed
// even though the browser code and server source were correct.
//
// Unit tests can't catch a missing deployment. This test hits the LIVE Supabase
// project only when explicitly enabled (RUN_EDGE_SMOKE=1) so CI can opt into it
// without breaking offline dev runs. It asserts each critical endpoint is
// reachable — i.e. it does NOT return 404 with the "function was not found"
// blob. It intentionally does NOT assert business behavior; the per-function
// tests own that.
// ============================================================================
import { describe, it, expect } from 'vitest';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? 'https://gyndziiuizpgwhqwyrvn.supabase.co';
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  '';

const CRITICAL_FUNCTIONS = [
  'calculate-plan-options',
  'save-quote',
  'jobber-availability',
  'calculate-quote',
] as const;

const enabled = process.env.RUN_EDGE_SMOKE === '1';

describe.skipIf(!enabled)('edge function deployment smoke', () => {
  for (const fn of CRITICAL_FUNCTIONS) {
    it(`${fn} is deployed (not 404 NOT_FOUND_FUNCTION_BLOB)`, async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({}),
      });
      // Any status other than 404 means the function bundle is present. A 400
      // (missing required fields) is the expected "healthy but empty payload"
      // shape for these endpoints; a 401/403 would indicate an auth policy
      // change, not a deployment gap.
      const text = await res.text();
      expect(res.status, `${fn} returned ${res.status}: ${text.slice(0, 200)}`).not.toBe(404);
      expect(text).not.toContain('NOT_FOUND_FUNCTION_BLOB');
    });
  }
});