import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract:
    "docs/architecture/bluladder-klamath-launch-input-contract.md",
  template:
    "docs/operations/bluladder-klamath-launch-inputs.template.json",
  implementation:
    "packages/tenant-config/bluladderKlamathLaunchInputs.ts",
  tests:
    "packages/tenant-config/bluladderKlamathLaunchInputs.test.ts",
  tenant: "packages/tenant-config/bluladderKlamath.ts",
};

const errors = [];
const content = {};
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

let template;
try {
  template = JSON.parse(content.template ?? "{}");
} catch (error) {
  errors.push(`launch-input template is invalid JSON: ${error.message}`);
}

const forbiddenKey =
  /^(?:secret|secret_value|token|password|api_?key|grant_?key|headers?|provider_?id|account_?id|assistant_?id|phone_?number|email_?address|webhook_?url|tool_?url)$/i;
function inspect(value, pathLabel = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      errors.push(`template contains prohibited field ${pathLabel}.${key}`);
    }
    inspect(child, `${pathLabel}.${key}`);
  }
}
inspect(template);

if (template?.tenantKey !== "bluladder-klamath") {
  errors.push("template tenant key drifted");
}
if (template?.purpose !== "activation_review") {
  errors.push("template purpose must be activation_review");
}
for (const [key, approval] of Object.entries(template?.ownerApprovals ?? {})) {
  if (
    approval?.status !== "pending" || approval?.recordRef !== null ||
    approval?.approvedAt !== null
  ) {
    errors.push(`repository approval ${key} must remain pending and empty`);
  }
}
for (const section of [
  "protectedConfigurationPresence",
  "providerReadiness",
  "releaseEvidence",
]) {
  if (Object.values(template?.[section] ?? {}).some((value) => value !== false)) {
    errors.push(`repository ${section} must remain entirely false`);
  }
}

for (const phrase of [
  "eligible_for_activation_review",
  "activationAllowed: false",
  "sensitive_field_present",
  "repository_activation_boundary_open",
  "dfw_fallback_boundary_open",
]) {
  if (!content.implementation?.includes(phrase)) {
    errors.push(`implementation omits ${phrase}`);
  }
}
for (const phrase of [
  "does not activate Klamath",
  "boolean presence",
  "Unknown fields fail closed",
  "explicit signed GO",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
for (const phrase of [
  "can reach only a separate activation review",
  "provider identifiers and secret-like extra fields",
  "unrelated extra fields",
  "activationAllowed).toBe(false)",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  "activationAllowed: false",
  "customerTrafficAllowed: false",
  "dfwFallbackAllowed: false",
  "runtimeRoutingEnabled: false",
  "published: false",
]) {
  if (!content.tenant?.includes(phrase)) {
    errors.push(`Klamath fail-closed authority omits ${phrase}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath launch-input contract OK: repository template blocked, protected values excluded, activation requires separate review.",
);
