-- Stage 7B Lovable Cloud atomic release provenance.
-- This fragment is assembled after the security correction and before the
-- sole COMMIT. It must never be executed independently.
--
-- The artifact identity is canonical: SHA-256 is calculated with the
-- embedded 64-character digest normalized back to the assembler token. This avoids
-- an impossible cryptographic self-reference while binding the database row to
-- one deterministic SQL artifact.

CREATE TABLE IF NOT EXISTS tenant_security.release_provenance (
  release_id text PRIMARY KEY,
  release_commit text NOT NULL,
  source_sha256 text NOT NULL,
  correction_sha256 text NOT NULL,
  artifact_sha256 text NOT NULL,
  project_ref text NOT NULL,
  environment text NOT NULL,
  operator_identity text NOT NULL,
  approval_record text NOT NULL,
  execution_mechanism text NOT NULL,
  execution_started_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_outcome text NOT NULL
    CHECK (transaction_outcome = 'committed'),
  CHECK (release_commit ~ '^[0-9a-f]{40}$'),
  CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (correction_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (btrim(operator_identity) <> ''),
  CHECK (btrim(approval_record) <> '')
);

ALTER TABLE tenant_security.release_provenance OWNER TO postgres;
REVOKE ALL ON tenant_security.release_provenance
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION tenant_security.reject_release_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'release provenance is append-only';
END
$$;
ALTER FUNCTION tenant_security.reject_release_provenance_mutation()
  OWNER TO postgres;
REVOKE ALL
  ON FUNCTION tenant_security.reject_release_provenance_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS release_provenance_append_only
  ON tenant_security.release_provenance;
CREATE TRIGGER release_provenance_append_only
  BEFORE UPDATE OR DELETE ON tenant_security.release_provenance
  FOR EACH ROW
  EXECUTE FUNCTION tenant_security.reject_release_provenance_mutation();

CREATE OR REPLACE FUNCTION tenant_security.record_stage7b_lovable_provenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_release_id constant text :=
    'tenant-foundation-stage-7b-lovable-v1';
  v_release_commit constant text :=
    'e8000543d015dec7b6ab16110e4798f596398681';
  v_source_sha256 constant text :=
    'b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca';
  v_correction_sha256 constant text :=
    'abcc90c9044b32fc02fce5f7c3fd445f91fe4f186c5c8a2ee93007809f3a69d0';
  v_artifact_sha256 constant text := '__ARTIFACT_SHA256__';
  v_target_project_ref constant text := 'gyndziiuizpgwhqwyrvn';
  v_environment constant text := 'Live/production';
  v_operator_identity constant text := 'benjamin-millen';
  v_approval_record constant text :=
    'owner-operated-lovable-stage7b-v1';
  v_execution_started_at constant timestamptz := transaction_timestamp();
BEGIN
  IF v_target_project_ref <> 'gyndziiuizpgwhqwyrvn' THEN
    RAISE EXCEPTION 'wrong Stage 7B project identity';
  END IF;
  IF v_environment <> 'Live/production' THEN
    RAISE EXCEPTION 'wrong Stage 7B environment';
  END IF;

  INSERT INTO tenant_security.release_provenance (
    release_id,
    release_commit,
    source_sha256,
    correction_sha256,
    artifact_sha256,
    project_ref,
    environment,
    operator_identity,
    approval_record,
    execution_mechanism,
    execution_started_at,
    transaction_outcome
  ) VALUES (
    v_release_id,
    v_release_commit,
    v_source_sha256,
    v_correction_sha256,
    v_artifact_sha256,
    v_target_project_ref,
    v_environment,
    v_operator_identity,
    v_approval_record,
    'lovable_cloud_approval',
    v_execution_started_at,
    'committed'
  )
  ON CONFLICT (release_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM tenant_security.release_provenance rp
    WHERE rp.release_id = v_release_id
      AND rp.release_commit = v_release_commit
      AND rp.source_sha256 = v_source_sha256
      AND rp.correction_sha256 = v_correction_sha256
      AND rp.artifact_sha256 = v_artifact_sha256
      AND rp.project_ref = v_target_project_ref
      AND rp.environment = v_environment
      AND rp.operator_identity = v_operator_identity
      AND rp.approval_record = v_approval_record
      AND rp.execution_mechanism = 'lovable_cloud_approval'
      AND rp.transaction_outcome = 'committed'
  ) THEN
    RAISE EXCEPTION 'existing Stage 7B provenance does not match this release';
  END IF;
END
$$;

ALTER FUNCTION tenant_security.record_stage7b_lovable_provenance()
  OWNER TO postgres;
REVOKE ALL
  ON FUNCTION tenant_security.record_stage7b_lovable_provenance()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT tenant_security.record_stage7b_lovable_provenance();
