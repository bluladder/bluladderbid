import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkPhoneOptOut,
  getCustomerPause,
  isPhoneOptedOut,
} from "./sms.ts";

function queryClient(result: {
  data?: Record<string, unknown> | null;
  error?: { message: string } | null;
  throws?: boolean;
}) {
  return {
    from() {
      if (result.throws) throw new Error("database unavailable");
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: result.data ?? null,
            error: result.error ?? null,
          });
        },
      };
      return query;
    },
  };
}

Deno.test("phone opt-out returns readable positive and negative states", async () => {
  assertEquals(
    await checkPhoneOptOut(
      queryClient({ data: { opted_out: true } }),
      "+14697472877",
    ),
    { optedOut: true, readable: true },
  );
  assertEquals(
    await checkPhoneOptOut(
      queryClient({ data: null }),
      "+14697472877",
    ),
    { optedOut: false, readable: true },
  );
});

Deno.test("phone opt-out fails closed on returned and thrown errors", async () => {
  assertEquals(
    await checkPhoneOptOut(
      queryClient({ error: { message: "unavailable" } }),
      "+14697472877",
    ),
    { optedOut: true, readable: false },
  );
  assertEquals(
    await checkPhoneOptOut(
      queryClient({ throws: true }),
      "+14697472877",
    ),
    { optedOut: true, readable: false },
  );
  assertEquals(
    await isPhoneOptedOut(
      queryClient({ error: { message: "unavailable" } }),
      "+14697472877",
    ),
    true,
  );
});

Deno.test("customer channel pause returns readable state", async () => {
  assertEquals(
    await getCustomerPause(
      queryClient({
        data: { sms_paused: true, email_paused: false },
      }),
      { id: "customer-1" },
    ),
    { sms_paused: true, email_paused: false, readable: true },
  );
});

Deno.test("customer channel pause fails closed on unreadable state", async () => {
  assertEquals(
    await getCustomerPause(
      queryClient({ error: { message: "unavailable" } }),
      { id: "customer-1" },
    ),
    { sms_paused: true, email_paused: true, readable: false },
  );
  assertEquals(
    await getCustomerPause(
      queryClient({ throws: true }),
      { email: "person@example.com" },
    ),
    { sms_paused: true, email_paused: true, readable: false },
  );
});
