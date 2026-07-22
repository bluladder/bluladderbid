import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { renderWeatherDirective } from "./weatherStatus.ts";

Deno.test("renderWeatherDirective: normal status returns empty string", () => {
  assertEquals(renderWeatherDirective({ status: "normal", advisory_message: null }), "");
  assertEquals(renderWeatherDirective(null), "");
});

Deno.test("renderWeatherDirective: monitoring includes advisory verbatim", () => {
  const out = renderWeatherDirective({ status: "monitoring", advisory_message: "Storms expected Tuesday afternoon." });
  assertStringIncludes(out, "Current status: monitoring");
  assertStringIncludes(out, "Storms expected Tuesday afternoon.");
  assertStringIncludes(out, "Never invent forecast details");
});

Deno.test("renderWeatherDirective: paused status uses safe default when advisory missing", () => {
  const out = renderWeatherDirective({ status: "paused", advisory_message: null });
  assertStringIncludes(out, "paused");
  assertStringIncludes(out, "Outdoor services are on hold");
});

Deno.test("renderWeatherDirective: delayed status renders directive", () => {
  const out = renderWeatherDirective({ status: "delayed", advisory_message: "Morning slots may push 30-60 min." });
  assertStringIncludes(out, "Current status: delayed");
  assertStringIncludes(out, "Morning slots may push 30-60 min.");
});

