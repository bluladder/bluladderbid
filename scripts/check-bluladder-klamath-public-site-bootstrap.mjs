import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract: "docs/architecture/bluladder-klamath-public-site-bootstrap.md",
  gates: "docs/operations/bluladder-klamath-public-site-bootstrap-gates.json",
  authority: "supabase/functions/_shared/publicSitePublicationAuthority.ts",
  authorityTests: "supabase/functions/_shared/publicSitePublicationAuthority_test.ts",
  function: "supabase/functions/public-site-bootstrap/index.ts",
  functionContract: "supabase/functions/_shared/publicSiteBootstrap_contract_test.ts",
  client: "src/lib/publicSite/klamathPublicSurface.ts",
  clientTests: "src/lib/publicSite/klamathPublicSurface.test.ts",
  boundary: "src/components/public-site/PublicSiteBoundary.tsx",
  page: "src/pages/KlamathCompliancePage.tsx",
  copy: "src/lib/publicSite/klamathComplianceCopy.ts",
  copyTests: "src/lib/publicSite/klamathComplianceCopy.test.ts",
  messagingTemplate:
    "docs/operations/bluladder-klamath-messaging-compliance-review.template.json",
  app: "src/App.tsx",
  config: "supabase/config.toml",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md"
};

const content = {};
const errors = [];
for (const [key, file] of Object.entries(relative)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) errors.push(`missing ${file}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

function requireText(key, text) {
  if (!content[key]?.includes(text)) errors.push(`${relative[key]} omits: ${text}`);
}

for (const text of [
  "fail-closed Edge Function deployed; frontend and site unpublished",
  "there is no first-row,",
  "DFW, or preview fallback for Klamath",
  "customerRuntimeReady` is hard-false",
  "internal escalation and",
  "notification contacts are never eligible",
  "did not publish the frontend"
]) requireText("contract", text);

