import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isDeletableTestIdentity,
  isProtectedTestIdentity,
  partitionTestIdentitiesForCleanup,
  type TestIdentityRow,
} from "./testCleanup.ts";

const APPROVED: TestIdentityRow = {
  id: "approved",
  email: "blmillen@gmail.com",
  phone: "+14692150144",
  protected: true,
  note: "Owner-approved permanent end-to-end test identity.",
};

const TEMP: TestIdentityRow = {
  id: "temp",
  email: "verify-temp@example.com",
  phone: "+12145550000",
  protected: false,
  note: "temporary verification run",
};

Deno.test("approved identity is protected and never deletable", () => {
  assertEquals(isProtectedTestIdentity(APPROVED), true);
  assertEquals(isDeletableTestIdentity(APPROVED), false);
});

Deno.test("temporary verification records remain deletable", () => {
  assertEquals(isProtectedTestIdentity(TEMP), true === false);
  assertEquals(isDeletableTestIdentity(TEMP), true);
});

Deno.test("REGRESSION: approved identity survives a broad cleanup pass", () => {
  // Simulate a cleanup that would otherwise wipe every test identity.
  const { deletable, preserved } = partitionTestIdentitiesForCleanup([APPROVED, TEMP]);

  // Only the temporary record may be deleted.
  assertEquals(deletable.map((r) => r.id), ["temp"]);

  // The owner-approved permanent identity is preserved — this is the exact
  // failure that previously disabled suppression for a real recipient.
  assertEquals(preserved.map((r) => r.id), ["approved"]);
  assertEquals(preserved[0].email, "blmillen@gmail.com");
  assertEquals(preserved[0].phone, "+14692150144");
});

Deno.test("missing protected flag defaults to deletable (temporary)", () => {
  const legacy: TestIdentityRow = { id: "legacy", email: "x@y.com" };
  assertEquals(isDeletableTestIdentity(legacy), true);
});
