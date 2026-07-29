import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const fail = (message) => {
  throw new Error(message);
};

const [precheck, pause, restore, drain, runbook] = await Promise.all([
  read("supabase/preflight/tenant_stage_7d_cron_window_precheck.sql"),
  read("supabase/operations/tenant_stage_7d_cron_pause.sql"),
  read("supabase/operations/tenant_stage_7d_cron_restore.sql"),
  read("supabase/verification/tenant_stage_7d_cron_drain.sql"),
  read("docs/operations/tenant-stage-7d-cron-window-rehearsal.md"),
]);
const all = `${precheck}\n${pause}\n${restore}\n${drain}\n${runbook}`;

if (/UPDATE\s+cron\.job|INSERT\s+INTO\s+cron\.job|DELETE\s+FROM\s+cron\.job/i.test(all)) {
  fail("Direct cron.job mutation is prohibited");
}
if (/\bcron\.(schedule|unschedule)\s*\(/i.test(all)) {
  fail("Cron schedule recreation is prohibited");
}
if (/SELECT\s+[^;]*\bcommand\b(?!\s*\))/is.test(all)) {
  fail("Cron scripts may not project raw command text");
}
if (/https?:\/\/|bearer\s+|authorization\s*:/i.test(`${pause}\n${restore}`)) {
  fail("Cron mutation scripts contain credential-shaped text");
}
for (const sql of [pause, restore]) {
  for (const required of [
    "BEGIN ISOLATION LEVEL SERIALIZABLE",
    "FOR UPDATE",
    "cron.alter_job(3",
    "cron.alter_job(5",
    "cron.alter_job(6",
    "matched <> 3",
    "md5(j.command)",
    "COMMIT;",
  ]) {
    if (!sql.includes(required)) fail(`Cron operation missing ${required}`);
  }
}
if (!pause.includes("active := false") || !restore.includes("active := true")) {
  fail("Pause/restore active states are incorrect");
}
if (
  !/BEGIN TRANSACTION READ ONLY;/i.test(precheck) ||
  !/BEGIN TRANSACTION READ ONLY;/i.test(drain)
) {
  fail("Cron evidence queries must be read-only");
}
if (!/at least 65\s+seconds/.test(runbook)) {
  fail("Cron drain stability window is too short");
}
for (const fingerprint of [
  "1a1b5b332626f37867e3521d2052f56b",
  "88e143e3876903e839e7551f68dd179b",
  "ad8c290523e2659a608e7fcb7d57bcb7",
]) {
  if (!pause.includes(fingerprint) || !restore.includes(fingerprint)) {
    fail(`Missing cron fingerprint ${fingerprint}`);
  }
}

const initial = new Map([
  [3, true],
  [5, true],
  [6, true],
]);
const atomicTransition = (state, target, failAfter = null) => {
  const draft = new Map(state);
  let calls = 0;
  try {
    for (const id of [3, 5, 6]) {
      calls += 1;
      draft.set(id, target);
      if (calls === failAfter) throw new Error("injected failure");
    }
    return draft;
  } catch {
    return new Map(state);
  }
};
for (const failAfter of [1, 2, 3]) {
  if ([...atomicTransition(initial, false, failAfter).values()].some((v) => !v)) {
    fail(`Injected pause failure ${failAfter} did not roll back`);
  }
}
const paused = atomicTransition(initial, false);
if ([...paused.values()].some(Boolean)) fail("Pause did not affect all jobs");
const restored = atomicTransition(paused, true);
if ([...restored.values()].some((value) => !value)) {
  fail("Restore did not affect all jobs");
}

console.log(
  "Stage 7D cron window valid: supported alter_job only, three fingerprints, " +
    "atomic failure rehearsal, secret-safe 65-second drain and restore.",
);
