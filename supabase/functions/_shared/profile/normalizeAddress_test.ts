import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatServiceAddress,
  normalizeKey,
  parseAddress,
  sameAddress,
} from "./normalizeAddress.ts";

Deno.test("parseAddress splits street/city/state/postal", () => {
  const p = parseAddress("1234 North Main Street, Frisco, TX 75035");
  assertEquals(p.state, "TX");
  assertEquals(p.postalCode, "75035");
  assertEquals(p.city, "Frisco");
});

Deno.test("sameAddress collapses suffix + directional variants", () => {
  assertEquals(
    sameAddress(
      "1234 N Main St, Frisco, TX 75035",
      "1234 North Main Street, Frisco, TX 75035",
    ),
    true,
  );
  assertEquals(
    sameAddress(
      "1234 Main St, Frisco, TX 75035",
      "1235 Main St, Frisco, TX 75035",
    ),
    false,
  );
});

Deno.test("normalizeKey is stable and case-insensitive", () => {
  assertEquals(
    normalizeKey("1234 North Main Street", "Frisco", "TX", "75035"),
    normalizeKey("1234 n main st", "frisco", "tx", "75035"),
  );
});

Deno.test("formatServiceAddress matches the three-part booking format", () => {
  assertEquals(
    formatServiceAddress({
      street: "5612 Binbranch Ln",
      city: "McKinney",
      state: "tx",
      postal_code: "75071",
    }),
    "5612 Binbranch Ln, McKinney, TX 75071",
  );
  assertEquals(
    formatServiceAddress({
      street: "5612 Binbranch Ln",
      city: "McKinney",
      state: "TX",
      postal_code: null,
    }),
    null,
  );
});
