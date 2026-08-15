import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(
  root,
  "docs/operations/bluladder-klamath-compliance-site-launch-evidence.template.json",
);
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

const forbiddenKey = /^(?:secret|token|password|api_?key|grant_?key|headers?|provider_?id|account_?id|phone_?number|email_?address|webhook_?url|tool_?url|destination)$/i;
const protectedValuePatterns = [
  /\+[1-9][0-9]{7,14}/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
];

function isIsoTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isSafeReference(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !protectedValuePatterns.some((pattern) => pattern.test(value));
}

function inspectForProtectedEvidence(value, errors, pathLabel = "$") {
  if (typeof value === "string") {
    if (protectedValuePatterns.some((pattern) => pattern.test(value))) {
      errors.push(`${pathLabel} contains a prohibited protected-value shape`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) errors.push(`${pathLabel}.${key} is prohibited`);
    inspectForProtectedEvidence(child, errors, `${pathLabel}.${key}`);
  }
}

function inspectExactKeyShape(value, templateValue, errors, pathLabel = "$") {
  if (!templateValue || typeof templateValue !== "object" || Array.isArray(templateValue)) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${pathLabel} must be an object with the reviewed field set`);
    return;
  }
  const expectedKeys = Object.keys(templateValue).sort();
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    errors.push(`${pathLabel} field set differs from the reviewed evidence schema`);
    return;
  }
  for (const key of expectedKeys) {
    inspectExactKeyShape(value[key], templateValue[key], errors, `${pathLabel}.${key}`);
  }
}

function requireTrue(value, pathLabel, errors) {
  if (value !== true) errors.push(`${pathLabel} must be true`);
}

function requireFalse(value, pathLabel, errors) {
  if (value !== false) errors.push(`${pathLabel} must be false`);
}

export function validateCompletedEvidence(evidence) {
  const errors = [];
  inspectForProtectedEvidence(evidence, errors);
  inspectExactKeyShape(evidence, template, errors);

  if (
    evidence?.schema_version !== 1 ||
    evidence?.tenant_key !== "bluladder-klamath" ||
    evidence?.purpose !== "compliance_site_launch_window_evidence"
  ) errors.push("$.identity does not match the Klamath compliance-site launch record");

  if (!/^[0-9a-f]{40}$/.test(evidence?.release?.main_sha ?? "")) {
    errors.push("$.release.main_sha must be an exact lowercase commit SHA");
  }
  for (const key of ["pr_186_merged", "exact_head_ci_passed", "secret_scan_passed"]) {
    requireTrue(evidence?.release?.[key], `$.release.${key}`, errors);
  }
  for (const key of ["migration_path", "migration_bytes", "migration_sha256"]) {
    if (evidence?.release?.[key] !== template.release[key]) {
      errors.push(`$.release.${key} does not match the reviewed migration`);
    }
  }

  if (
    evidence?.reviews?.candidate_manifest_path !==
      template.reviews.candidate_manifest_path ||
    evidence?.reviews?.candidate_bundle_sha256 !==
      template.reviews.candidate_bundle_sha256
  ) errors.push("$.reviews is not bound to the reviewed immutable copy candidate");
  for (const key of [
    "exact_owner_copy_review",
    "qualified_legal_compliance_review",
  ]) {
    const review = evidence?.reviews?.[key];
    if (review?.status !== "approved") errors.push(`$.reviews.${key}.status must be approved`);
    if (!isSafeReference(review?.record_ref)) {
      errors.push(`$.reviews.${key}.record_ref must be a non-sensitive durable reference`);
    }
    if (!isIsoTimestamp(review?.reviewed_at)) {
      errors.push(`$.reviews.${key}.reviewed_at must be a UTC timestamp`);
    }
  }

  if (
    evidence?.public_contacts?.exact_channel_count !== 2 ||
    evidence?.public_contacts?.distinct_destination_count !== 2 ||
    evidence?.public_contacts?.call_reachability !== "verified" ||
    evidence?.public_contacts?.text_reachability !== "verified" ||
    evidence?.public_contacts?.published_count !== 2
  ) errors.push("$.public_contacts does not prove two distinct verified published channels");
  requireTrue(
    evidence?.public_contacts?.evidence_fingerprints_present,
    "$.public_contacts.evidence_fingerprints_present",
    errors,
  );

  if (evidence?.frontend?.lovable_sync_sha !== evidence?.release?.main_sha) {
    errors.push("$.frontend.lovable_sync_sha must equal the reviewed release SHA");
  }
  for (const key of ["published", "dfw_regression_passed", "unknown_host_denial_passed"]) {
    requireTrue(evidence?.frontend?.[key], `$.frontend.${key}`, errors);
  }
  if (
    !Number.isInteger(evidence?.frontend?.lovable_ai_messages_used) ||
    evidence.frontend.lovable_ai_messages_used < 0 ||
    evidence.frontend.lovable_ai_messages_used > 1
  ) errors.push("$.frontend.lovable_ai_messages_used must be zero or one");

  for (const key of [
    "connected",
    "dns_verified",
    "conflicting_aaaa_absent",
    "tls_verified",
    "pre_activation_unavailable_surface_verified",
  ]) requireTrue(evidence?.domain?.[key], `$.domain.${key}`, errors);

  requireTrue(evidence?.hosted_preflight?.passed, "$.hosted_preflight.passed", errors);
  requireTrue(
    evidence?.hosted_preflight?.dfw_fingerprints_unchanged,
    "$.hosted_preflight.dfw_fingerprints_unchanged",
    errors,
  );
  if (evidence?.hosted_preflight?.unexpected_drift !== "none") {
    errors.push("$.hosted_preflight.unexpected_drift must be none");
  }

  for (const key of ["separately_authorized", "applied", "only_reviewed_migration_applied"]) {
    requireTrue(evidence?.migration_application?.[key], `$.migration_application.${key}`, errors);
  }
  if (evidence?.migration_application?.ledger_entry_count !== 1) {
    errors.push("$.migration_application.ledger_entry_count must be exactly one");
  }

  requireTrue(evidence?.postflight?.passed, "$.postflight.passed", errors);
  if (
    evidence?.postflight?.compliance_only_site_count !== 1 ||
    evidence?.postflight?.provider_runtimes_enabled !== 0
  ) errors.push("$.postflight does not prove one compliance-only site and zero provider runtimes");
  requireFalse(
    evidence?.postflight?.customer_traffic_allowed,
    "$.postflight.customer_traffic_allowed",
    errors,
  );
  requireTrue(
    evidence?.postflight?.dfw_fingerprints_unchanged,
    "$.postflight.dfw_fingerprints_unchanged",
    errors,
  );

  for (const key of [
    "privacy_exact",
    "terms_exact",
    "contact_exact",
    "customer_routes_denied",
    "dfw_unchanged",
  ]) requireTrue(evidence?.browser_acceptance?.[key], `$.browser_acceptance.${key}`, errors);

  for (const [key, value] of Object.entries(evidence?.later_provider_releases ?? {})) {
    requireFalse(value, `$.later_provider_releases.${key}`, errors);
  }
  if (
    evidence?.production_actions?.calls_placed !== 0 ||
    evidence?.production_actions?.messages_sent !== 0 ||
    evidence?.production_actions?.customer_data_created !== 0
  ) errors.push("$.production_actions must record zero calls, messages, and customer rows");
  requireFalse(
    evidence?.production_actions?.customer_runtime_enabled,
    "$.production_actions.customer_runtime_enabled",
    errors,
  );
  requireTrue(evidence?.launch_complete, "$.launch_complete", errors);

  return errors;
}

function completedFixture() {
  const fixture = structuredClone(template);
  const timestamp = "2026-08-15T00:00:00Z";
  fixture.release.main_sha = "a".repeat(40);
  fixture.release.pr_186_merged = true;
  fixture.release.exact_head_ci_passed = true;
  fixture.release.secret_scan_passed = true;
  for (const key of [
    "exact_owner_copy_review",
    "qualified_legal_compliance_review",
  ]) {
    fixture.reviews[key] = {
      status: "approved",
      record_ref: `sanitized-${key}-record`,
      reviewed_at: timestamp,
    };
  }
  Object.assign(fixture.public_contacts, {
    call_reachability: "verified",
    text_reachability: "verified",
    evidence_fingerprints_present: true,
    published_count: 2,
  });
  Object.assign(fixture.frontend, {
    lovable_sync_sha: fixture.release.main_sha,
    published: true,
    dfw_regression_passed: true,
    unknown_host_denial_passed: true,
  });
  for (const key of Object.keys(fixture.domain)) fixture.domain[key] = true;
  Object.assign(fixture.hosted_preflight, {
    passed: true,
    dfw_fingerprints_unchanged: true,
    unexpected_drift: "none",
  });
  Object.assign(fixture.migration_application, {
    separately_authorized: true,
    applied: true,
    ledger_entry_count: 1,
    only_reviewed_migration_applied: true,
  });
  Object.assign(fixture.postflight, {
    passed: true,
    compliance_only_site_count: 1,
    dfw_fingerprints_unchanged: true,
  });
  for (const key of Object.keys(fixture.browser_acceptance)) {
    fixture.browser_acceptance[key] = true;
  }
  fixture.launch_complete = true;
  return fixture;
}

function runSelfTest() {
  const passing = completedFixture();
  const passingErrors = validateCompletedEvidence(passing);
  if (passingErrors.length) throw new Error(`passing fixture failed: ${passingErrors.join("; ")}`);

  const mutations = [
    (value) => { value.release.pr_186_merged = false; },
    (value) => { value.reviews.candidate_bundle_sha256 = "b".repeat(64); },
    (value) => { value.reviews.exact_owner_copy_review.status = "pending"; },
    (value) => { value.public_contacts.published_count = 1; },
    (value) => { value.frontend.lovable_sync_sha = "c".repeat(40); },
    (value) => { value.domain.tls_verified = false; },
    (value) => { value.hosted_preflight.unexpected_drift = "present"; },
    (value) => { value.migration_application.ledger_entry_count = 2; },
    (value) => { value.postflight.customer_traffic_allowed = true; },
    (value) => { value.browser_acceptance.customer_routes_denied = false; },
    (value) => { value.later_provider_releases.vapi_changed = true; },
    (value) => { value.production_actions.calls_placed = 1; },
    (value) => { value.unexpected = false; },
    (value) => { value.unexpected = { secret: "prohibited" }; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(passing);
    mutate(candidate);
    if (validateCompletedEvidence(candidate).length === 0) {
      throw new Error("negative fixture unexpectedly passed");
    }
  }
  console.log(
    "Klamath compliance-site launch evidence validator self-test passed (all completion and denial gates enforced).",
  );
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const evidencePath = process.argv[2];
  if (!evidencePath) {
    console.error("usage: node scripts/validate-bluladder-klamath-compliance-site-launch-evidence.mjs <evidence.json>");
    process.exit(2);
  }
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(path.resolve(evidencePath), "utf8"));
  } catch (error) {
    console.error(`launch evidence could not be read: ${error.message}`);
    process.exit(1);
  }
  const errors = validateCompletedEvidence(evidence);
  if (errors.length) {
    console.error("Klamath compliance-site launch evidence failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    "Klamath compliance-site launch evidence passed (compliance routes only; customer and provider runtimes remain disabled).",
  );
}