for (const text of [
  "resolvePublicSitePublicationAuthority",
  '.from("organization_customer_sites")',
  '.eq("canonical_hostname", origin.hostname)',
  '.from("organizations")',
  '.from("organization_settings")',
  'site.customer_traffic_allowed\n        ? "customer"\n        : "compliance_only"',
  'source: "exact_dfw_compatibility"'
]) requireText("authority", text);
if (/\.select\(\s*["']\*["']\s*\)/.test(content.authority ?? "")) {
  errors.push("public-site authority uses an unbounded wildcard selection");
}

for (const text of [
  "preserves exact DFW compatibility without database reads",
  "resolves compliance-only",
  "fails closed"
]) requireText("authorityTests", text);

for (const text of [
  "resolvePublicSitePublicationAuthority",
  'rateLimit(req, { limit: 30, windowMs: 60_000 })',
  'customerRuntimeReady: false',
  'publicContactReady: authority.publicContactReady',
  'publicContacts: authority.publicContacts',
  'complianceRoutes: ["/privacy", "/terms", "/contact"]'
]) requireText("function", text);
for (const forbidden of [
  "organizationId: authority.organizationId",
  "providerId",
  "destination:"
]) {
  if (content.function?.includes(forbidden)) {
    errors.push(`public bootstrap exposes forbidden fragment: ${forbidden}`);
  }
}

for (const text of [
  "KLAMATH_PUBLIC_HOSTNAME",
  "DFW_PUBLIC_HOSTNAME",
  "parsePublicSiteBootstrap",
  "customerRuntimeReady: false",
  "publicContactReady: boolean",
  "publicContacts: PublishedPublicContact[]",
  "route_unavailable",
  "unknown_host"
]) requireText("client", text);
for (const text of [
  "keeps quote, booking, portal, admin, chat entry, and root routes blocked",
  "does not treat a provider customer mode as customer-runtime authority",
  "rejects malformed, cross-tenant"
]) requireText("clientTests", text);

for (const text of [
  "public-site-bootstrap",
  "parsePublicSiteBootstrap",
  "<KlamathCompliancePage",
  "<Unavailable"
]) requireText("boundary", text);
requireText("app", "<PublicSiteBoundary>");
requireText("app", "<ChatWidget />");
const boundaryStart = content.app?.indexOf("<PublicSiteBoundary>") ?? -1;
const chatPosition = content.app?.indexOf("<ChatWidget />") ?? -1;
const boundaryEnd = content.app?.indexOf("</PublicSiteBoundary>") ?? -1;
if (!(boundaryStart >= 0 && chatPosition > boundaryStart && boundaryEnd > chatPosition)) {
  errors.push("the DFW routes and chat are not contained by PublicSiteBoundary");
}
requireText("config", "[functions.public-site-bootstrap]");
requireText("config", "verify_jwt = false");
requireText("roadmap", "Klamath public-site bootstrap candidate");

for (const text of [
  "KLAMATH_PRIVACY_COPY",
  "KLAMATH_TERMS_COPY",
  "For help with a BluLadder Klamath text message, reply HELP",
  "A separate public phone or email support channel is not published yet"
]) requireText("page", text);

let messagingTemplate;
try {
  messagingTemplate = JSON.parse(content.messagingTemplate ?? "{}");
} catch (error) {
  errors.push(`messaging template JSON is invalid: ${error.message}`);
}
for (const statement of [
  ...(messagingTemplate?.candidate?.publicSurfaces
    ?.privacyPolicyRequiredStatements ?? []),
  ...(messagingTemplate?.candidate?.publicSurfaces?.termsRequiredStatements ?? []),
]) requireText("copy", statement);
for (const text of [
  "renders the exact privacy and terms statements frozen for carrier review",
  "includes every frozen statement exactly once in the assembled paragraphs",
  "renders every frozen statement through the public compliance page",
  "does not convert exact copy alignment into owner or legal approval",
]) requireText("copyTests", text);
for (const forbidden of [
  "PRIMARY_PUBLIC_PHONE",
  "SUPPORT_EMAIL",
  "tel:",
  "mailto:",
  "contact-request"
]) {
  if (content.page?.includes(forbidden) || content.boundary?.includes(forbidden)) {
    errors.push(`Klamath public surface exposes a forbidden contact path: ${forbidden}`);
  }
}

let gates;
try {
  gates = JSON.parse(content.gates ?? "{}");
} catch (error) {
  errors.push(`gate JSON is invalid: ${error.message}`);
}
if (gates) {
  if (
    gates.schema_version !== 1 ||
    gates.tenant_key !== "bluladder-klamath" ||
    gates.prepared_from_main !== "194da6197854fe738e20152363cf28498d59d9b3" ||
    gates.issue !== 176 ||
    gates.repository_implementation_ready !== true ||
    gates.exact_dfw_compatibility !== true ||
    gates.unknown_host_blocked !== true ||
    gates.server_authoritative_bootstrap !== true ||
    gates.candidate_copy_bound_to_rendered_surface !== true
  ) errors.push("public-site bootstrap repository identity drifted");

  const expectedRoutes = ["/privacy", "/terms", "/contact"];
  if (JSON.stringify(gates.compliance_routes) !== JSON.stringify(expectedRoutes)) {
    errors.push("compliance route set or order drifted");
  }
  for (const key of [
    "customer_runtime_ready",
    "public_contact_ready",
    "owner_copy_approved",
    "legal_review_passed",
    "hostname_resolves",
    "frontend_published",
    "site_published",
    "customer_traffic_allowed",
    "activation_allowed",
  ]) {
    if (gates[key] !== false) errors.push(`${key} must remain false`);
  }
  if (gates.function_deployed !== true) {
    errors.push("function_deployed must be true after hosted reconciliation");
  }
  if (Object.values(gates.authorized_actions ?? {}).some(Boolean)) {
    errors.push("public-site gate authorizes a protected action");
  }

  const ready = new Set([
    "exact_origin_authority",
    "exact_dfw_compatibility",
    "unknown_host_denial",
    "compliance_only_route_denial",
    "dfw_contact_leak_denial",
    "candidate_copy_binding",
    "public_contact_authority",
    "function_deployment",
  ]);
  const expectedGateCount = 16;
  if ((gates.gates ?? []).length !== expectedGateCount) {
    errors.push("public-site gate count drifted");
  }
  for (const gate of gates.gates ?? []) {
    const expectedStatus = ready.has(gate.id) ? "ready" : "blocked";
    if (gate.status !== expectedStatus) {
      errors.push(`gate ${gate.id} must be ${expectedStatus}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath public-site bootstrap gate OK: exact DFW behavior is preserved, Klamath compliance routes require server publication authority, customer runtime remains fail-closed, and public contact output requires dedicated publication authority."
);
