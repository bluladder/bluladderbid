import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getPhoneByPurpose, PHONE_FALLBACK } from "./phoneConfig.ts";

// A stub client whose phone_numbers query returns nothing (forces fallback).
const emptyClient = {
  from() {
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: null }); },
    };
  },
} as any;

Deno.test("primary_public resolves to the approved 469 CallRail number", async () => {
  const p = await getPhoneByPurpose(emptyClient, "primary_public");
  assertEquals(p.e164, "+14697472877");
  assertEquals(p.isPublic, true);
});

Deno.test("app_ai resolves to the 469 747 app number and is not public", async () => {
  const p = await getPhoneByPurpose(emptyClient, "app_ai");
  assertEquals(p.e164, "+14697472877");
  assertEquals(p.isPublic, false);
});

Deno.test("ResponsiBid number is never marked public / primary", async () => {
  const p = await getPhoneByPurpose(emptyClient, "responsibid");
  assertEquals(p.e164, "+14692426556");
  assertEquals(p.isPublic, false);
  // The primary public number must NOT be the ResponsiBid number.
  assertEquals(PHONE_FALLBACK.primary_public.e164 === p.e164, false);
});
