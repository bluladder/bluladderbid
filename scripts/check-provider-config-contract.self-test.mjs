import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  evaluateProviderVerification,
  validateProviderVerification,
} from "./check-provider-config-contract.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const validPath = resolve(
  scriptsDirectory,
  "fixtures/provider-config/valid.sanitized.json",
);
const invalidPath = resolve(
  scriptsDirectory,
  "fixtures/provider-config/invalid.sanitized.json",
);

const valid = JSON.parse(await readFile(validPath, "utf8"));
const invalid = JSON.parse(await readFile(invalidPath, "utf8"));

assert.deepEqual(
  validateProviderVerification(valid),
  [],
  "valid sanitized fixture must satisfy the provider evidence contract",
);
const release = evaluateProviderVerification(valid, {
  release: true,
  projectRef: "gyndziiuizpgwhqwyrvn",
  repositorySha: "f391121fef53684a826dde1998f7acfcbb7e565e",
  now: new Date("2026-01-01T01:00:00.000Z"),
});
assert.equal(release.releaseVerified, true);

const blocked = structuredClone(valid);
blocked.surfaces.vapi.status = "blocked";
blocked.surfaces.vapi.blockers = ["provider read authorization unavailable"];
assert.equal(
  evaluateProviderVerification(blocked, {
    release: true,
    projectRef: "gyndziiuizpgwhqwyrvn",
    repositorySha: "f391121fef53684a826dde1998f7acfcbb7e565e",
    now: new Date("2026-01-01T01:00:00.000Z"),
  }).releaseVerified,
  false,
  "a schema-valid blocked surface must never be release verified",
);
assert.equal(
  evaluateProviderVerification(valid, {
    release: true,
    projectRef: "aaaaaaaaaaaaaaaaaaaa",
    repositorySha: "f391121fef53684a826dde1998f7acfcbb7e565e",
    now: new Date("2026-01-01T01:00:00.000Z"),
  }).releaseVerified,
  false,
  "wrong project binding must never be release verified",
);
assert.equal(
  evaluateProviderVerification(valid, {
    release: true,
    projectRef: "gyndziiuizpgwhqwyrvn",
    repositorySha: "f391121fef53684a826dde1998f7acfcbb7e565e",
    now: new Date("2026-01-01T03:00:01.000Z"),
  }).releaseVerified,
  false,
  "stale evidence must never be release verified",
);

const invalidErrors = validateProviderVerification(invalid);
for (const fragment of [
  "authorization.readOnly: must be true",
  "redaction.credentialValuesIncluded: must be false",
  "environment.projectIdentity",
  "surfaces.publicBooking.checks.serverGeocoderConfigured: must be true",
  "surfaces.jobber.checks.apiVersionConfirmed: must be a boolean",
  "surfaces.callrail.apiKey: forbidden credential or PII field",
  "surfaces.callrail.phoneNumber: forbidden credential or PII field",
  "surfaces.twilio.status: must remain not_applicable or blocked",
  "must not contain an authorization value",
]) {
  assert(
    invalidErrors.some((error) => error.includes(fragment)),
    `invalid fixture must report ${fragment}`,
  );
}

const checkerSource = await readFile(
  resolve(scriptsDirectory, "check-provider-config-contract.mjs"),
  "utf8",
);
assert(
  !checkerSource.includes("process.env") && !checkerSource.includes("Deno.env"),
  "provider checker must never inspect environment variables",
);

console.log(
  `Provider configuration checker self-test OK: schema valid, exact fresh ` +
    `release verified, blocked/wrong-project/stale release evidence rejected, ` +
    `and invalid fixture rejected with ${invalidErrors.length} finding(s).`,
);
