import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const endpoint = await Deno.readTextFile(
  new URL("../admin-diagnostics/index.ts", import.meta.url),
);
const panel = await Deno.readTextFile(
  new URL(
    "../../../src/components/admin/ops/CallRailDurabilityPanel.tsx",
    import.meta.url,
  ),
);

Deno.test("admin diagnostics fails closed on durability read errors", () => {
  assertStringIncludes(endpoint, "if (error) throw new Error");
  assertStringIncludes(endpoint, 'error: "diagnostics_unavailable"');
  assertStringIncludes(endpoint, "status: 503");
  assertStringIncludes(endpoint, "auto_retries_enabled: null");
  assertEquals(endpoint.includes("auto_retries_enabled: true"), false);
});

Deno.test("launch gate display requires fresh, exact production identity", () => {
  assertStringIncludes(endpoint, "EXPECTED_SUPABASE_PROJECT_REF");
  assertStringIncludes(endpoint, "PUBLIC_BOOKING_GATE_DEPLOYMENT_ID");
  assertStringIncludes(panel, "diagnosticAgeMs <= 120_000");
  assertStringIncludes(panel, "diag?.environment === 'production'");
  assertStringIncludes(panel, "project_ref_verified === true");
  assertStringIncludes(panel, "deployment_id_verified === true");
  assertStringIncludes(panel, "'UNKNOWN — RELEASE BLOCKED'");
});

Deno.test("event query failure is not rendered as a healthy empty queue", () => {
  assertStringIncludes(panel, "if (eventsError)");
  assertStringIncludes(panel, "setRowsAvailable(false)");
  assertStringIncludes(
    panel,
    "Event diagnostics unavailable — release status is unknown.",
  );
  assertStringIncludes(panel, "rowsAvailable && rows.length === 0");
});
