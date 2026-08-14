import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract:
    "docs/architecture/bluladder-klamath-messaging-compliance-review.md",
  launchContract:
    "docs/architecture/bluladder-klamath-launch-input-contract.md",
  template:
    "docs/operations/bluladder-klamath-messaging-compliance-review.template.json",
  launchTemplate:
    "docs/operations/bluladder-klamath-launch-inputs.template.json",
  implementation:
    "packages/tenant-config/bluladderKlamathMessagingComplianceReview.ts",
  tests:
    "packages/tenant-config/bluladderKlamathMessagingComplianceReview.test.ts",
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
let launchTemplate;
try {
  template = JSON.parse(content.template ?? "{}");
  launchTemplate = JSON.parse(content.launchTemplate ?? "{}");
} catch (error) {
  errors.push(`messaging review JSON is invalid: ${error.message}`);
}

const forbiddenKey =
  /^(?:secret|token|password|api_?key|grant_?key|headers?|provider_?id|account_?id|phone_?number|email_?address|webhook_?url|tool_?url)$/i;
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

const candidate = template?.candidate;
if (
  candidate?.schemaVersion !== 1 ||
  candidate?.tenantKey !== "bluladder-klamath" ||
  candidate?.purpose !== "messaging_compliance_owner_legal_review" ||
  candidate?.providerRequirementsReviewedAsOf !== "2026-08-14"
) errors.push("messaging compliance candidate identity drifted");

const exactUseCases = [
  "quote_link",
  "booking_management",
  "reminder",
  "operator_followup",
  "authentication",
];
if (JSON.stringify(candidate?.campaign?.useCases) !== JSON.stringify(exactUseCases)) {
  errors.push("messaging use-case boundary drifted");
}
if (
  candidate?.campaign?.brandName !== "BluLadder Klamath" ||
  candidate?.campaign?.recommendedUseCaseCategory !== "LOW_VOLUME" ||
  candidate?.campaign?.recommendationStatus !==
    "pending_provider_eligibility_and_owner_review" ||
  candidate?.campaign?.hasEmbeddedLinks !== true ||
  candidate?.campaign?.hasEmbeddedPhoneNumbers !== false ||
  candidate?.campaign?.keywordOptInSupported !== false ||
  JSON.stringify(candidate?.campaign?.optInKeywords) !== "[]"
) errors.push("campaign content classification drifted");

const samples = candidate?.campaign?.sampleMessages;
if (!Array.isArray(samples) || samples.length !== 5) {
  errors.push("exact five sample messages required");
} else {
  for (const [index, sample] of samples.entries()) {
    if (
      typeof sample !== "string" ||
      sample.length < 20 ||
      sample.length > 1024 ||
      !sample.includes("BluLadder Klamath") ||
      !sample.includes("STOP")
    ) errors.push(`sample message ${index + 1} violates the reviewed boundary`);
  }
}

for (const phrase of [
  "separate unchecked marketing opt-in",
  "Consent is not a condition of purchase",
  "Message frequency varies",
  "Msg & data rates may apply",
  "Reply HELP for help or STOP to opt out",
]) {
  if (!JSON.stringify(candidate?.consent).includes(phrase)) {
    errors.push(`consent candidate omits ${phrase}`);
  }
}
for (const url of [
  "https://klamath.bluladder.com/",
  "https://klamath.bluladder.com/privacy",
  "https://klamath.bluladder.com/terms",
  "https://klamath.bluladder.com/contact",
]) {
  if (!JSON.stringify(candidate?.publicSurfaces).includes(url)) {
    errors.push(`public-surface candidate omits ${url}`);
  }
}

for (const flag of [
  "sourceImplementationChanged",
  "publicSurfacesPublished",
  "providerCampaignSubmitted",
  "messagingRuntimeEnabled",
  "customerTrafficAllowed",
  "activationAllowed",
]) {
  if (candidate?.[flag] !== false) errors.push(`${flag} must remain false`);
}
for (const review of ["ownerApproval", "legalReview"]) {
  if (
    template?.[review]?.status !== "pending" ||
    template?.[review]?.recordRef !== null ||
    template?.[review]?.approvedAt !== null
  ) errors.push(`${review} must remain pending`);
}
if (
  template?.publicSurfacesVerified !== false ||
  template?.providerUseCaseEligibilityVerified !== false ||
  template?.contractTestsPassed !== false
) errors.push("repository review evidence must remain false");
for (const gate of [
  "sms_consent_surface_verified",
  "sms_help_stop_behavior_verified",
  "privacy_policy_published",
  "terms_published",
  "sms_sample_messages_approved",
  "twilio_campaign_approved",
]) {
  if (launchTemplate?.providerReadiness?.[gate] !== false) {
    errors.push(`launch template ${gate} must remain false`);
  }
}

for (const phrase of [
  "eligible_for_twilio_campaign_submission_review",
  "activationAllowed: false",
  "candidate_snapshot_mismatch",
  "public_surfaces_not_verified",
  "provider_use_case_eligibility_not_verified",
  "repository_runtime_boundary_open",
]) {
  if (!content.implementation?.includes(phrase)) {
    errors.push(`implementation omits ${phrase}`);
  }
}
for (const phrase of [
  "owner, legal, and public-surface review",
  "representative campaign",
  "eligible_for_twilio_campaign_submission_review",
  "activationAllowed: false",
  "provider and runtime unchanged",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
for (const phrase of [
  "high-level messaging use cases",
  "carrier-review or legal copy",
  "before any SMS consent",
]) {
  if (!content.launchContract?.includes(phrase)) {
    errors.push(`launch contract omits ${phrase}`);
  }
}
for (const phrase of [
  "keeps the checked repository template semantically identical to the candidate",
  "keeps the repository template blocked",
  "separate Twilio campaign-submission review",
  "requires a separate unchecked marketing opt-in",
  "does not let owner and legal evidence substitute for each other",
  "leaves publication, provider submission, runtime, and activation closed",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  'lifecycle: "provisioning"',
  "activationAllowed: false",
  "customerTrafficAllowed: false",
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
  "Klamath messaging compliance review OK: exact owner/legal candidate prepared; public surfaces, provider submission, runtime, traffic, and activation remain disabled.",
);
