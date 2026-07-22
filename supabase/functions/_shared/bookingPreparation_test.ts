// Deno unit tests for booking preparation. Pure logic only — no DB.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPrepBlocks,
  renderPrepHtml,
  resolveServiceKey,
  type PrepConfig,
} from "./bookingPreparation.ts";

const CONFIGS: PrepConfig[] = [
  { service_key: "window_cleaning", display_name: "Window Cleaning", is_active: true, sort_order: 10, instructions: ["Unlock gates", "Secure pets"] },
  { service_key: "house_wash",       display_name: "House Wash",       is_active: true, sort_order: 20, instructions: ["Close windows"] },
  { service_key: "pressure_washing", display_name: "Pressure Washing", is_active: true, sort_order: 30, instructions: ["Clear items"] },
  { service_key: "roof_cleaning",    display_name: "Roof",             is_active: false, sort_order: 40, instructions: ["Should not appear"] },
];

Deno.test("resolveServiceKey fuzzy-matches display names", () => {
  assertEquals(resolveServiceKey({ name: "Window Cleaning (Exterior)" }), "window_cleaning");
  assertEquals(resolveServiceKey({ name: "House Wash / Soft Wash" }), "house_wash");
  assertEquals(resolveServiceKey({ name: "Driveway pressure cleaning" }), "driveway_cleaning");
  assertEquals(resolveServiceKey({ name: "Gutter cleaning" }), "gutter_cleaning");
  assertEquals(resolveServiceKey({ name: "Pressure washing patio" }), "pressure_washing");
  assertEquals(resolveServiceKey({ name: "Roof soft wash" }), "roof_cleaning");
  assertEquals(resolveServiceKey({ name: "Unrelated service" }), null);
});

Deno.test("buildPrepBlocks: preparation is service-specific", () => {
  const blocks = buildPrepBlocks(
    [{ name: "Window Cleaning (Exterior)" }],
    CONFIGS,
  );
  assertEquals(blocks.length, 1);
  assertEquals(blocks[0].service_key, "window_cleaning");
});

Deno.test("buildPrepBlocks: deduplicates when two lines resolve to same key", () => {
  const blocks = buildPrepBlocks(
    [{ name: "Window Cleaning (Exterior)" }, { name: "Window Cleaning (Interior)" }],
    CONFIGS,
  );
  assertEquals(blocks.length, 1);
});

Deno.test("buildPrepBlocks: inactive configs are omitted", () => {
  const blocks = buildPrepBlocks(
    [{ name: "Roof cleaning" }],
    CONFIGS,
  );
  assertEquals(blocks.length, 0);
});

Deno.test("buildPrepBlocks: unrelated services produce empty output", () => {
  const blocks = buildPrepBlocks([{ name: "Random" }], CONFIGS);
  assertEquals(blocks.length, 0);
});

Deno.test("renderPrepHtml: no blocks -> empty string (caller decides fallback)", () => {
  assertEquals(renderPrepHtml([]), "");
});

Deno.test("renderPrepHtml: escapes HTML in instructions", () => {
  const html = renderPrepHtml([{
    service_key: "x", display_name: "<b>X</b>", is_active: true, sort_order: 1,
    instructions: ["<script>alert(1)</script>"],
  }]);
  // Both the display name and the instruction must be escaped.
  assertEquals(html.includes("<script>"), false);
  assertEquals(html.includes("&lt;script&gt;"), true);
  assertEquals(html.includes("&lt;b&gt;X&lt;/b&gt;"), true);
});