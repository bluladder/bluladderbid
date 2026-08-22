import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.KLAMATH_STAGING_DATABASE_URL;
if (!databaseUrl) throw new Error("KLAMATH_STAGING_DATABASE_URL is required");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operationPath = path.join(
  root,
  "supabase/operations/bluladder_klamath_protected_row_staging.sql",
);
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const fixture = {
  sender: "MG00000000000000000000000000000000",
  transfer: "+12145550101",
  alert: "+12145550102",
  email: "operator@example.invalid",
};

let operation = fs.readFileSync(operationPath, "utf8");
operation = operation
  .replace(
    "f413a45efe96381f82754c03dc0005c41785393303bda45837e2cd458f111008",
    sha256(fixture.transfer),
  )
  .replace(
    "5634195d7b461a4ef99799146b1146c7f85e042931ca87246cfb9beadc22af65",
    sha256(fixture.alert),
  )
  .replace(
    "733e21f1aa22bbaeb3bbd52b5377e1f6ce0531e81262611c14991c84c44089d8",
    sha256(fixture.email),
  );

function psql(input, expectSuccess = true) {
  const result = spawnSync(
    "psql",
    ["-X", "--set", "ON_ERROR_STOP=1", databaseUrl],
    { input, encoding: "utf8" },
  );
  if (expectSuccess && result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr}`);
  }
  if (!expectSuccess && result.status === 0) {
    throw new Error("expected staging collision failure did not occur");
  }
  return result;
}

psql(`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations(version)
SELECT '202607' || lpad(n::text, 8, '0') FROM generate_series(1, 165) AS n;
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260815043425');

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY, slug text NOT NULL, display_name text,
  status text NOT NULL, is_legacy_default boolean NOT NULL
);
CREATE TABLE public.organization_customer_sites (
  organization_id uuid NOT NULL, tenant_key text NOT NULL,
  canonical_hostname text NOT NULL, mapping_status text NOT NULL,
  runtime_routing_enabled boolean NOT NULL, site_published boolean NOT NULL,
  customer_traffic_allowed boolean NOT NULL
);
CREATE TABLE public.organization_public_contacts (
  organization_id uuid NOT NULL, destination text NOT NULL, status text
);
CREATE TABLE public.organization_messaging_connectors (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, channel text NOT NULL,
  provider text NOT NULL, status text NOT NULL, priority integer NOT NULL,
  credential_reference text, sender_identity_reference text
);
CREATE TABLE public.escalation_recipients (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL,
  phone text NOT NULL, email text, role text NOT NULL, categories jsonb NOT NULL,
  handles_urgent boolean NOT NULL, is_enabled boolean NOT NULL,
  verified_at timestamptz
);
INSERT INTO public.organizations VALUES
  ('b1addf00-0000-4000-8000-000000000001', 'bluladder-dfw',
    'BluLadder DFW', 'active', true),
  ('b1addf00-0000-4000-8000-000000000003', 'bluladder-klamath',
    'BluLadder Klamath', 'provisioning', false);
INSERT INTO public.organization_customer_sites VALUES (
  'b1addf00-0000-4000-8000-000000000003', 'bluladder-klamath',
  'klamath.bluladder.com', 'provisioning', false, false, false
);
`);

const parameterSetup = `
SELECT set_config('bluladder.klamath_sms_sender_identity', '${fixture.sender}', false);
SELECT set_config('bluladder.klamath_transfer_phone', '${fixture.transfer}', false);
SELECT set_config('bluladder.klamath_alert_phone', '${fixture.alert}', false);
SELECT set_config('bluladder.klamath_alert_email', '${fixture.email}', false);
`;

psql(parameterSetup + operation);
psql(`
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_messaging_connectors) <> 1
    OR (SELECT count(*) FROM public.escalation_recipients) <> 2
    OR EXISTS (SELECT 1 FROM public.organization_messaging_connectors
      WHERE status <> 'inactive')
    OR EXISTS (SELECT 1 FROM public.escalation_recipients
      WHERE is_enabled OR verified_at IS NULL)
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 166
  THEN
    RAISE EXCEPTION 'staging rehearsal postcondition failed';
  END IF;
END $$;
`);

psql(parameterSetup + operation, false);
psql(`
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_messaging_connectors) <> 1
    OR (SELECT count(*) FROM public.escalation_recipients) <> 2
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 166
  THEN
    RAISE EXCEPTION 'failed retry was not atomic';
  END IF;
END $$;
`);

console.log("Klamath protected-row staging rehearsal passed.");
