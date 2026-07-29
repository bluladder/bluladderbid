import fs from "node:fs";

const adapter = fs.readFileSync("supabase/functions/_shared/voiceBookingAdapter.ts", "utf8");
const tools = fs.readFileSync("supabase/functions/_shared/aiTools.ts", "utf8");
const pack = fs.readFileSync("docs/voice/real-call-acceptance.md", "utf8");

if (/VoiceBookingMode[^;]*live/.test(adapter)) throw new Error("live voice mode is representable");
if (!adapter.includes('"disabled" | "dry_run"')) throw new Error("safe modes missing");
if (!adapter.includes("authenticatedProviderEvent") || !adapter.includes("providerResourceTrusted")) {
  throw new Error("trusted provider boundary missing");
}
if (!adapter.includes("noProviderWrite: true")) throw new Error("no-write receipt missing");
if (!tools.includes("export function voiceLiveBookingEnabled(): boolean {\n  return false;")) {
  throw new Error("legacy live flag is not structurally disabled");
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
console.log("Voice booking repository contract OK: disabled/dry-run adapter and 15-scenario acceptance pack.");

