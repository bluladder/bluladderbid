import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFactAllowedForService,
  isStale,
  requiredFactsForService,
} from "./serviceFactMap.ts";

Deno.test("driveway quote may NOT reuse house_sqft", () => {
  assertEquals(isFactAllowedForService("driveway_cleaning", "house_sqft"), false);
  assertEquals(isFactAllowedForService("driveway_cleaning", "driveway_sqft"), true);
});

Deno.test("gutter quote reuses house_sqft + stories", () => {
  assertEquals(isFactAllowedForService("gutter_cleaning", "house_sqft"), true);
  assertEquals(isFactAllowedForService("gutter_cleaning", "stories"), true);
});

Deno.test("required facts do not include optional ones", () => {
  const req = requiredFactsForService("house_wash");
  assertEquals(req.includes("house_sqft"), true);
  assertEquals(req.includes("stories"), true);
  assertEquals(req.includes("siding_material"), false);
});

Deno.test("stories is never stale; house_sqft is stale when missing verify date", () => {
  assertEquals(isStale("stories", null), false);
  assertEquals(isStale("house_sqft", null), true);
  assertEquals(isStale("house_sqft", new Date().toISOString()), false);
});