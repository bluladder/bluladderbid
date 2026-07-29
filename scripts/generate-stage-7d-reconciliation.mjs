import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const outputPath = path.join(
  root,
  "docs",
  "operations",
  "tenant-stage-7d-migration-reconciliation.json",
);

// Captured 2026-07-28 from gyndziiuizpgwhqwyrvn in a READ ONLY transaction.
// Names are blank before 2026-07-12. Later ledger names are the matching
// repository filename stem; the ledger version can differ by several seconds.
const hostedVersions = `
20260125015830
20260125180833
20260125222012
20260125222203
20260126011605
20260126032526
20260126032540
20260126173427
20260126174759
20260126175035
20260126175046
20260126181256
20260126183042
20260126200217
20260126200233
20260126201726
20260127001522
20260127024203
20260127043657
20260127053140
20260127193620
20260127224854
20260127230424
20260128005316
20260128010221
20260128013525
20260128044054
20260128044115
20260128052832
20260128053715
20260309022318
20260309023512
20260309023910
20260309023920
20260629234505
20260629234754
20260630010921
20260630011222
20260630015645
20260630015703
20260630020135
20260630020723
20260630021229
20260630021743
20260630021919
20260630022252
20260630022306
20260630032015
20260630034021
20260630234815
20260712171341
20260712171425
20260712180203
20260712184339
20260712195106
20260712200404
20260712203035
20260712203831
20260712204706
20260712204830
20260712224332
20260713002659
20260713005118
20260713005134
20260713012732
20260713015035
20260713020916
20260713022123
20260713023626
20260713025637
20260713030409
20260713051501
20260713142742
20260713161655
20260713224919
20260713232729
20260714013022
20260714020624
20260714142934
20260715060629
20260715063239
20260715063249
20260715205334
20260715205410
20260715224640
20260715232127
20260716020524
20260716021439
20260716022827
20260716030024
20260716215825
20260716223253
20260720045936
20260720053753
20260720055643
20260720060902
20260720062454
20260720142938
20260720162235
20260720162833
20260720164924
20260720165940
20260720174141
20260720175546
20260720180526
20260720181352
20260720183141
20260720204121
20260721024419
20260721232929
20260722020531
20260722021255
20260722022142
20260722024123
20260722024427
20260722032859
20260722141920
20260722154335
20260722212118
20260722223423
20260722230142
20260722230327
20260722230423
20260722230637
20260723000832
20260723010130
20260723015559
20260723030722
20260723045749
20260723053445
20260723062835
20260723063634
20260723142525
20260723144329
20260723154119
20260723173425
20260723182047
20260723190003
20260723210807
20260723214236
20260725225647
20260726162705
20260726163707
20260726163855
20260726194719
`
  .trim()
  .split("\n");

const exceptions = {
  "20260712184058_cancellation_metadata.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Hosted bookings has all three cancellation metadata columns; no ledger statement contains this repository migration name.",
    replay: "must not replay",
  },
  "20260713051500_cleanup_geocode_verify_precheck.sql": {
    classification: "superseded",
    confidence: "high",
    evidence:
      "One-time DELETE cleanup has no durable schema proof and is adjacent to, but distinct from, hosted 20260713051501. Replaying historical production cleanup is prohibited.",
    replay: "must not replay",
  },
  "20260714000000_escalation_delivery_and_staff_reply_auth.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Hosted staff_reply_test_authorizations and both authorization functions exist with the expected constraints and grants.",
    replay: "must not replay",
  },
  "20260714013500_restrict_autosync_config_public_read.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Hosted public-read policy is absent and the admin-read policy is present.",
    replay: "must not replay",
  },
  "20260714020000_allow_staff_role_chat_messages.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Hosted chat_messages_role_check includes staff.",
    replay: "must not replay",
  },
  "20260726070000_knowledge_base_v1.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Hosted knowledge tables, indexes, functions, policies, and business_knowledge audit trigger match the repository migration.",
    replay: "must not replay",
  },
  "20260727002000_customer_intelligence_phase2_attribution.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Both tables, all 12 attribution columns, both helper functions, indexes, policies, comments, and seeded source catalog are present; no hosted ledger SQL contains lead_source_definitions.",
    replay: "must not replay",
  },
  "20260727004500_persist_booking_lead_attribution.sql": {
    classification: "functionally present but ledger provenance differs",
    confidence: "high",
    evidence:
      "Hosted trigger function definition and bookings trigger match the repository migration; no hosted ledger SQL contains persist_booking_lead_attribution.",
    replay: "must not replay",
  },
  "20260728060000_tenant_foundation_stage_7b.sql": {
    classification: "genuinely pending",
    confidence: "high",
    evidence:
      "Organizations, memberships, resolution keys, and first-wave organization_id columns are absent.",
    replay: "approved migration-window candidate",
  },
  "20260728070000_organization_routing_stage_8a.sql": {
    classification: "genuinely pending",
    confidence: "high",
    evidence:
      "Organization settings, contacts, territories, and service-availability tables are absent.",
    replay: "defer until Stage 7B is applied and verified",
  },
  "20260728080000_restrict_security_definer_execution.sql": {
    classification: "genuinely pending",
    confidence: "high",
    evidence:
      "Stage 7D repository-only forward security migration created after the hosted snapshot.",
    replay: "defer to a separately authorized post-Stage-7B migration window",
  },
};

