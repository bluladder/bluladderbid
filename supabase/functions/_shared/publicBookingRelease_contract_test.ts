import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const bookingFunction = await Deno.readTextFile(
  new URL("../jobber-create-booking/index.ts", import.meta.url),
);
const bookingFlow = await Deno.readTextFile(
  new URL("../../../src/components/booking/BookingFlow.tsx", import.meta.url),
);

Deno.test("service mutations invalidate a previously selected slot", () => {
  const handler = bookingFlow.indexOf(
    "handlePostSlotAdditionalServiceChange",
  );
  const upsell = bookingFlow.indexOf(
    "onAdd={handlePostSlotAdditionalServiceChange}",
  );
  assert(handler >= 0);
  assert(upsell > handler);
  const body = bookingFlow.slice(handler, upsell);
  assert(body.includes("setSelectedSlot(null)"));
  assert(body.includes("Please choose a new time"));
});

Deno.test("server verifies authoritative duration before provider work", () => {
  const durationGate = bookingFunction.indexOf("SLOT_DURATION_MISMATCH");
  const firstJobberClientWrite = bookingFunction.indexOf(
    "mutation CreateClient",
  );
  assert(durationGate >= 0);
  assert(firstJobberClientWrite > durationGate);
  assert(
    bookingFunction.includes("authoritativeBookingDurationMinutes"),
  );
  assert(bookingFunction.includes("scheduledIntervalMinutes"));
});

Deno.test("authoritative booking logs exclude customer and provider payloads", () => {
  for (
    const forbidden of [
      "customerEmail: booking.customer?.email",
      "Looking up customer by email:",
      "Client creation input:",
      "Property creation input:",
      "Job creation input:",
      "Visit creation input:",
      'console.log("Jobber client search result:", JSON.stringify',
      'console.log("Client properties result:", JSON.stringify',
      'console.log("Job creation result:", JSON.stringify',
      'console.log("Visit creation result:", JSON.stringify',
      'console.error("Booking creation error:", error)',
      "error.stack",
    ]
  ) {
    assertEquals(
      bookingFunction.includes(forbidden),
      false,
      `unsafe log remains: ${forbidden}`,
    );
  }
});
