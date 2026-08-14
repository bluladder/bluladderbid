import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  implementation:
    "supabase/functions/_shared/jobtreadKlamathProtectedConfiguration.ts",
  tests:
    "supabase/functions/_shared/jobtreadKlamathProtectedConfiguration_test.ts",
  contract:
    "docs/architecture/bluladder-klamath-jobtread-protected-configuration.md",
  composition: "supabase/functions/_shared/jobtreadExecutionComposition.ts",
};
const contents = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else contents[key] = fs.readFileSync(full, "utf8");
}

for (const phrase of [
  "bluladder-klamath-jobtread-production-v1",
  "JOBTREAD_KLAMATH_GRANT_KEY",
  "JOBTREAD_KLAMATH_PROVIDER_ORGANIZATION_ID",
  "JOBTREAD_KLAMATH_CUSTOMER_REFERENCE_FIELD_ID",
  "JOBTREAD_KLAMATH_CONTACT_PHONE_FIELD_ID",
  "JOBTREAD_KLAMATH_CONTACT_EMAIL_FIELD_ID",
  "JOBTREAD_KLAMATH_LOCATION_REFERENCE_FIELD_ID",
  "JOBTREAD_KLAMATH_BOOKING_REFERENCE_FIELD_ID",
  "BluLadder Customer Reference",
  "BluLadder Location Reference",
  "BluLadder Booking Reference",
  "providerOrganizationFingerprint",
  "new Set(Object.values(normalizedBindings)).size !== 5",
]) {
  if (!contents.implementation?.includes(phrase)) {
    errors.push(`protected configuration omits ${phrase}`);
  }
}
for (const phrase of [
  "exact non-secret configuration",
  "another organization or reference",
  "missing, duplicate, or malformed authority",
  "preserves exact secret and rejects unsafe forms",
  "custom-field contract is exact and non-sensitive",
]) {
  if (!contents.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  "runtime and traffic disabled",
  "controlled security boundary stopped transmission",
  "lowercase SHA-256",
  "not imported by a production entry point",
]) {
  if (!contents.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
if (!contents.composition?.includes("No production Edge entry point imports this factory")) {
  errors.push("dormant execution boundary drifted");
}
if (/Deno\.env\.get\(["']JOBTREAD_KLAMATH_GRANT_KEY["']\)/.test(
  contents.implementation ?? "",
)) {
  errors.push("implementation bypasses the injected protected environment reader");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread protected configuration OK: exact environment and field contract prepared; provider runtime and traffic remain disabled.",
);
