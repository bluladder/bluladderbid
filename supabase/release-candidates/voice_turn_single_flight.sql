-- REVIEW ONLY. Do not apply as part of PR #80.
-- Durable, tenant-scoped single-flight ledger for authenticated voice calls.
CREATE TABLE public.voice_turn_claims (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  call_id text NOT NULL CHECK (length(call_id) BETWEEN 1 AND 160),
  turn_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  claim_token uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'completed', 'uncertain')),
  lease_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, call_id, turn_id),
  UNIQUE (organization_id, call_id, position)
);

CREATE TABLE public.voice_external_action_claims (
  organization_id uuid NOT NULL,
  call_id text NOT NULL,
  turn_id uuid NOT NULL,
  action_key text NOT NULL CHECK (length(action_key) BETWEEN 1 AND 120),
  claim_token uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'completed', 'uncertain')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY (organization_id, call_id, turn_id, action_key),
  FOREIGN KEY (organization_id, call_id, turn_id)
    REFERENCES public.voice_turn_claims(organization_id, call_id, turn_id)
);

ALTER TABLE public.voice_turn_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_turn_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voice_external_action_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_external_action_claims FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_turn_claims, public.voice_external_action_claims FROM PUBLIC, anon, authenticated, service_role;
DO $sandbox_privileges$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.voice_turn_claims, public.voice_external_action_claims FROM sandbox_exec';
  END IF;
END;
$sandbox_privileges$;
GRANT SELECT, INSERT, UPDATE ON public.voice_turn_claims, public.voice_external_action_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_voice_turn(
  p_organization_id uuid, p_call_id text, p_turn_id uuid,
  p_position integer, p_content_hash text, p_claim_token uuid
) RETURNS TABLE(status text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE prior public.voice_turn_claims%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_call_id IS NULL OR p_call_id = '' THEN RAISE EXCEPTION 'authority required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_call_id, 0));
  SELECT * INTO prior FROM public.voice_turn_claims
   WHERE organization_id=p_organization_id AND call_id=p_call_id AND turn_id=p_turn_id;
  IF FOUND THEN
    IF prior.status='claimed' AND prior.lease_expires_at <= statement_timestamp() THEN
      UPDATE public.voice_turn_claims AS claims
         SET status='uncertain', completed_at=statement_timestamp(), lease_expires_at=statement_timestamp()
       WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.turn_id=p_turn_id AND claims.status='claimed';
      RETURN QUERY SELECT 'uncertain'::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT CASE
      WHEN prior.status='claimed' AND prior.claim_token=p_claim_token AND prior.lease_expires_at > statement_timestamp() THEN 'acquired'
      WHEN prior.status='completed' THEN 'duplicate'
      WHEN prior.status='uncertain' THEN 'uncertain'
      ELSE 'wait' END;
    RETURN;
  END IF;
  UPDATE public.voice_turn_claims AS claims SET status='uncertain', completed_at=statement_timestamp()
   WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.status='claimed' AND claims.lease_expires_at <= statement_timestamp();
  IF EXISTS (SELECT 1 FROM public.voice_turn_claims AS claims WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.status='claimed') THEN
    RETURN QUERY SELECT 'wait'::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.voice_turn_claims AS claims WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.position > p_position) THEN
    RETURN QUERY SELECT 'stale'::text; RETURN;
  END IF;
  INSERT INTO public.voice_turn_claims VALUES
    (p_organization_id,p_call_id,p_turn_id,p_position,p_content_hash,p_claim_token,'claimed',statement_timestamp()+interval '2 minutes',NULL,statement_timestamp());
  RETURN QUERY SELECT 'acquired'::text;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.voice_turn_claims AS claims WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.turn_id=p_turn_id AND claims.status='completed'
  ) THEN 'duplicate' ELSE 'stale' END;
END $$;

