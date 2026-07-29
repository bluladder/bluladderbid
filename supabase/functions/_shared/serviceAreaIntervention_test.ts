import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordServiceAreaIntervention } from "./serviceAreaIntervention.ts";

const input = {
  requestFingerprint: "fingerprint-1",
  source: "public_one_time_booking" as const,
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  customerPhone: "+12145550100",
  propertyAddress: "123 Main St, Aubrey, TX 76227",
  services: [{ name: "Window Cleaning" }],
  total: 200,
  reasonCode: "configured_manual_review_county",
};

Deno.test("service-area intervention records a stable request key before claiming handoff", async () => {
  let inserted: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return {
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { id: "contact-1" }, error: null }),
          }),
        };
      },
    }),
  };
  assertEquals(
    await recordServiceAreaIntervention(client as never, input),
    {
      status: "recorded",
      interventionId: "contact-1",
      deduplicated: false,
    },
  );
  const captured = inserted as Record<string, unknown> | null;
  assertEquals(
    captured?.request_key,
    "service_area_review:fingerprint-1",
  );
  assertEquals(captured?.owner_notification_status, "pending");
});

Deno.test("service-area intervention deduplicates and reports persistence failure truthfully", async () => {
  const duplicate = {
    from: () => ({
      insert: () => ({
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: null, error: { code: "23505" } }),
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: "contact-1" }, error: null }),
        }),
      }),
    }),
  };
  assertEquals(
    await recordServiceAreaIntervention(duplicate as never, input),
    {
      status: "recorded",
      interventionId: "contact-1",
      deduplicated: true,
    },
  );

  const failed = {
    from: () => ({
      insert: () => ({
        select: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: null, error: { code: "42501" } }),
        }),
      }),
    }),
  };
  assertEquals(
    await recordServiceAreaIntervention(failed as never, input),
    { status: "failed" },
  );
});
