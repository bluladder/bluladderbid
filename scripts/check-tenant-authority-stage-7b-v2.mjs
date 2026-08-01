import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260801164000_tenant_authority_stage_7b_v2.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
const authority = fs.readFileSync(
  "supabase/functions/_shared/organizationAuthority.ts",
  "utf8",
);
const session = fs.readFileSync(
  "supabase/functions/_shared/quoteSession.ts",
  "utf8",
);
const controller = fs.readFileSync(
  "supabase/functions/_shared/workflow/workflowController.ts",
  "utf8",
);
const bookingReadiness = fs.readFileSync(
  "supabase/functions/_shared/bookingReadiness.ts",
  "utf8",
);
const availability = fs.readFileSync(
  "supabase/functions/_shared/availabilityLookup.ts",
  "utf8",
);
const voiceAuthority = fs.readFileSync(
  "supabase/functions/_shared/voice/voiceOrganizationAuthority.ts",
  "utf8",
);

for (const fragment of [
  "ADD COLUMN IF NOT EXISTS organization_id uuid",
  "quote_sessions_organization_id_fkey",
  "chat_conversations_organization_id_fkey",
  "quote_sessions_organization_id_idx",
  "chat_conversations_organization_id_idx",
  "VALIDATE CONSTRAINT quote_sessions_organization_id_fkey",
  "VALIDATE CONSTRAINT chat_conversations_organization_id_fkey",
  "first-wave quote organization reconciliation required",
  "first-wave booking organization reconciliation required",
  "quote session organization backfill conflict",
  "conversation organization backfill conflict",
  "enforce_first_wave_organization_lineage",
  "enforce_session_organization_lineage",
  'CREATE POLICY "Tenant boundary quote sessions"',
  'CREATE POLICY "Tenant boundary chat conversations"',
  "AS RESTRICTIVE FOR ALL TO authenticated",
  "WITH CHECK",
  "security_invoker = true",
  "REVOKE ALL ON public.quote_sessions, public.chat_conversations",
]) {
  if (!migration.includes(fragment)) {
    throw new Error(`Stage 7B v2 migration omits: ${fragment}`);
  }
}

if (/organization_id\s+uuid\s+DEFAULT/i.test(migration)) {
  throw new Error("Stage 7B v2 must not install an organization default");
}
if (/UPDATE[\s\S]{0,160}organization_id\s*=\s*['\"]b1addf00/i.test(migration)) {
  throw new Error("Stage 7B v2 must not blanket-backfill DFW");
}
if (/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(migration)) {
  throw new Error("Stage 7B v2 contains destructive DDL");
}
if (/SECURITY\s+DEFINER/i.test(migration)) {
  throw new Error("Stage 7B v2 must not add a security-definer function");
}

for (const fragment of [
  "resolveServerOrganizationAuthority",
  "findResourceSignals",
  "findMembershipSignals",
  "findMappedSignals",
  "findOrganizationStatuses",
  "missing_authority",
  "conflicting_authority",
  "inactive_organization",
  'sensitiveActionsAllowed: pure.source !== "legacy_dfw"',
]) {
  if (!authority.includes(fragment)) {
    throw new Error(`canonical authority contract omits: ${fragment}`);
  }
}

if (!session.includes('.eq("organization_id", organizationId)')) {
  throw new Error("quote-session reuse lacks an organization predicate");
}
if (!session.includes("Cross-channel\n  // reuse is allowed only")) {
  throw new Error("quote-session identity-selector boundary is undocumented");
}
if (!controller.includes("__expected_organization_id")) {
  throw new Error("controller persistence lacks organization concurrency scope");
}
if (!controller.includes('reason: "tenant_authority_required"')) {
  throw new Error("PR #63 tenant-sensitive voice gate was removed");
}
if (!controller.includes("organizationId: resolvedOrganizationId(input)")) {
  throw new Error("voice tools do not receive server-resolved organization scope");
}
if (
  !bookingReadiness.includes("convo.organization_id") ||
  !bookingReadiness.includes("findByConversation")
) {
  throw new Error("booking readiness does not derive session scope from its conversation");
}
if (
  !availability.includes("organizationId") ||
  !availability.includes("findByConversation")
) {
  throw new Error("availability does not preserve tenant-scoped session reads");
}
for (const forbidden of [
  "rawBody?.organizationId",
  "rawBody?.metadata",
  "callerId",
  "customer?.number",
]) {
  if (voiceAuthority.includes(forbidden)) {
    throw new Error(`voice authority trusts forbidden caller input: ${forbidden}`);
  }
}

console.log(
  "Stage 7B v2 tenant authority check passed: additive session scope, " +
    "parent-only derivation, restrictive RLS, explicit grants, canonical " +
    "resolver, organization predicates, and preserved voice gates.",
);
