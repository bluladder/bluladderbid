import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getAppUrl, buildQuoteUrl, CANONICAL_PRODUCTION_APP_URL } from "./appUrl.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prior[k] = Deno.env.get(k) ?? undefined;
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("Production without config falls back to canonical bid.bluladder.com", () => {
  withEnv({ PUBLIC_APP_URL: undefined, APP_URL: undefined, APP_ENV: "production", DENO_DEPLOYMENT_ID: undefined }, () => {
    assertEquals(getAppUrl(), CANONICAL_PRODUCTION_APP_URL);
  });
});

Deno.test("Production ignores a lovable.app override and returns canonical", () => {
  withEnv({ APP_URL: "https://bluladderbid.lovable.app", APP_ENV: "production", PUBLIC_APP_URL: undefined, DENO_DEPLOYMENT_ID: undefined }, () => {
    assertEquals(getAppUrl(), CANONICAL_PRODUCTION_APP_URL);
  });
});

Deno.test("Preview may set an explicit non-lovable override", () => {
  withEnv({ PUBLIC_APP_URL: "https://preview.example.com/", APP_ENV: undefined, DENO_DEPLOYMENT_ID: undefined, APP_URL: undefined }, () => {
    assertEquals(getAppUrl(), "https://preview.example.com");
  });
});

Deno.test("buildQuoteUrl uses canonical prod URL and never embeds PII", () => {
  withEnv({ PUBLIC_APP_URL: undefined, APP_URL: undefined, APP_ENV: "production", DENO_DEPLOYMENT_ID: undefined }, () => {
    const url = buildQuoteUrl("abc-123");
    assertEquals(url, `${CANONICAL_PRODUCTION_APP_URL}/quote/abc-123`);
  });
});