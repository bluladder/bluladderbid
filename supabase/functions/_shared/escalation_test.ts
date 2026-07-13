import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAlertMessage, SEVERITY_RANK } from "./escalation.ts";

Deno.test("alert message includes safe fields only", () => {
  const msg = buildAlertMessage(
    { category: "complaint", severity: "high", prospectName: "Sam", prospectPhone: "+14690000000", summary: "Unhappy with streaks" },
    "(866) 242-2583",
    "Open the dashboard.",
  );
  assertEquals(msg.includes("BluLadder AI escalation"), true);
  assertEquals(msg.includes("Sam"), true);
  assertEquals(msg.includes("+14690000000"), true);
  assertEquals(msg.includes("complaint"), true);
  // Must never leak keys/prompts/transcripts.
  assertEquals(/api|prompt|transcript|margin/i.test(msg), false);
});

Deno.test("severity ranking supports one higher-severity re-alert", () => {
  assertEquals(SEVERITY_RANK.urgent > SEVERITY_RANK.normal, true);
  assertEquals(SEVERITY_RANK.high > SEVERITY_RANK.low, true);
});
