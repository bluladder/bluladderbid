import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Static campaign-inactive guard.
//
// The Evergreen Service Education Nurture campaign is required to remain in
// `draft` status with `historical_backfill_enabled=false` and every step
// `active=false` until owner sign-off. This test freezes those invariants at
// the migration layer — any commit that seeds or migrates the campaign into
// an ACTIVE state, or that turns on historical backfill, or that flips a step
// to `active=true`, will fail this check in CI before it can merge.
//
// A future OWNER-APPROVED activation must include a NEW migration that
// explicitly ships this test change alongside the activation SQL.
// ============================================================================

const EVERGREEN_ID = "55555555-5555-4555-9555-555555555555";
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function loadEvergreenMigrations(): { file: string; sql: string }[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const out: { file: string; sql: string }[] = [];
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (sql.includes(EVERGREEN_ID)) out.push({ file: f, sql });
  }
  return out;
}

describe("Evergreen Service Education Nurture — campaign inactive guard", () => {
  const migrations = loadEvergreenMigrations();

  it("at least one migration references the Evergreen campaign id", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("no migration inserts or updates the campaign into 'active' status", () => {
    for (const { file, sql } of migrations) {
      // Very narrow check: any occurrence of the campaign UUID followed later
      // in the same statement by the literal 'active' status for sms_campaigns
      // would flip it live. We keep this deliberately strict.
      const activeInsert = /INSERT[\s\S]+sms_campaigns[\s\S]+'active'/i.test(sql)
        && sql.includes(EVERGREEN_ID);
      expect(activeInsert, `${file} appears to insert the campaign as active`).toBe(false);

      const activeUpdate = /UPDATE\s+public\.sms_campaigns[\s\S]+status\s*=\s*'active'/i.test(sql)
        && sql.includes(EVERGREEN_ID);
      expect(activeUpdate, `${file} appears to update the campaign to active`).toBe(false);
    }
  });

  it("no migration turns on historical_backfill_enabled for the Evergreen row", () => {
    for (const { file, sql } of migrations) {
      const enablesBackfill =
        /historical_backfill_enabled[\s\S]{0,80}true/i.test(sql) && sql.includes(EVERGREEN_ID);
      // The seed migration MAY reference historical_backfill_enabled = false
      // (explicit disable) — that's fine. Only `true` is a violation.
      expect(enablesBackfill, `${file} enables historical backfill`).toBe(false);
    }
  });

  it("no migration flips an Evergreen step to active=true", () => {
    for (const { file, sql } of migrations) {
      // Look for `sms_campaign_steps` inserts that use the Evergreen campaign
      // id along with an `active` boolean of true — the seed uses `false`.
      if (!sql.includes(EVERGREEN_ID)) continue;
      if (!/sms_campaign_steps/i.test(sql)) continue;
      // Extract each row that references the campaign id and confirm it does
      // not carry `true` in the position of the `active` column. The seed
      // shape is: (campaign_id, step_order, delay_hours, channel, active, ...).
      const rowRegex = new RegExp(`'${EVERGREEN_ID}'[^)]*?,\\s*'email'\\s*,\\s*(true|false)`, "gi");
      const matches = [...sql.matchAll(rowRegex)];
      for (const m of matches) {
        expect(m[1].toLowerCase(), `${file} activates an Evergreen step`).toBe("false");
      }
    }
  });
});
