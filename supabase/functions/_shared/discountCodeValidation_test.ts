import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAuthoritativeDiscountCode, validateDiscountCodeAuthoritatively } from "./discountCodeValidation.ts";

function supabaseFor(rows: Record<string, unknown>[], error: unknown = null) {
  const writes: string[] = [];
  const sb = {
    writes,
    from(table: string) {
      const filter: Record<string, unknown> = {};
      return {
        select() {
          return this;
        },
        eq(key: string, value: unknown) {
          filter[key] = value;
          return this;
        },
        insert() {
          writes.push(`${table}.insert`);
          return this;
        },
        update() {
          writes.push(`${table}.update`);
          return this;
        },
        delete() {
          writes.push(`${table}.delete`);
          return this;
        },
        upsert() {
          writes.push(`${table}.upsert`);
          return this;
        },
        maybeSingle() {
          if (error) return Promise.resolve({ data: null, error });
          const matches = rows.filter((row) =>
            Object.entries(filter).every(([key, value]) => row[key] === value),
          );
          if (matches.length > 1) {
            return Promise.resolve({ data: null, error: { code: "PGRST116" } });
          }
          return Promise.resolve({ data: matches[0] ?? null, error: null });
        },
      };
    },
    rpc(name: string) {
      writes.push(`rpc:${name}`);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return sb;
}

const NOW = new Date("2026-08-05T12:00:00.000Z");
const base = {
  code: "SAVE10",
  discount_type: "percentage",
  discount_value: 10,
  is_active: true,
  expires_at: "2026-08-06T00:00:00.000Z",
  usage_count: 0,
  max_uses: null,
};

Deno.test(
  "discount validator rejects unknown inactive expiration boundary bad expiry exhausted and malformed usage",
  async () => {
    assertEquals(
      await validateDiscountCodeAuthoritatively(supabaseFor([]), "SAVE10", {
        now: NOW,
      }),
      {
        status: "invalid",
        code: "SAVE10",
        reason: "unknown",
      },
    );
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, is_active: false }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "inactive",
    );
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, expires_at: NOW.toISOString() }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "expired",
    );
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, expires_at: "not-a-date" }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "uncertain",
    );
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, usage_count: 5, max_uses: 5 }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "exhausted",
    );
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, usage_count: null, max_uses: 5 }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "uncertain",
    );
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, usage_count: 0, max_uses: "bad" }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "uncertain",
    );
  },
);

Deno.test(
  "discount validator rejects bad amounts query and multiple rows while producing zero writes",
  async () => {
    for (const row of [
      { ...base, discount_value: 101 },
      { ...base, discount_value: 0 },
      { ...base, discount_value: -1 },
      { ...base, discount_type: "bogus" },
    ]) {
      assertEquals(
        (
          (await validateDiscountCodeAuthoritatively(
            supabaseFor([row]),
            "SAVE10",
            { now: NOW },
          )) as any
        ).reason,
        "uncertain",
      );
    }
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([], { message: "db" }),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "uncertain",
    );
    const multi = supabaseFor([base, base]);
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(multi, "SAVE10", {
          now: NOW,
        })) as any
      ).reason,
      "uncertain",
    );
    assertEquals(multi.writes, []);
  },
);

Deno.test(
  "discount validator accepts valid percentage and fixed values",
  async () => {
    assertEquals(
      await validateDiscountCodeAuthoritatively(supabaseFor([base]), "save10", {
        now: NOW,
      }),
      {
        status: "valid",
        code: "SAVE10",
        discountType: "percentage",
        discountValue: 10,
      },
    );
    assertEquals(
      await validateDiscountCodeAuthoritatively(
        supabaseFor([
          { ...base, code: "FIVE", discount_type: "fixed", discount_value: 5 },
        ]),
        "FIVE",
        { now: NOW },
      ),
      {
        status: "valid",
        code: "FIVE",
        discountType: "fixed",
        discountValue: 5,
      },
    );
  },
);


Deno.test("discount validator rejects malformed separators before lookup", async () => {
  for (const code of ["SAVE-10", "SAVE_10", "SAVE 10", "SAVE.10"]) {
    let reads = 0;
    const sb = {
      from() {
        reads += 1;
        throw new Error("lookup_must_not_run");
      },
    };
    assertEquals(normalizeAuthoritativeDiscountCode(code), null);
    assertEquals(
      await validateDiscountCodeAuthoritatively(sb, code, { now: NOW }),
      { status: "invalid", code: code.toUpperCase().trim(), reason: "unknown" },
    );
    assertEquals(reads, 0);
  }
});

Deno.test("discount validator requires safe integer usage fields and fail-closed clocks", async () => {
  for (const usage_count of [null, undefined, "", "2", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, usage_count, max_uses: 5 }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "uncertain",
    );
  }
  for (const max_uses of ["", "5", 5.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertEquals(
      (
        (await validateDiscountCodeAuthoritatively(
          supabaseFor([{ ...base, usage_count: 0, max_uses }]),
          "SAVE10",
          { now: NOW },
        )) as any
      ).reason,
      "uncertain",
    );
  }
  const throwingClock = supabaseFor([base]);
  assertEquals(
    (
      (await validateDiscountCodeAuthoritatively(throwingClock, "SAVE10", {
        now: () => {
          throw new Error("clock");
        },
      })) as any
    ).reason,
    "uncertain",
  );
  assertEquals(throwingClock.writes, []);
  const invalidClock = supabaseFor([base]);
  assertEquals(
    (
      (await validateDiscountCodeAuthoritatively(invalidClock, "SAVE10", {
        now: () => new Date("bad"),
      })) as any
    ).reason,
    "uncertain",
  );
  assertEquals(invalidClock.writes, []);
});
