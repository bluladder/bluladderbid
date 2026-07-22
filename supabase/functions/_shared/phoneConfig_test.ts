import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getPhoneByPurpose, PHONE_FALLBACK, RETIRED_PHONE_NUMBERS } from "./phoneConfig.ts";

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

Deno.test("retired ResponsiBid number is not in the active fallback registry", () => {
  const values = Object.values(PHONE_FALLBACK).map((p) => p.e164);
  assertEquals(values.includes("+14692426556"), false);
  const retired = RETIRED_PHONE_NUMBERS.find((r) => r.e164 === "+14692426556");
  assertEquals(!!retired, true);
  assertEquals(retired?.reason, "retired_responsibid");
});

// If a stale DB row somehow still carries the retired number with an active
// purpose, the resolver must refuse to hand it back.
Deno.test("resolver refuses to return a retired number from a stale DB row", async () => {
  const staleClient = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({
            data: {
              purpose: "app_ai",
              e164: "+14692426556",
              display_format: "(469) 242-6556",
              label: "ResponsiBid",
              is_public: false,
              is_active: true,
            },
          });
        },
      };
    },
  } as any;
  const p = await getPhoneByPurpose(staleClient, "app_ai");
  assertEquals(p.e164, "+14697472877");
});
