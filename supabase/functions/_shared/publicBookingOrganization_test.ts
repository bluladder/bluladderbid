import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isTenantFoundationAbsent,
  resolvePublicBookingOrganization,
} from "./publicBookingOrganization.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "./publicBookingServiceArea.ts";

Deno.test("tenant foundation absence is distinguished from lookup failure", () => {
  assertEquals(isTenantFoundationAbsent({ code: "PGRST205" }), true);
  assertEquals(isTenantFoundationAbsent({ code: "42P01" }), true);
  assertEquals(isTenantFoundationAbsent({ code: "42501" }), false);
  assertEquals(isTenantFoundationAbsent(null), false);
});

Deno.test("organization resolution preserves pre-migration DFW compatibility only when table is absent", async () => {
  const missing = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: null,
              error: { code: "PGRST205", message: "table missing" },
            }),
        }),
      }),
    }),
  };
  assertEquals(
    await resolvePublicBookingOrganization(missing as never),
    {
      status: "resolved",
      organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
      tenantFoundationAvailable: false,
    },
  );
});

Deno.test("organization resolution fails closed for inactive or failed hosted foundation", async () => {
  const client = (data: unknown, error: unknown) => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error }),
        }),
      }),
    }),
  });
  assertEquals(
    await resolvePublicBookingOrganization(
      client(
        { id: PUBLIC_BOOKING_ORGANIZATION_ID, status: "suspended" },
        null,
      ) as never,
    ),
    { status: "unavailable", code: "ORGANIZATION_INACTIVE" },
  );
  assertEquals(
    await resolvePublicBookingOrganization(
      client(null, { code: "42501" }) as never,
    ),
    { status: "unavailable", code: "ORGANIZATION_LOOKUP_UNAVAILABLE" },
  );
});
