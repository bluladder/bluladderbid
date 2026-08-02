import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const GIT_BLOB = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9]{14}$/;
const CLI_PROOF = "supabase_cli_zero_selection_dry_run";
const LOVABLE_PROOF = "lovable_native_ledger_git_reconciliation";
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Error(`Voice retention Lovable evidence: ${message}`);
};
const requireString = (value, label) => {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} required`);
  }
};
const requireTimestamp = (value, label) => {
  requireString(value, label);
  if (!Number.isFinite(Date.parse(value))) fail(`${label} invalid`);
};
const requireSha = (value, label) => {
  if (!SHA256.test(value ?? "")) fail(`${label} invalid`);
};

export function validateVoiceRetentionLovableEvidence(
  evidence,
  manifest,
  { allowFixture = false } = {},
) {
  if (evidence.schema_version !== 1) fail("unsupported evidence schema");
  if (evidence.fixture && !allowFixture) {
    fail("fixture evidence is not releasable");
  }

  const release = evidence.release ?? {};
  if (
    release.release_id !== manifest.release_id ||
    release.source_commit !== manifest.source_commit ||
    release.canonical_version !== manifest.canonical_source.version ||
    release.canonical_source_sha256 !== manifest.canonical_source.sha256 ||
    release.control_sha256 !== manifest.control_template.sha256 ||
    release.artifact_sha256 !== manifest.artifact.file_sha256
  ) {
    fail("release identity mismatch");
  }
  requireString(release.owner_authorization_id, "owner authorization");

  const preflight = evidence.preflight ?? {};
  if (preflight.status !== "PASS") fail("preflight did not pass");
  requireTimestamp(preflight.captured_at, "preflight timestamp");
  requireSha(preflight.output_sha256, "preflight output hash");
  if (
    preflight.lovable_project_id !== manifest.environment.lovable_project_id ||
    preflight.project_ref !== manifest.environment.project_ref ||
    preflight.environment !== manifest.environment.name ||
    preflight.ledger_count !== manifest.environment.hosted_ledger_count ||
    preflight.ledger_tip !== manifest.environment.hosted_ledger_tip ||
    preflight.ledger_fingerprint_sha256 !==
      manifest.environment.hosted_ledger_fingerprint_sha256 ||
    preflight.hosted_only_marker_rows !== 1 ||
    preflight.canonical_version_rows !== 0 ||
    preflight.post_canonical_rows !== 0 ||
    preflight.target_provenance_rows !== 0 ||
    preflight.target_objects_present !== 0 ||
    preflight.target_jobs_present !== 0 ||
    preflight.private_schema_present !== false ||
    preflight.purge_command_jobs !== 0 ||
    preflight.exact_append_only_trigger_rows !== 1 ||
    preflight.exact_provenance_primary_keys !== 1 ||
    preflight.provenance_check_constraints !== 7 ||
    preflight.provenance_defaults !== 1 ||
    preflight.provenance_constraint_signature_sha256 !==
      "0555ec64c8ccc069cd3b92be1f3db590e205d57aff2a9edfc80597bb5a23d624" ||
    preflight.provenance_default_signature_sha256 !==
      "d05dbc654e817158e6b580193c126c5b5555a5202fa4bc9be6e40384bc011e0f" ||
    preflight.exact_rejection_function !== true ||
    preflight.rejection_function_private !== true ||
    preflight.inbound_chat_message_foreign_keys !== 0 ||
    preflight.chat_message_delete_triggers !== 0 ||
    preflight.chat_message_delete_rules !== 0 ||
    preflight.sha256_digest_available !== true ||
    preflight.provenance_authority_valid !== true ||
    preflight.retention_schema_valid !== true ||
    preflight.safety_gates_passed !== true
  ) {
    fail("preflight identity, history, or stop gate mismatch");
  }
  // The preflight snapshot is inherently a pre-execution state. After a
  // committed execution it can only be a retained historical capture, so a
  // truthful capture mode is recorded instead of demanding re-capture.
  const captureMode = preflight.capture_mode ?? "fresh_pre_execution";
  if (
    captureMode !== "fresh_pre_execution" &&
    captureMode !== "retained_pre_execution"
  ) {
    fail("preflight capture mode unsupported");
  }

  const execution = evidence.execution ?? {};
  if (
    execution.complete_artifact_reviewed !== true ||
    execution.approval_count !== 1 ||
    execution.retry_count !== 0 ||
    execution.status !== "COMMITTED" ||
    execution.lovable_approval_history_retained !== true
  ) {
    fail("single reviewed Lovable execution not proven");
  }
  for (const field of ["approved_at", "started_at", "finished_at"]) {
    requireTimestamp(execution[field], `execution ${field}`);
  }
  if (Date.parse(execution.finished_at) < Date.parse(execution.started_at)) {
    fail("execution timestamps out of order");
  }
  requireSha(execution.database_log_sha256, "database log hash");

  const preflightAt = Date.parse(preflight.captured_at);
  const approvedAt = Date.parse(execution.approved_at);
  const startedAt = Date.parse(execution.started_at);
  const finishedAt = Date.parse(execution.finished_at);
  if (
    preflightAt > approvedAt ||
    approvedAt > startedAt ||
    startedAt > finishedAt ||
    approvedAt - preflightAt > 60 * 60 * 1000
  ) {
    fail("preflight or execution chronology is stale or out of order");
  }

  const postflight = evidence.postflight ?? {};
  if (postflight.status !== "PASS") fail("postflight did not pass");
  requireTimestamp(postflight.captured_at, "postflight timestamp");
  requireSha(postflight.output_sha256, "postflight output hash");
  if (Date.parse(postflight.captured_at) < finishedAt) {
    fail("postflight predates execution completion");
  }
  if (
    postflight.ledger_rows !== manifest.postflight.expected_ledger_count ||
    postflight.preserved_baseline_rows !==
      manifest.environment.hosted_ledger_count ||
    postflight.preserved_baseline_fingerprint !==
      manifest.environment.hosted_ledger_fingerprint_sha256 ||
    postflight.preserved_baseline_matches !== true ||
    postflight.new_ledger_rows !==
      manifest.postflight.expected_new_ledger_rows ||
    postflight.exact_payload_rows !==
      manifest.postflight.expected_exact_payload_rows ||
    postflight.exact_new_payload_rows !==
      manifest.postflight.expected_exact_payload_rows ||
    postflight.canonical_source_version_rows !== 0 ||
    postflight.execution_version_is_later !== true ||
    postflight.exact_provenance_rows !== 1 ||
    postflight.matching_provenance_rows !== 1 ||
    postflight.retention_objects_present !== 4 ||
    postflight.exact_job_rows !== 1 ||
    postflight.exact_active_job_rows !== 1 ||
    postflight.purge_command_jobs !== 1 ||
    postflight.exact_authoritative_job_rows !== 1 ||
    postflight.job_database !== "postgres" ||
    postflight.job_username !== "postgres" ||
    postflight.retention_index_ready !== true ||
    postflight.private_schema_unavailable_to_api_roles !== true ||
    postflight.purge_unavailable_to_api_roles !== true ||
    postflight.security_checks_passed !== true ||
    postflight.metric_checks_passed !== true
  ) {
    fail("postflight ledger, provenance, or retention state mismatch");
  }
  if (
    !VERSION.test(postflight.lovable_execution_version ?? "") ||
    postflight.lovable_execution_version <= manifest.canonical_source.version ||
    postflight.lovable_execution_version <=
      manifest.environment.hosted_ledger_tip
  ) {
    fail("Lovable execution version is not a unique later version");
  }
  const acceptedPayload = manifest.artifact.accepted_ledger_payloads.some(
    (candidate) =>
      candidate.sha256 === postflight.stored_statement_sha256 &&
      candidate.bytes === postflight.stored_statement_bytes,
  );
  if (!acceptedPayload || postflight.stored_statement_count !== 1) {
    fail("stored Lovable statement identity mismatch");
  }

  const generated = evidence.generated_migration ?? {};
  requireString(generated.path, "generated migration path");
  if (!COMMIT_SHA.test(generated.commit_sha ?? "")) {
    fail("generated migration commit invalid");
  }
  requireSha(generated.sha256, "generated migration hash");
  if (
    !generated.path.startsWith(
      `supabase/migrations/${postflight.lovable_execution_version}_`,
    ) ||
    generated.version !== postflight.lovable_execution_version ||
    generated.exact_payload_match !== true ||
    !manifest.artifact.accepted_ledger_payloads.some(
      (candidate) =>
        candidate.sha256 === generated.sha256 &&
        candidate.bytes === generated.bytes,
    )
  ) {
    fail("generated Lovable migration is not the exact execution receipt");
  }

  // ------------------------------------------------------------------
  // Replay-safety proof. Two truthful proofs are accepted and the
  // never-replay / never-repair / never-include-all assertions apply to
  // BOTH. Proof A is the linked Supabase CLI ordinary zero-selection dry
  // run. Proof B is a Lovable-native ledger/Git reconciliation, valid only
  // when the production control plane is Lovable Cloud (no caller-supplied
  // migration version, no linked CLI credentials) and only when it never
  // claims that the Supabase CLI ran.
  // ------------------------------------------------------------------
  const cli = evidence.cli_safety ?? {};
  if (
    cli.generated_migration_reconciled !== true ||
    cli.include_all_used !== false ||
    cli.migration_repair_used !== false ||
    cli.historical_replay_used !== false
  ) {
    fail("future replay guard not proven");
  }
  const replay = evidence.replay_safety ?? {};
  const proofMode = replay.proof_mode ?? CLI_PROOF;
  if (proofMode !== CLI_PROOF && proofMode !== LOVABLE_PROOF) {
    fail("unsupported replay-safety proof mode");
  }
  if (proofMode === CLI_PROOF) {
    if (
      cli.dry_run_selected_migrations !== 0 ||
      cli.canonical_source_selected !== false
    ) {
      fail("future CLI replay guard not proven");
    }
    requireSha(cli.dry_run_output_sha256, "CLI dry-run output hash");
  } else {
    if (
      manifest.production_control_plane !== "lovable_cloud" ||
      evidence.production_control_plane !== "lovable_cloud"
    ) {
      fail("Lovable-native replay proof requires the lovable_cloud control plane");
    }
    if (cli.supabase_cli_executed !== false || cli.dry_run_output_sha256 !== "") {
      fail("Lovable-native replay proof must not claim a Supabase CLI run");
    }
    const rec = replay.lovable_reconciliation ?? {};
    if (rec.supabase_cli_claimed !== false) {
      fail("Lovable-native replay proof must not claim a Supabase CLI run");
    }
    if (
      rec.generated_version !== postflight.lovable_execution_version ||
      rec.generated_path !== generated.path ||
      rec.generated_sha256 !== generated.sha256 ||
      rec.generated_bytes !== generated.bytes ||
      rec.generated_commit_sha !== generated.commit_sha
    ) {
      fail("Lovable reconciliation does not match the generated receipt");
    }
    if (!GIT_BLOB.test(rec.generated_git_blob ?? "")) {
      fail("Lovable reconciliation git blob invalid");
    }
    if (
      rec.generated_commit_reachable_from_head !== true ||
      rec.generated_commit_author_is_lovable_bot !== true
    ) {
      fail("Lovable reconciliation Git receipt is not established");
    }
    if (
      rec.ledger_rows !== manifest.postflight.expected_ledger_count ||
      rec.canonical_source_version_rows !== 0 ||
      rec.exact_payload_rows !== manifest.postflight.expected_exact_payload_rows ||
      rec.duplicate_payload_rows !== 0 ||
      rec.ambiguous_rows !== 0 ||
      rec.matching_provenance_rows !== 1
    ) {
      fail("Lovable ledger reconciliation is not exact");
    }
    requireSha(
      rec.reconciliation_output_sha256,
      "Lovable reconciliation output hash",
    );
    if (typeof rec.reconciliation_capture === "string") {
      if (sha256Hex(rec.reconciliation_capture) !== rec.reconciliation_output_sha256) {
        fail("Lovable reconciliation capture hash does not match its bytes");
      }
    }
  }

  if (
    evidence.failure?.incident_opened !== false ||
    evidence.failure?.disposition !== "NO_FORWARD_REPAIR_REQUIRED"
  ) {
    fail("failure or ambiguity disposition unresolved");
  }

  return {
    ok: true,
    release_id: manifest.release_id,
    lovable_execution_version: postflight.lovable_execution_version,
    replay_proof_mode: proofMode,
    preflight_capture_mode: captureMode,
  };
}

function selfTestEvidence(manifest) {
  const timestamp = "2026-08-02T12:00:00Z";
  const executionVersion = "20260802130000";
  const stored = manifest.artifact.accepted_ledger_payloads[1];
  return {
    schema_version: 1,
    fixture: true,
    release: {
      release_id: manifest.release_id,
      source_commit: manifest.source_commit,
      canonical_version: manifest.canonical_source.version,
      canonical_source_sha256: manifest.canonical_source.sha256,
      control_sha256: manifest.control_template.sha256,
      artifact_sha256: manifest.artifact.file_sha256,
      owner_authorization_id: "fixture-owner-authorization",
    },
    preflight: {
      status: "PASS",
      captured_at: timestamp,
      output_sha256: "1".repeat(64),
      lovable_project_id: manifest.environment.lovable_project_id,
      project_ref: manifest.environment.project_ref,
      environment: manifest.environment.name,
      ledger_count: manifest.environment.hosted_ledger_count,
      ledger_tip: manifest.environment.hosted_ledger_tip,
      ledger_fingerprint_sha256:
        manifest.environment.hosted_ledger_fingerprint_sha256,
      hosted_only_marker_rows: 1,
      canonical_version_rows: 0,
      post_canonical_rows: 0,
      target_provenance_rows: 0,
      target_objects_present: 0,
      target_jobs_present: 0,
      private_schema_present: false,
      purge_command_jobs: 0,
      exact_append_only_trigger_rows: 1,
      exact_provenance_primary_keys: 1,
      provenance_check_constraints: 7,
      provenance_defaults: 1,
      provenance_constraint_signature_sha256:
        "0555ec64c8ccc069cd3b92be1f3db590e205d57aff2a9edfc80597bb5a23d624",
      provenance_default_signature_sha256:
        "d05dbc654e817158e6b580193c126c5b5555a5202fa4bc9be6e40384bc011e0f",
      exact_rejection_function: true,
      rejection_function_private: true,
      inbound_chat_message_foreign_keys: 0,
      chat_message_delete_triggers: 0,
      chat_message_delete_rules: 0,
      sha256_digest_available: true,
      provenance_authority_valid: true,
      retention_schema_valid: true,
      safety_gates_passed: true,
    },
    execution: {
      complete_artifact_reviewed: true,
      approval_count: 1,
      retry_count: 0,
      status: "COMMITTED",
      lovable_approval_history_retained: true,
      approved_at: timestamp,
      started_at: timestamp,
      finished_at: timestamp,
      database_log_sha256: "2".repeat(64),
    },
    postflight: {
      status: "PASS",
      captured_at: timestamp,
      output_sha256: "3".repeat(64),
      ledger_rows: manifest.postflight.expected_ledger_count,
      preserved_baseline_rows: manifest.environment.hosted_ledger_count,
      preserved_baseline_fingerprint:
        manifest.environment.hosted_ledger_fingerprint_sha256,
      preserved_baseline_matches: true,
      new_ledger_rows: 1,
      exact_payload_rows: 1,
      exact_new_payload_rows: 1,
      canonical_source_version_rows: 0,
      lovable_execution_version: executionVersion,
      execution_version_is_later: true,
      stored_statement_count: 1,
      stored_statement_sha256: stored.sha256,
      stored_statement_bytes: stored.bytes,
      exact_provenance_rows: 1,
      matching_provenance_rows: 1,
      retention_objects_present: 4,
      exact_job_rows: 1,
      exact_active_job_rows: 1,
      purge_command_jobs: 1,
      exact_authoritative_job_rows: 1,
      job_database: "postgres",
      job_username: "postgres",
      retention_index_ready: true,
      private_schema_unavailable_to_api_roles: true,
      purge_unavailable_to_api_roles: true,
      security_checks_passed: true,
      metric_checks_passed: true,
    },
    generated_migration: {
      path: `supabase/migrations/${executionVersion}_fixture.sql`,
      version: executionVersion,
      commit_sha: "4".repeat(40),
      sha256: stored.sha256,
      bytes: stored.bytes,
      exact_payload_match: true,
    },
    cli_safety: {
      generated_migration_reconciled: true,
      dry_run_selected_migrations: 0,
      canonical_source_selected: false,
      include_all_used: false,
      migration_repair_used: false,
      historical_replay_used: false,
      dry_run_output_sha256: "5".repeat(64),
    },
    failure: {
      incident_opened: false,
      disposition: "NO_FORWARD_REPAIR_REQUIRED",
    },
  };
}

// Proof-B fixture: Lovable-native ledger/Git reconciliation, no CLI claim.
function selfTestLovableProofEvidence(manifest) {
  const evidence = selfTestEvidence(manifest);
  const capture = "fixture reconciliation capture\n";
  evidence.production_control_plane = "lovable_cloud";
  evidence.preflight.capture_mode = "retained_pre_execution";
  evidence.cli_safety = {
    generated_migration_reconciled: true,
    supabase_cli_available: false,
    supabase_cli_executed: false,
    dry_run_selected_migrations: 0,
    canonical_source_selected: false,
    include_all_used: false,
    migration_repair_used: false,
    historical_replay_used: false,
    dry_run_output_sha256: "",
  };
  evidence.replay_safety = {
    proof_mode: "lovable_native_ledger_git_reconciliation",
    lovable_reconciliation: {
      supabase_cli_claimed: false,
      generated_version: evidence.generated_migration.version,
      generated_path: evidence.generated_migration.path,
      generated_sha256: evidence.generated_migration.sha256,
      generated_bytes: evidence.generated_migration.bytes,
      generated_commit_sha: evidence.generated_migration.commit_sha,
      generated_git_blob: "6".repeat(40),
      generated_commit_reachable_from_head: true,
      generated_commit_author_is_lovable_bot: true,
      ledger_rows: manifest.postflight.expected_ledger_count,
      canonical_source_version_rows: 0,
      exact_payload_rows: manifest.postflight.expected_exact_payload_rows,
      duplicate_payload_rows: 0,
      ambiguous_rows: 0,
      matching_provenance_rows: 1,
      reconciliation_capture: capture,
      reconciliation_output_sha256: sha256Hex(capture),
    },
  };
  return evidence;
}

async function main() {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../docs/releases/voice-artifact-retention-lovable-v1/release.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (process.argv.includes("--self-test")) {
    const valid = selfTestEvidence(manifest);
    validateVoiceRetentionLovableEvidence(valid, manifest, {
      allowFixture: true,
    });
    const mutations = [
      (e) => (e.release.canonical_source_sha256 = "0".repeat(64)),
      (e) => (e.preflight.ledger_count += 1),
      (e) => (e.preflight.target_objects_present = 1),
      (e) => (e.preflight.private_schema_present = true),
      (e) => (e.preflight.purge_command_jobs = 1),
      (e) => (e.preflight.exact_append_only_trigger_rows = 0),
      (e) => (e.preflight.inbound_chat_message_foreign_keys = 1),
      (e) => (e.execution.approval_count = 2),
      (e) => (e.execution.status = "UNCERTAIN"),
      (e) => (e.execution.approved_at = "2026-08-02T10:00:00Z"),
      (e) => (e.postflight.new_ledger_rows = 2),
      (e) => (e.postflight.exact_payload_rows = 2),
      (e) => (e.postflight.exact_new_payload_rows = 0),
      (e) => (e.postflight.execution_version_is_later = false),
      (e) => (e.postflight.stored_statement_sha256 = "0".repeat(64)),
      (e) => (e.postflight.lovable_execution_version = "20260802043233"),
      (e) => (e.postflight.matching_provenance_rows = 0),
      (e) => (e.postflight.purge_command_jobs = 2),
      (e) => (e.postflight.retention_index_ready = false),
      (e) => (e.generated_migration.exact_payload_match = false),
      (e) => (e.cli_safety.canonical_source_selected = true),
      (e) => (e.cli_safety.include_all_used = true),
      (e) => (e.cli_safety.migration_repair_used = true),
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      let rejected = false;
      try {
        validateVoiceRetentionLovableEvidence(invalid, manifest, {
          allowFixture: true,
        });
      } catch {
        rejected = true;
      }
      if (!rejected) fail("hostile self-test accepted invalid evidence");
    }

    const lovableValid = selfTestLovableProofEvidence(manifest);
    validateVoiceRetentionLovableEvidence(lovableValid, manifest, {
      allowFixture: true,
    });
    const lovableMutations = [
      (e) => (e.replay_safety.proof_mode = "trust_me"),
      (e) => (e.production_control_plane = "external_supabase"),
      (e) => (e.cli_safety.supabase_cli_executed = true),
      (e) => (e.cli_safety.dry_run_output_sha256 = "5".repeat(64)),
      (e) => (e.replay_safety.lovable_reconciliation.supabase_cli_claimed = true),
      (e) => (e.replay_safety.lovable_reconciliation.ledger_rows = 151),
      (e) =>
        (e.replay_safety.lovable_reconciliation.canonical_source_version_rows =
          1),
      (e) => (e.replay_safety.lovable_reconciliation.duplicate_payload_rows = 1),
      (e) => (e.replay_safety.lovable_reconciliation.ambiguous_rows = 1),
      (e) =>
        (e.replay_safety.lovable_reconciliation.matching_provenance_rows = 0),
      (e) =>
        (e.replay_safety.lovable_reconciliation.generated_commit_sha =
          "9".repeat(40)),
      (e) => (e.replay_safety.lovable_reconciliation.generated_git_blob = "nope"),
      (e) =>
        (e.replay_safety.lovable_reconciliation
          .generated_commit_reachable_from_head = false),
      (e) =>
        (e.replay_safety.lovable_reconciliation
          .generated_commit_author_is_lovable_bot = false),
      (e) =>
        (e.replay_safety.lovable_reconciliation.generated_sha256 =
          "0".repeat(64)),
      (e) => (e.replay_safety.lovable_reconciliation.generated_version =
        "20260802043233"),
      (e) =>
        (e.replay_safety.lovable_reconciliation.reconciliation_capture =
          "tampered\n"),
      (e) =>
        (e.replay_safety.lovable_reconciliation.reconciliation_output_sha256 =
          ""),
      (e) => (e.cli_safety.include_all_used = true),
      (e) => (e.cli_safety.migration_repair_used = true),
      (e) => (e.cli_safety.historical_replay_used = true),
      (e) => (e.preflight.capture_mode = "recreated_after_execution"),
    ];
    for (const mutate of lovableMutations) {
      const invalid = structuredClone(lovableValid);
      mutate(invalid);
      let rejected = false;
      try {
        validateVoiceRetentionLovableEvidence(invalid, manifest, {
          allowFixture: true,
        });
      } catch {
        rejected = true;
      }
      if (!rejected) {
        fail("hostile self-test accepted forged Lovable reconciliation");
      }
    }
    process.stdout.write(
      "Voice retention Lovable evidence hostile self-test passed.\n",
    );
    return;
  }
  const evidencePath = process.argv[2];
  if (!evidencePath) fail("evidence JSON path required");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const result = validateVoiceRetentionLovableEvidence(evidence, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