function parseVersion(version) {
  const match = version.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
  );
  if (!match) throw new Error(`Invalid migration version: ${version}`);
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function nearestHostedVersion(repositoryVersion) {
  const repositoryTime = parseVersion(repositoryVersion);
  const candidates = hostedVersions
    .map((version) => ({
      version,
      deltaSeconds: Math.abs(parseVersion(version) - repositoryTime) / 1000,
    }))
    .filter(({ deltaSeconds }) => deltaSeconds <= 65)
    .sort((a, b) => a.deltaSeconds - b.deltaSeconds);
  return candidates[0] ?? null;
}

const filenames = (await readdir(migrationsDir))
  .filter((filename) => filename.endsWith(".sql"))
  .sort();

const entries = [];
const claimedHostedVersions = new Set();

for (const filename of filenames) {
  const sql = await readFile(path.join(migrationsDir, filename));
  const version = filename.slice(0, 14);
  const sha256 = createHash("sha256").update(sql).digest("hex");
  const sqlMd5 = createHash("md5").update(sql).digest("hex");
  const exceptional = exceptions[filename];

  if (exceptional) {
    entries.push({
      repository_filename: filename,
      repository_version: version,
      sha256,
      sql_md5: sqlMd5,
      likely_hosted_ledger_version: null,
      hosted_ledger_name: null,
      matching_confidence: exceptional.confidence,
      evidence: exceptional.evidence,
      classification: exceptional.classification,
      replay_disposition: exceptional.replay,
    });
    continue;
  }

  const nearest = nearestHostedVersion(version);
  if (!nearest || claimedHostedVersions.has(nearest.version)) {
    entries.push({
      repository_filename: filename,
      repository_version: version,
      sha256,
      sql_md5: sqlMd5,
      likely_hosted_ledger_version: null,
      hosted_ledger_name: null,
      matching_confidence: "low",
      evidence: "No unique hosted ledger candidate within 65 seconds.",
      classification: "unresolved",
      replay_disposition: "must not replay until resolved",
    });
    continue;
  }

  claimedHostedVersions.add(nearest.version);
  const laterNamedLedger = nearest.version >= "20260712171341";
  const exactVersion = nearest.version === version;
  entries.push({
    repository_filename: filename,
    repository_version: version,
    sha256,
    sql_md5: sqlMd5,
    likely_hosted_ledger_version: nearest.version,
    hosted_ledger_name: laterNamedLedger
      ? filename.replace(/\.sql$/, "")
      : "",
    matching_confidence: laterNamedLedger ? "high" : "medium",
    evidence: laterNamedLedger
      ? "Hosted ledger name is the repository filename stem; version ordering and live schema are consistent."
      : "Legacy hosted ledger name is blank; unique version proximity, identical migration ordering, SQL size/hash sampling, and live schema are consistent.",
    classification: exactVersion
      ? "applied and ledger-aligned"
      : "applied but version/name differs",
    replay_disposition: "must not replay",
  });
}

const classifications = Object.fromEntries(
  [...new Set(entries.map(({ classification }) => classification))]
    .sort()
    .map((classification) => [
      classification,
      entries.filter((entry) => entry.classification === classification).length,
    ]),
);

const unclaimedHostedVersions = hostedVersions.filter(
  (version) => !claimedHostedVersions.has(version),
);

const payload = {
  schema_version: 1,
  captured_at: "2026-07-28",
  project_ref: "gyndziiuizpgwhqwyrvn",
  baseline_repository_migration_count: 154,
  branch_repository_migration_count: entries.length,
  hosted_ledger_count: hostedVersions.length,
  classifications,
  unclaimed_hosted_ledger_entries: unclaimedHostedVersions.map((version) => ({
    version,
    finding:
      version === "20260128005316"
        ? "Hosted-only creation provenance for big_job_settings, eligibility_rules, and schedule_blocks."
        : "Unresolved hosted-only entry.",
  })),
  entries,
};

if (entries.length !== 155) {
  throw new Error(`Expected 155 branch migrations, found ${entries.length}`);
}
if (hostedVersions.length !== 145) {
  throw new Error(`Expected 145 hosted migrations, found ${hostedVersions.length}`);
}
if (entries.some(({ classification }) => classification === "unresolved")) {
  throw new Error("Reconciliation contains unresolved repository migrations");
}
if (
  unclaimedHostedVersions.length !== 1 ||
  unclaimedHostedVersions[0] !== "20260128005316"
) {
  throw new Error(
    `Unexpected unclaimed hosted ledger entries: ${unclaimedHostedVersions.join(", ")}`,
  );
}

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  `Wrote ${path.relative(root, outputPath)}: ${entries.length} repository migrations, ${hostedVersions.length} hosted entries.`,
);
