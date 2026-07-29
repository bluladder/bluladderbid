import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeSmsEventRequest } from "./sendSmsAuthorization.ts";

Deno.test("service callers may send trusted lifecycle events", async () => {
  const allowed = await authorizeSmsEventRequest(
    {
      serviceCaller: true,
      eventType: "appointment_scheduled",
      bookingId: "booking-1",
    },
    () => Promise.resolve(false),
  );

  assertEquals(allowed, true);
});

Deno.test("public booking lifecycle events are denied", async () => {
  let capabilityChecked = false;
  const allowed = await authorizeSmsEventRequest(
    {
      serviceCaller: false,
      eventType: "appointment_scheduled",
      bookingId: "booking-1",
    },
    () => {
      capabilityChecked = true;
      return Promise.resolve(true);
    },
  );

  assertFalse(allowed);
  assertFalse(capabilityChecked);
});

Deno.test("a raw public quote identifier is not authorization", async () => {
  const allowed = await authorizeSmsEventRequest(
    {
      serviceCaller: false,
      eventType: "quote_created",
      quoteId: "quote-1",
    },
    () => Promise.resolve(true),
  );

  assertFalse(allowed);
});

Deno.test("public quote sends require the capability for that exact quote", async () => {
  const checked: Array<[string, string]> = [];
  const allowed = await authorizeSmsEventRequest(
    {
      serviceCaller: false,
      eventType: "quote_created",
      quoteId: "quote-1",
      resumeToken: "capability-1",
    },
    (quoteId, resumeToken) => {
      checked.push([quoteId, resumeToken]);
      return Promise.resolve(quoteId === "quote-1" && resumeToken === "capability-1");
    },
  );

  assertEquals(allowed, true);
  assertEquals(checked, [["quote-1", "capability-1"]]);
});

Deno.test("an invalid quote capability fails closed", async () => {
  const allowed = await authorizeSmsEventRequest(
    {
      serviceCaller: false,
      eventType: "quote_created",
      quoteId: "quote-1",
      resumeToken: "wrong-capability",
    },
    () => Promise.resolve(false),
  );

  assertFalse(allowed);
});
