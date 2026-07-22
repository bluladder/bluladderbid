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
                const idx = o.indexOf(".eq.");
                if (idx < 0) return false;
                const field = o.slice(0, idx);
                const val = o.slice(idx + 4);
                return (field === "email" && id.email === val) ||
                       (field === "phone" && id.phone === val);
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

Deno.test("suppresses an approved test identity by email (no purpose)", async () => {
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

// ============================================================================
// Purpose-based allowlist: protected test identity + transactional purpose.
// ============================================================================
const TEST_ID = { email: "blmillen@gmail.com", phone: "+14692150144" };

Deno.test("allowlist: protected identity + booking_confirmed → allowed", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { email: TEST_ID.email }, { purpose: "booking_confirmed" });
  assertEquals(r.suppressed, false);
});

Deno.test("allowlist: protected identity + booking_updated → allowed", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { phone: TEST_ID.phone }, { purpose: "booking_updated" });
  assertEquals(r.suppressed, false);
});

Deno.test("allowlist: protected identity + booking_cancelled → allowed", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { phone: TEST_ID.phone }, { purpose: "booking_cancelled" });
  assertEquals(r.suppressed, false);
});

Deno.test("allowlist: protected identity + verification (OTP) → allowed", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { phone: TEST_ID.phone }, { purpose: "verification" });
  assertEquals(r.suppressed, false);
});

Deno.test("allowlist: protected identity + contact_request_received → allowed", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { email: TEST_ID.email }, { purpose: "contact_request_received" });
  assertEquals(r.suppressed, false);
});

Deno.test("allowlist: quote_requested REQUIRES customerInitiated=true", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const auto = await checkSuppression(c, { email: TEST_ID.email }, { purpose: "quote_requested" });
  assertEquals(auto.suppressed, true);
  assertEquals(auto.reason, "test_identity:purpose_not_allowlisted:quote_requested");
  const requested = await checkSuppression(
    c,
    { email: TEST_ID.email },
    { purpose: "quote_requested", customerInitiated: true },
  );
  assertEquals(requested.suppressed, false);
});

Deno.test("still blocked: protected identity + marketing/campaign (no purpose)", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { email: TEST_ID.email });
  assertEquals(r.suppressed, true);
  assertEquals(r.reason, "test_identity");
});

Deno.test("still blocked: protected identity + automated quote follow-up (no customerInitiated)", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(c, { email: TEST_ID.email }, { purpose: "quote_requested" });
  assertEquals(r.suppressed, true);
});

Deno.test("still blocked: protected identity + synthetic/QA send (unknown purpose)", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  // deno-lint-ignore no-explicit-any
  const r = await checkSuppression(c, { email: TEST_ID.email }, { purpose: "qa_smoke" as any });
  assertEquals(r.suppressed, true);
  assertEquals(r.reason, "test_identity:purpose_not_allowlisted:qa_smoke");
});

Deno.test("normal customer transactional sends remain unaffected", async () => {
  const c = fakeClient({ identities: [TEST_ID] });
  const r = await checkSuppression(
    c,
    { email: "real.customer@example.com" },
    { purpose: "booking_confirmed" },
  );
  assertEquals(r.suppressed, false);
});

Deno.test("admin kill-switch overrides transactional allowlist", async () => {
  const c = fakeClient({ suppressAll: true, identities: [TEST_ID] });
  const r = await checkSuppression(c, { email: TEST_ID.email }, { purpose: "booking_confirmed" });
  assertEquals(r.suppressed, true);
  assertEquals(r.reason, "admin_switch");
});
