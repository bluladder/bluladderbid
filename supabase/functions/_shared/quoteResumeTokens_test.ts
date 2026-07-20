// deno-lint-ignore-file no-explicit-any
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  generateResumeToken,
  sha256Hex,
  mintQuoteResumeToken,
  verifyResumeToken,
  revokeQuoteResumeTokens,
} from "./quoteResumeTokens.ts";

// Minimal in-memory Supabase mock covering only the calls the token helpers
// make: from("quote_resume_tokens").insert / select+eq+maybeSingle / update.
function mkSb() {
  const rows: any[] = [];
  const table = () => ({
    insert: (row: any) => {
      rows.push({ id: crypto.randomUUID(), use_count: 0, revoked_at: null, last_used_at: null, ...row });
      return Promise.resolve({ error: null });
    },
    update: (patch: any) => {
      const q: any = { _eq: null as any, _is: null as any };
      const runner = () => {
        for (const r of rows) {
          const eqOk = q._eq ? r[q._eq[0]] === q._eq[1] : true;
          const isOk = q._is ? r[q._is[0]] == q._is[1] : true;
          if (eqOk && isOk) Object.assign(r, patch);
        }
        return Promise.resolve({ error: null });
      };
      const chain: any = {
        eq: (k: string, v: any) => { q._eq = [k, v]; return chain; },
        is: (k: string, v: any) => { q._is = [k, v]; return chain; },
        then: (res: any, rej: any) => runner().then(res, rej),
        catch: (rej: any) => runner().catch(rej),
      };
      return chain;
    },
    select: (_cols: string) => {
      const q: any = { _eq: null as any };
      const chain: any = {
        eq: (k: string, v: any) => { q._eq = [k, v]; return chain; },
        maybeSingle: () => {
          const r = rows.find((r: any) => r[q._eq[0]] === q._eq[1]);
          return Promise.resolve({ data: r ?? null, error: null });
        },
      };
      return chain;
    },
  });
  return {
    _rows: rows,
    from: (_t: string) => table(),
  };
}

Deno.test("generateResumeToken is URL-safe and >= 40 chars", () => {
  const t = generateResumeToken();
  assert(t.length >= 40);
  assert(/^[A-Za-z0-9_-]+$/.test(t));
});

Deno.test("mint + verify round trip works, then revoke fails safely", async () => {
  const sb: any = mkSb();
  const minted = await mintQuoteResumeToken(sb, "Q1", { ttlHours: 1, issuedReason: "test" });
  assert(minted);
  assertEquals(sb._rows.length, 1);
  // Raw token never stored
  assertEquals(sb._rows[0].token_hash, await sha256Hex(minted!.token));
  assert(!("token" in sb._rows[0]));

  const ok = await verifyResumeToken(sb, "Q1", minted!.token);
  assertEquals(ok.ok, true);

  // Token A cannot open Quote B
  const mismatch = await verifyResumeToken(sb, "Q2", minted!.token);
  assertEquals(mismatch.ok, false);
  assertEquals((mismatch as any).reason, "quote_mismatch");

  // Revocation invalidates
  await revokeQuoteResumeTokens(sb, "Q1");
  const revoked = await verifyResumeToken(sb, "Q1", minted!.token);
  assertEquals(revoked.ok, false);
  assertEquals((revoked as any).reason, "revoked");
});

Deno.test("malformed tokens fail before DB lookup", async () => {
  const sb: any = mkSb();
  for (const bad of ["", "short", "has spaces!", "a".repeat(200)]) {
    const r = await verifyResumeToken(sb, "Q1", bad);
    assertEquals(r.ok, false);
  }
});

Deno.test("expired tokens fail with reason=expired", async () => {
  const sb: any = mkSb();
  const minted = await mintQuoteResumeToken(sb, "Q1", { ttlHours: 1 });
  // Force expiry
  sb._rows[0].expires_at = new Date(Date.now() - 60_000).toISOString();
  const r = await verifyResumeToken(sb, "Q1", minted!.token);
  assertEquals(r.ok, false);
  assertEquals((r as any).reason, "expired");
});

Deno.test("resume URL uses opaque token, not PII", async () => {
  const sb: any = mkSb();
  const minted = await mintQuoteResumeToken(sb, "Q-abc", { appUrl: "https://bid.bluladder.com" });
  assert(minted!.resumeUrl.startsWith("https://bid.bluladder.com/quote/Q-abc?resume="));
  // No PII/attribution in URL
  assert(!/@|phone|utm_|email/i.test(minted!.resumeUrl));
});