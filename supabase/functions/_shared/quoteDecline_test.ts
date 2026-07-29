import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  canDeclineQuote,
  classifyQuoteDecline,
  quoteLifecycleAllowsCampaignDelivery,
} from "./quoteDecline.ts";

const NOW = Date.parse("2026-07-29T05:00:00.000Z");

Deno.test("quote decline authorization requires privilege or exact capability", () => {
  assertEquals(canDeclineQuote(false, false), false);
  assertEquals(canDeclineQuote(false, true), true);
  assertEquals(canDeclineQuote(true, false), true);
  assertEquals(canDeclineQuote(true, true), true);
});

Deno.test("quote decline allows only active customer-facing states", () => {
  for (const status of ["pending", "viewed", "saved", "emailed"]) {
    assertEquals(
      classifyQuoteDecline({ status, expires_at: "2026-07-30T00:00:00.000Z" }, NOW),
      "eligible",
    );
  }
});

Deno.test("quote decline fails closed for converted lineage", () => {
  assertEquals(classifyQuoteDecline({ status: "converted" }, NOW), "already_converted");
  assertEquals(
    classifyQuoteDecline({ status: "saved", converted_booking_id: "booking-1" }, NOW),
    "already_converted",
  );
});

Deno.test("quote decline replay preserves an existing decline", () => {
  assertEquals(classifyQuoteDecline({ status: "declined" }, NOW), "already_declined");
});

Deno.test("quote decline rejects expired quotes by status or timestamp", () => {
  assertEquals(classifyQuoteDecline({ status: "expired" }, NOW), "expired");
  assertEquals(
    classifyQuoteDecline({ status: "saved", expires_at: "2026-07-29T05:00:00.000Z" }, NOW),
    "expired",
  );
});

Deno.test("quote decline rejects missing and unknown states", () => {
  assertEquals(classifyQuoteDecline({}, NOW), "state_conflict");
  assertEquals(classifyQuoteDecline({ status: "manual_review_required" }, NOW), "state_conflict");
  assertEquals(
    classifyQuoteDecline({ status: "saved", expires_at: "not-a-timestamp" }, NOW),
    "state_conflict",
  );
});

Deno.test("quote lifecycle blocks stale campaign delivery at terminal states", () => {
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery({ status: "declined" }, "quote_calculated"),
    false,
  );
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery({ status: "declined" }, "quote_declined"),
    true,
  );
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery(
      { status: "saved", converted_booking_id: "b1" },
      "quote_declined",
    ),
    false,
  );
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery({ status: "converted" }, "booking_completed"),
    true,
  );
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery({ status: "expired" }, "quote_declined"),
    false,
  );
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery({ status: "unknown" }, "quote_calculated"),
    false,
  );
  assertEquals(
    quoteLifecycleAllowsCampaignDelivery({ status: "emailed" }, "quote_calculated"),
    true,
  );
});
