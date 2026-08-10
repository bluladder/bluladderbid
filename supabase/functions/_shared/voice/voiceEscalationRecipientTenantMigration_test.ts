import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationUrl = new URL(
  "../../../migrations/20260810150000_voice_escalation_recipients_tenant_scope.sql",
  import.meta.url,
);
const migration = await Deno.readTextFile(migrationUrl);

Deno.test("voice escalation recipient migration is additive, guarded, and tenant scoped", () => {
  for (
    const fragment of [
      "ADD COLUMN IF NOT EXISTS organization_id uuid",
      "escalation recipient organization backfill requires DFW as the sole active organization",
      "ALTER COLUMN organization_id SET NOT NULL",
      "escalation_recipients_organization_id_fkey",
      "VALIDATE CONSTRAINT escalation_recipients_organization_id_fkey",
      "escalation_recipients_one_active_primary_idx",
      "WHERE is_enabled = true AND role = 'primary'",
      "tenant_security.current_organization_role(organization_id) IS NOT NULL",
      "actor.organization_id = escalation_recipients.organization_id",
      "actor.status = 'active'",
      "actor.role IN ('owner', 'admin')",
    ]
  ) {
    assert(migration.includes(fragment), `migration omits ${fragment}`);
  }
  assertEquals(
    /WHERE status = 'active'[\s\S]{0,120}id <> 'b1addf00-0000-4000-8000-000000000001'/i
      .test(migration),
    true,
  );
  assertEquals(
    /\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|SECURITY\s+DEFINER)\b/i
      .test(migration),
    false,
  );
  assertEquals(
    migration.includes("public.is_organization_member"),
    false,
  );
});
