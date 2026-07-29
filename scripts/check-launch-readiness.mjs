import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'docs/launch/launch-readiness.json');
const contract = JSON.parse(await readFile(contractPath, 'utf8'));
const contractOnly = process.argv.includes('--contract-only');
const jsonOutput = process.argv.includes('--json');
const allowedStatuses = new Set([
  'PASS',
  'FAIL',
  'BLOCKED_PROTECTED_ACTION',
  'NOT_IMPLEMENTED',
  'NOT_APPLICABLE',
]);
const allowedScopes = new Set([
  'repository',
  'configuration',
  'hosted_environment',
  'manual_acceptance',
  'production_verification',
]);
const requiredGates = new Set([
  'landing-page-integration',
  'public-booking',
  'customer-property-creation',
  'service-area-validation',
  'bid-creation',
  'bid-delivery',
  'bid-customer-response',
  'follow-up-automation',
  'customer-sms-email',
  'ai-voice-workflow-entry',
  'operator-launch-diagnostics',
  'failure-recovery',
  'provider-configuration',
  'production-security-foundation',
  'rollback-runbook',
]);

if (contract.schema_version !== 1 || !Array.isArray(contract.gates)) {
  throw new Error('invalid launch-readiness schema');
}

const ids = new Set();
for (const gate of contract.gates) {
  if (!gate.id || ids.has(gate.id)) {
    throw new Error(`duplicate or missing launch gate: ${gate.id}`);
  }
  ids.add(gate.id);
  if (!allowedStatuses.has(gate.status)) {
    throw new Error(`${gate.id}: invalid status ${gate.status}`);
  }
  if (!allowedScopes.has(gate.scope)) {
    throw new Error(`${gate.id}: invalid scope ${gate.scope}`);
  }
  if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
    throw new Error(`${gate.id}: evidence is required`);
  }
  for (const evidence of gate.evidence) {
    if (!existsSync(resolve(root, evidence))) {
      throw new Error(`${gate.id}: missing evidence ${evidence}`);
    }
  }
  if (
    gate.status !== 'PASS' &&
    gate.status !== 'NOT_APPLICABLE' &&
    !gate.reason
  ) {
    throw new Error(`${gate.id}: non-passing status requires a reason`);
  }
}

for (const required of requiredGates) {
  if (!ids.has(required)) throw new Error(`missing required gate ${required}`);
}

const byScope = Object.fromEntries(
  [...allowedScopes].map((scope) => {
    const gates = contract.gates.filter((gate) => gate.scope === scope);
    return [
      scope,
      {
        pass: gates.filter((gate) => gate.status === 'PASS').length,
        blocked: gates.filter(
          (gate) => gate.status === 'BLOCKED_PROTECTED_ACTION',
        ).length,
        notImplemented: gates.filter(
          (gate) => gate.status === 'NOT_IMPLEMENTED',
        ).length,
        fail: gates.filter((gate) => gate.status === 'FAIL').length,
        total: gates.length,
      },
    ];
  }),
);
const blocking = contract.gates.filter(
  (gate) => !['PASS', 'NOT_APPLICABLE'].includes(gate.status),
);
const report = {
  evaluatedFor: contract.evaluated_for,
  ready: blocking.length === 0,
  byScope,
  blocking: blocking.map(({ id, scope, severity, status, reason }) => ({
    id,
    scope,
    severity,
    status,
    reason,
  })),
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(
    `Launch readiness: ${report.ready ? 'READY' : 'NOT READY'}; ` +
      `${blocking.length} blocking gate(s).`,
  );
  for (const [scope, counts] of Object.entries(byScope)) {
    console.log(
      `${scope}: ${counts.pass}/${counts.total} PASS, ` +
        `${counts.notImplemented} NOT_IMPLEMENTED, ` +
        `${counts.blocked} BLOCKED_PROTECTED_ACTION, ${counts.fail} FAIL`,
    );
  }
}

if (!contractOnly && !report.ready) process.exitCode = 1;