CREATE OR REPLACE FUNCTION public.complete_voice_turn(p_organization_id uuid,p_call_id text,p_turn_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_call_id, 0));
  UPDATE public.voice_turn_claims AS claims SET status='completed',completed_at=statement_timestamp(),lease_expires_at=statement_timestamp()
   WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.turn_id=p_turn_id AND claims.status='claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'turn claim not active'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_voice_turn_uncertain(p_organization_id uuid,p_call_id text,p_turn_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.voice_turn_claims AS claims SET status='uncertain',completed_at=statement_timestamp(),lease_expires_at=statement_timestamp()
   WHERE claims.organization_id=p_organization_id AND claims.call_id=p_call_id AND claims.turn_id=p_turn_id AND claims.status='claimed';
END $$;

CREATE OR REPLACE FUNCTION public.is_authoritative_voice_turn(p_organization_id uuid,p_call_id text,p_turn_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.voice_turn_claims t WHERE t.organization_id=p_organization_id AND t.call_id=p_call_id AND t.turn_id=p_turn_id AND t.status='completed'
 AND NOT EXISTS(SELECT 1 FROM public.voice_turn_claims n WHERE n.organization_id=t.organization_id AND n.call_id=t.call_id AND n.position>t.position AND n.status='completed'));
$$;

CREATE OR REPLACE FUNCTION public.claim_voice_external_action(p_organization_id uuid,p_call_id text,p_turn_id uuid,p_action_key text,p_claim_token uuid)
RETURNS TABLE(status text) LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.voice_external_action_claims%ROWTYPE;
BEGIN
  SELECT * INTO prior FROM public.voice_external_action_claims WHERE organization_id=p_organization_id AND call_id=p_call_id AND turn_id=p_turn_id AND action_key=p_action_key;
  IF FOUND THEN
    RETURN QUERY SELECT CASE WHEN prior.status='claimed' AND prior.claim_token=p_claim_token THEN 'acquired' ELSE 'terminal' END;
    RETURN;
  END IF;
  INSERT INTO public.voice_external_action_claims VALUES(p_organization_id,p_call_id,p_turn_id,p_action_key,p_claim_token,'claimed',statement_timestamp(),NULL);
  RETURN QUERY SELECT 'acquired'::text;
EXCEPTION WHEN unique_violation THEN
  RETURN QUERY SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.voice_external_action_claims AS actions WHERE actions.organization_id=p_organization_id AND actions.call_id=p_call_id AND actions.turn_id=p_turn_id AND actions.action_key=p_action_key AND actions.claim_token=p_claim_token AND actions.status='claimed'
  ) THEN 'acquired' ELSE 'terminal' END;
END $$;

CREATE OR REPLACE FUNCTION public.finish_voice_external_action(p_organization_id uuid,p_call_id text,p_turn_id uuid,p_action_key text,p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_outcome NOT IN ('completed','uncertain') THEN RAISE EXCEPTION 'invalid outcome'; END IF;
  UPDATE public.voice_external_action_claims AS actions SET status=p_outcome,finished_at=statement_timestamp()
   WHERE actions.organization_id=p_organization_id AND actions.call_id=p_call_id AND actions.turn_id=p_turn_id AND actions.action_key=p_action_key AND actions.status='claimed';
END $$;

REVOKE ALL ON FUNCTION public.claim_voice_turn(uuid,text,uuid,integer,text,uuid), public.complete_voice_turn(uuid,text,uuid), public.mark_voice_turn_uncertain(uuid,text,uuid),
 public.is_authoritative_voice_turn(uuid,text,uuid), public.claim_voice_external_action(uuid,text,uuid,text,uuid),
 public.finish_voice_external_action(uuid,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_voice_turn(uuid,text,uuid,integer,text,uuid), public.complete_voice_turn(uuid,text,uuid), public.mark_voice_turn_uncertain(uuid,text,uuid),
 public.is_authoritative_voice_turn(uuid,text,uuid), public.claim_voice_external_action(uuid,text,uuid,text,uuid),
 public.finish_voice_external_action(uuid,text,uuid,text,text) TO service_role;
