import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isEmailSuppressed,
  normalizeEmailAddr,
} from "./emailSuppression.ts";

Deno.test("normalizeEmailAddr lowercases + trims", () => {
  assertEquals(normalizeEmailAddr("  User@Example.COM "), "user@example.com");
  assertEquals(normalizeEmailAddr(""), null);
  assertEquals(normalizeEmailAddr(null), null);
  assertEquals(normalizeEmailAddr(undefined), null);
});

function suppressionClient(result: {
  data?: { reason: string } | null;
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

Deno.test("email suppression returns a readable positive match", async () => {
  const result = await isEmailSuppressed(
    "person@example.com",
    suppressionClient({ data: { reason: "unsubscribed" } }),
  );
  assertEquals(result, {
    suppressed: true,
    reason: "unsubscribed",
    readable: true,
  });
});

Deno.test("email suppression returns a readable negative match", async () => {
  const result = await isEmailSuppressed(
    "person@example.com",
    suppressionClient({ data: null }),
  );
  assertEquals(result, {
    suppressed: false,
    reason: null,
    readable: true,
  });
});

Deno.test("email suppression fails closed on returned database errors", async () => {
  const result = await isEmailSuppressed(
    "person@example.com",
    suppressionClient({ error: { message: "unavailable" } }),
  );
  assertEquals(result, {
    suppressed: true,
    reason: null,
    readable: false,
  });
});

Deno.test("email suppression fails closed on thrown database errors", async () => {
  const result = await isEmailSuppressed(
    "person@example.com",
    suppressionClient({ throws: true }),
  );
  assertEquals(result, {
    suppressed: true,
    reason: null,
    readable: false,
  });
});
