import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REQUIRED_STATES } from './evaluate-protected-launch.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const fail = (message) => {
  throw new Error(message);
};

const [
  booking,
  recurring,
  functionConfig,
  gate,
  adminDiagnostics,
  launchControl,
  synthetic,
  runbook,
  controlSheet,
  providerRunbook,
  voiceWorksheet,
  evaluatorSource,
  stateReports,
] = await Promise.all([
  read('supabase/functions/jobber-create-booking/index.ts'),
  read('supabase/functions/jobber-create-service-request/index.ts'),
  read('supabase/config.toml'),
  read('supabase/functions/_shared/publicBookingLaunchGate.ts'),
  read('supabase/functions/admin-diagnostics/index.ts'),
  read('docs/launch/public-booking-launch-control.md'),
  read('docs/launch/controlled-synthetic-booking.md'),
  read('docs/launch/hosted-launch-runbook.md'),
  read('docs/launch/launch-control-sheet.md'),
  read('docs/launch/provider-configuration-verification.md'),
  read('docs/voice/real-call-acceptance-worksheet.md'),
  read('scripts/evaluate-protected-launch.mjs'),
  read('docs/launch/protected-launch-state-reports.md'),
]);

for (const functionName of [
  'jobber-create-booking',
  'jobber-create-service-request',
  'admin-diagnostics',
]) {
  const explicitConfig =
    `[functions.${functionName}]\nverify_jwt = false`;
  if (!functionConfig.includes(explicitConfig)) {
    fail(`${functionName} must explicitly set verify_jwt=false`);
  }
}
if (
  recurring.includes('verifyAdmin(') ||
  recurring.includes('auth.getUser(') ||
  recurring.includes('getBearer(req)') ||
  !recurring.includes('publicBookingLaunchGateResponse(')
) {
  fail(
    'recurring service request no longer has the reviewed public, launch-gated contract',
  );
}
const evidenceTemplate = JSON.parse(
  await read('docs/launch/protected-launch-evidence.template.json'),
);
const goApprovalTemplate = JSON.parse(
  await read('docs/launch/protected-launch-go-approval.template.json'),
);

for (const [name, source] of [
  ['one-time booking', booking],
  ['recurring service request', recurring],
]) {
  const gateIndex = source.indexOf('publicBookingLaunchGateResponse(');
  const replayIndex = source.indexOf('IDEMPOTENCY_LOOKUP_UNAVAILABLE');
  const organizationIndex = source.indexOf(
    'resolvePublicBookingOrganization(',
  );
  if (
    gateIndex < 0 ||
    source.indexOf('req.json()') > gateIndex ||
    replayIndex > gateIndex ||
    organizationIndex < gateIndex
  ) {
    fail(`${name} does not preserve replay then fail closed before new work`);
  }
}
for (const required of [
  'configuredValue === "true"',
  'PUBLIC_BOOKING_DISABLED',
  'authoritative_write_attempted: false',
  'crypto.randomUUID()',
]) {
  if (!gate.includes(required)) fail(`public booking gate is missing ${required}`);
}
if (!adminDiagnostics.includes('public_booking_launch_gate')) {
  fail('admin diagnostics does not expose public booking status');
}
if (
  !booking.includes('protectedBookingTestBypassAuthorized(') ||
  !booking.includes('isServiceRoleToken(callerToken)') ||
  recurring.includes('protectedBookingTestBypassAuthorized(')
) {
  fail('protected synthetic bypass is not service-authenticated and one-time-only');
}
for (const required of [
  'PUBLIC_BOOKING_ENABLED=false',
  'PUBLIC_BOOKING_ENABLED=true',
  'not authorized',
  'No control here activates Oregon',
]) {
  if (!launchControl.includes(required)) {
    fail(`launch-control runbook is missing ${required}`);
  }
}

const templateIds = evidenceTemplate.states.map((state) => state.id);
if (
  JSON.stringify(templateIds) !== JSON.stringify(REQUIRED_STATES) ||
  evidenceTemplate.states.some((state) => state.status === 'PASS')
) {
  fail('protected evidence template must contain nine ordered non-PASS states');
}
for (const id of REQUIRED_STATES) {
  if (!runbook.includes(id) || !controlSheet.includes(id)) {
    fail(`operator artifacts are missing state ${id}`);
  }
}
for (const required of [
  'documentation',
  'artifact hash mismatch',
  'dependency',
  'distinct operator and reviewer',
  'GO-owner approval signature is invalid',
  'authorization_id is reused by another launch state',
  'attestation record is reused by another launch state',
]) {
  if (!evaluatorSource.includes(required)) {
    fail(`protected evaluator is missing fail-closed concept ${required}`);
  }
}
if (
  goApprovalTemplate.decision !== 'GO' ||
  goApprovalTemplate.schema_version !== 1 ||
  !stateReports.includes('STRUCTURALLY VALID') ||
  !stateReports.includes('Ed25519') ||
  !runbook.includes('--go-approval') ||
  !runbook.includes('--trust-key')
) {
  fail('protected launch package is missing signed GO-owner trust binding');
}
for (const required of [
  'Mode A — repository dry run',
  'Mode B — separately authorized hosted run',
  'do not resend or retry',
  'cleanup',
  'PUBLIC_BOOKING_ENABLED=false',
]) {
  if (!synthetic.includes(required)) {
    fail(`synthetic-booking pack is missing ${required}`);
  }
}
for (const required of [
  'Jobber',
  'Resend',
  'CallRail',
  'Twilio',
  'Vapi',
  'Always stop',
]) {
  if (!providerRunbook.includes(required)) {
    fail(`provider runbook is missing ${required}`);
  }
}
for (let scenario = 1; scenario <= 15; scenario += 1) {
  if (!voiceWorksheet.includes(`| ${scenario} |`)) {
    fail(`voice worksheet is missing scenario ${scenario}`);
  }
}
if (
  (voiceWorksheet.match(/\| `REAL_CALL` \|/g) ?? []).length !== 12 ||
  (voiceWorksheet.match(/\| `OFFLINE_FAULT` \|/g) ?? []).length !== 3
) {
  fail('voice worksheet must classify 12 real-call and 3 offline-fault cases');
}

console.log(
  'Hosted launch package valid: fail-closed booking control, nine evidence states, ' +
    'provider matrix, synthetic pack, 15 voice scenarios, and operator sequence.',
);
