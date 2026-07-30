-- Stage 7B atomic release provenance.
-- This psql-only fragment is assembled after the security correction and
-- before the sole COMMIT. It must never be executed independently.
--
-- Required psql variables:
--   candidate_sha256, provenance_sha256, operator_identity, approval_record,
--   project_ref, environment, execution_started_at

CREATE TABLE IF NOT EXISTS tenant_security.release_provenance (
  release_id text PRIMARY KEY,
  source_commit text NOT NULL,
  source_sha256 text NOT NULL,
  correction_sha256 text NOT NULL,
  provenance_sha256 text NOT NULL,
  candidate_sha256 text NOT NULL,
  project_ref text NOT NULL,
  environment text NOT NULL,
  operator_identity text NOT NULL,
  approval_record text NOT NULL,
  execution_mechanism text NOT NULL,
  execution_started_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_outcome text NOT NULL
    CHECK (transaction_outcome = 'committed'),
  CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (correction_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (provenance_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (candidate_sha256 ~ '^[0-9a-f]{64}$'),
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

CREATE OR REPLACE FUNCTION tenant_security.record_stage7b_release_provenance(
  p_candidate_sha256 text,
  p_provenance_sha256 text,
  p_operator_identity text,
  p_approval_record text,
  p_project_ref text,
  p_environment text,
  p_execution_started_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_release_id constant text := 'tenant-foundation-stage-7b-corrected-v1';
BEGIN
  IF p_project_ref <> 'gyndziiuizpgwhqwyrvn' THEN
    RAISE EXCEPTION 'wrong Stage 7B project identity';
  END IF;
  IF p_environment <> 'production' THEN
    RAISE EXCEPTION 'wrong Stage 7B environment';
  END IF;
  IF p_candidate_sha256 !~ '^[0-9a-f]{64}$'
     OR p_provenance_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid Stage 7B artifact hash';
  END IF;
  IF btrim(coalesce(p_operator_identity, '')) = ''
     OR btrim(coalesce(p_approval_record, '')) = '' THEN
    RAISE EXCEPTION 'operator and approval identities are required';
  END IF;

  INSERT INTO tenant_security.release_provenance (
    release_id,
    source_commit,
    source_sha256,
    correction_sha256,
    provenance_sha256,
    candidate_sha256,
    project_ref,
    environment,
    operator_identity,
    approval_record,
    execution_mechanism,
    execution_started_at,
    transaction_outcome
  ) VALUES (
    v_release_id,
    '5904484df00d9762aa140f6a246d27078029da99',
    'b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca',
    'abcc90c9044b32fc02fce5f7c3fd445f91fe4f186c5c8a2ee93007809f3a69d0',
    p_provenance_sha256,
    p_candidate_sha256,
    p_project_ref,
    p_environment,
    p_operator_identity,
    p_approval_record,
    'direct_psql',
    p_execution_started_at,
    'committed'
  )
  ON CONFLICT (release_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM tenant_security.release_provenance rp
    WHERE rp.release_id = v_release_id
      AND rp.source_commit =
        '5904484df00d9762aa140f6a246d27078029da99'
      AND rp.source_sha256 =
        'b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca'
      AND rp.correction_sha256 =
        'abcc90c9044b32fc02fce5f7c3fd445f91fe4f186c5c8a2ee93007809f3a69d0'
      AND rp.provenance_sha256 = p_provenance_sha256
      AND rp.candidate_sha256 = p_candidate_sha256
      AND rp.project_ref = p_project_ref
      AND rp.environment = p_environment
      AND rp.operator_identity = p_operator_identity
      AND rp.approval_record = p_approval_record
      AND rp.execution_mechanism = 'direct_psql'
      AND rp.execution_started_at = p_execution_started_at
      AND rp.transaction_outcome = 'committed'
  ) THEN
    RAISE EXCEPTION 'existing Stage 7B provenance does not match this release';
  END IF;
END
$$;

ALTER FUNCTION tenant_security.record_stage7b_release_provenance(
  text, text, text, text, text, text, timestamptz
) OWNER TO postgres;
REVOKE ALL
  ON FUNCTION tenant_security.record_stage7b_release_provenance(
    text, text, text, text, text, text, timestamptz
  )
  FROM PUBLIC, anon, authenticated, service_role;

SELECT tenant_security.record_stage7b_release_provenance(
  :'candidate_sha256',
  :'provenance_sha256',
  :'operator_identity',
  :'approval_record',
  :'project_ref',
  :'environment',
  :'execution_started_at'::timestamptz
);
