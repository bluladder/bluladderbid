import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findMatchingJobberProperty,
  normalizeUsPhone,
  parseServiceAddress,
  validatePublicBookingCustomer,
} from "./publicBookingCustomer.ts";

Deno.test("valid DFW customer is normalized without changing the address", () => {
  const result = validatePublicBookingCustomer({
    firstName: "  Alex ",
    lastName: " Homeowner ",
    email: " ALEX@EXAMPLE.COM ",
    phone: "(469) 555-1212",
    address: "123 Main St, Aubrey, TX 76227",
  });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.customer, {
    firstName: "Alex",
    lastName: "Homeowner",
    email: "alex@example.com",
    phone: "+14695551212",
    address: "123 Main St, Aubrey, TX 76227",
  });
});

Deno.test("phone normalization rejects alphabetic, short, and international input", () => {
  assertEquals(normalizeUsPhone("469-CALL-NOW"), null);
  assertEquals(normalizeUsPhone("5551212"), null);
  assertEquals(normalizeUsPhone("+44 20 7946 0958"), null);
  assertEquals(normalizeUsPhone("1 469 555 1212"), "+14695551212");
});

Deno.test("address shape validation fails closed while geography remains a server routing decision", () => {
  assertEquals(parseServiceAddress("123 Main St"), null);
  const parsedOregon = validatePublicBookingCustomer({
    firstName: "Alex",
    lastName: "Homeowner",
    email: "alex@example.com",
    phone: "4695551212",
    address: "123 Main St, Portland, OR 97201",
  });
  assert(parsedOregon.ok);
  if (!parsedOregon.ok) return;
  assertEquals(parsedOregon.address.province, "OR");
});

Deno.test("property matching chooses the submitted address, not the first property", () => {
  const expected = parseServiceAddress("123 Main St, Aubrey, TX 76227");
  assert(expected);
  const match = findMatchingJobberProperty(expected, [
    {
      id: "wrong-first-property",
      address: {
        street: "9 Old Address Rd",
        city: "Denton",
        province: "TX",
        postalCode: "76201",
      },
    },
    {
      id: "submitted-property",
      address: {
        street: "123 Main St.",
        city: "AUBREY",
        province: "tx",
        postalCode: "76227-1234",
      },
    },
  ]);
  assertEquals(match?.id, "submitted-property");
});

Deno.test("property matching returns null for unknown address", () => {
  const expected = parseServiceAddress("123 Main St, Aubrey, TX 76227");
  assert(expected);
  assertEquals(findMatchingJobberProperty(expected, []), null);
});
