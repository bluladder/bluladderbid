import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toAuthoritativeServiceItems } from "./authoritativeQuotePresentation.ts";

Deno.test("one-time presentation uses only authoritative line items", () => {
  assertEquals(
    toAuthoritativeServiceItems(
      [
        { label: "Window cleaning", amount: 249 },
        { label: "", amount: 1 },
        { unexpected: "caller text" },
      ],
      "one_time",
    ),
    [{ name: "Window cleaning", amount: 249 }],
  );
});

Deno.test("recurring presentation preserves authoritative frequency and totals", () => {
  assertEquals(
    toAuthoritativeServiceItems(
      [{
        label: "Quarterly exterior windows",
        frequency: 4,
        perVisitAmount: 150,
        annualAmount: 600,
      }],
      "recurring_plan",
    ),
    [{
      name: "Quarterly exterior windows",
      frequency: 4,
      pricePerVisit: 150,
      annualTotal: 600,
    }],
  );
});

Deno.test("presentation may use the authoritative Jobber label fallback", () => {
  assertEquals(
    toAuthoritativeServiceItems(
      [{
        jobberLineItem: { name: "House wash" },
        amount: 325,
      }],
      "one_time",
    ),
    [{ name: "House wash", amount: 325 }],
  );
});
