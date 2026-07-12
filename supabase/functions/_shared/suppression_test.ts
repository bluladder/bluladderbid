import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkSuppression, normalizeEmail, normalizePhoneE164 } from "./suppression.ts";

// Minimal fake Supabase client returning canned test_identities / config.
function fakeClient(opts: {
  suppressAll?: boolean;
  identities?: { email?: string; phone?: string }[];
}) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        select() { return builder; },
        eq() { return builder; },
        _ors: [] as string[],
        or(s: string) { builder._ors = s.split(","); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          if (table === "system_test_config") {
            return { data: { suppress_all: !!opts.suppressAll, suppress_reason: "admin_switch" }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (v: any) => void) {
          // Used when the query is awaited directly (test_identities .or().limit()).
          if (table === "test_identities") {
            const matches = (opts.identities ?? []).filter((id) =>
              builder._ors.some((o: string) => {
                const [, , val] = o.split(".");
                return (id.email && `email` && o.startsWith("email.eq.") && id.email === val) ||
                       (id.phone && o.startsWith("phone.eq.") && id.phone === val);
              })
            );
            resolve({ data: matches, error: null });
          } else {
            resolve({ data: null, error: null });
          }
        },
      };
      return builder;
    },
  } as any;
}

Deno.test("normalizers", () => {
  assertEquals(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
  assertEquals(normalizePhoneE164("(469) 215-0144"), "+14692150144");
  assertEquals(normalizePhoneE164("4692150144"), "+14692150144");
});

Deno.test("suppresses an approved test identity by email", async () => {
  const c = fakeClient({ identities: [{ email: "blmillen@gmail.com", phone: "+14692150144" }] });
  const r = await checkSuppression(c, { email: "BLMillen@gmail.com" });
  assertEquals(r.suppressed, true);
  assertEquals(r.reason, "test_identity");
});

Deno.test("suppresses an approved test identity by phone", async () => {
  const c = fakeClient({ identities: [{ email: "blmillen@gmail.com", phone: "+14692150144" }] });
  const r = await checkSuppression(c, { phone: "469-215-0144" });
  assertEquals(r.suppressed, true);
});

Deno.test("does NOT suppress a real customer", async () => {
  const c = fakeClient({ identities: [{ email: "blmillen@gmail.com", phone: "+14692150144" }] });
  const r = await checkSuppression(c, { email: "real.customer@example.com", phone: "+12145559999" });
  assertEquals(r.suppressed, false);
});

Deno.test("global switch suppresses everyone", async () => {
  const c = fakeClient({ suppressAll: true });
  const r = await checkSuppression(c, { email: "real.customer@example.com" });
  assertEquals(r.suppressed, true);
  assertEquals(r.reason, "admin_switch");
});
