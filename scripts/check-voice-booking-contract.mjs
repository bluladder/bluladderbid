import fs from "node:fs";

const adapter = fs.readFileSync("supabase/functions/_shared/voiceBookingAdapter.ts", "utf8");
const tools = fs.readFileSync("supabase/functions/_shared/aiTools.ts", "utf8");
const pack = fs.readFileSync("docs/voice/real-call-acceptance.md", "utf8");

if (!adapter.includes('"disabled" | "dry_run" | "live"')) {
  throw new Error("voice booking modes must be disabled | dry_run | live");
}
if (!adapter.includes('if (mode !== "dry_run" && mode !== "live")')) {
  throw new Error("adapter must block modes outside dry_run/live");
}
if (!adapter.includes("authenticatedProviderEvent") || !adapter.includes("providerResourceTrusted")) {
  throw new Error("trusted provider boundary missing");
}
if (!adapter.includes('noProviderWrite: mode !== "live"')) {
  throw new Error("no-write receipt must be derived from the resolved mode");
}
// Live voice booking must never be unlockable by the flag alone: the flag and
// the caller allowlist are two independent required conditions.
if (!tools.includes("export function voiceBookingCallerAllowlisted(")) {
  throw new Error("voice caller allowlist guard missing");
}
if (!tools.includes("VOICE_WORKFLOW_CONTROLLER_ALLOWLIST")) {
  throw new Error("voice booking must consult the controller allowlist");
}
if (
  !tools.includes(
    "voiceLiveBookingEnabled() && voiceBookingCallerAllowlisted(phone)",
  )
) {
  throw new Error("live lane must require flag AND allowlisted caller");
}
for (let i = 1; i <= 15; i++) {
  if (!pack.includes(`| ${i} |`)) throw new Error(`acceptance scenario ${i} missing`);
}
for (const heading of [
  "Spoken scenario",
  "Expected agent behavior",
  "Expected state",
  "Expected communication",
  "Expected diagnostic",
  "Stop conditions",
]) {
  if (!pack.includes(heading)) throw new Error(`acceptance field missing: ${heading}`);
}
console.log(
  "Voice booking repository contract OK: disabled/dry-run/live adapter, allowlist-gated live lane, 15-scenario acceptance pack.",
);

