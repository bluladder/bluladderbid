import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/functions/_shared/smsOutbox.ts"),
  "utf8",
);

describe("quote SMS outbox claim fallback", () => {
  it("falls back to the base outbox claim only when the quote wrapper is absent", () => {
    expect(source).toMatch(/if \(\s*claimErr && input\.quoteId &&\s*isMissingFunctionError\(claimErr\)/);
    expect(source).toMatch(/PGRST202/);
    expect(source).toMatch(/42883/);
  });

  it("reuses the same semantic outbound key so idempotency is unchanged", () => {
    const fallback = source.slice(source.indexOf("quoteLineageFallback = true"));
    expect(fallback).toMatch(/p_outbound_key: input\.outboundKey/);
  });

  it("binds quote lineage conflict-safely after a fallback claim", () => {
    expect(source).toMatch(/\.update\(\{ quote_id: input\.quoteId \}\)/);
    expect(source).toMatch(/\.is\("quote_id", null\)/);
    expect(source).toMatch(/"quote_lineage_conflict"/);
  });
});
