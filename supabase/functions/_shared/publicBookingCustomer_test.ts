import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  findMatchingJobberProperties,
  findMatchingJobberProperty,
  normalizeUsPhone,
  parseServiceAddress,
  resolveJobberClientByExactEmail,
  resolveJobberClientByVerifiedContact,
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

Deno.test("duplicate provider properties remain explicit instead of selecting the first", () => {
  const expected = parseServiceAddress("123 Main St, Aubrey, TX 76227");
  assert(expected);
  const duplicates = findMatchingJobberProperties(expected, [
    {
      id: "property-1",
      address: {
        street: "123 Main St",
        city: "Aubrey",
        province: "TX",
        postalCode: "76227",
      },
    },
    {
      id: "property-2",
      address: {
        street: "123 Main St.",
        city: "AUBREY",
        province: "tx",
        postalCode: "76227-1234",
      },
    },
  ]);
  assertEquals(duplicates.map((property) => property.id), [
    "property-1",
    "property-2",
  ]);
});

Deno.test("Jobber client resolution requires one exact normalized email", () => {
  assertEquals(
    resolveJobberClientByExactEmail("verified@example.com", [{
      id: "fuzzy-result",
      emails: [{ address: "other@example.com" }],
    }]),
    { status: "missing" },
  );
  assertEquals(
    resolveJobberClientByExactEmail(" VERIFIED@EXAMPLE.COM ", [{
      id: "exact-result",
      emails: [{ address: "verified@example.com" }],
    }]),
    { status: "resolved", clientId: "exact-result" },
  );
  assertEquals(
    resolveJobberClientByExactEmail("verified@example.com", [
      { id: "duplicate-1", emails: [{ address: "verified@example.com" }] },
      { id: "duplicate-2", emails: [{ address: "VERIFIED@EXAMPLE.COM" }] },
    ]),
    { status: "ambiguous" },
  );
});

Deno.test("Jobber client reuse requires verified name, email, and phone", () => {
  const expected = {
    firstName: "Alex",
    lastName: "Homeowner",
    email: "verified@example.com",
    phone: "+14695551212",
    address: "123 Main St, Aubrey, TX 76227",
  };
  const matching = {
    id: "verified-client",
    firstName: " alex ",
    lastName: "HOMEOWNER",
    emails: [{ address: "VERIFIED@example.com" }],
    phones: [{ number: "(469) 555-1212" }],
  };
  assertEquals(
    resolveJobberClientByVerifiedContact(expected, [matching]),
    { status: "resolved", clientId: "verified-client" },
  );
  assertEquals(
    resolveJobberClientByVerifiedContact(expected, [{
      ...matching,
      firstName: "Different",
    }]),
    { status: "conflict" },
  );
  assertEquals(
    resolveJobberClientByVerifiedContact(expected, [{
      ...matching,
      phones: [{ number: "+14695550000" }],
    }]),
    { status: "conflict" },
  );
  assertEquals(
    resolveJobberClientByVerifiedContact(expected, [
      matching,
      { ...matching, id: "duplicate-client" },
    ]),
    { status: "ambiguous" },
  );
});
