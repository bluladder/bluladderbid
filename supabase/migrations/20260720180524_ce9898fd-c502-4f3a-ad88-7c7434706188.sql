
-- 1) Add explicit quote_type discriminator + server-authoritative snapshot
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS quote_type text,
  ADD COLUMN IF NOT EXISTS authoritative_snapshot jsonb;

-- Backfill: derive quote_type from existing services_json.mode where possible.
UPDATE public.quotes
   SET quote_type = CASE
     WHEN services_json ->> 'mode' = 'plan' THEN 'recurring_plan'
     WHEN services_json ->> 'mode' = 'one_time' THEN 'one_time'
     WHEN services_json ? 'paymentStructure' THEN 'recurring_plan'
     ELSE 'one_time'
   END
 WHERE quote_type IS NULL;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_quote_type_chk
  CHECK (quote_type IN ('one_time', 'recurring_plan'));

-- 2) Secure resume tokens. Raw tokens are never stored; only their SHA-256 hash.
CREATE TABLE IF NOT EXISTS public.quote_resume_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'resume',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  consumed_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  issued_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_resume_tokens_quote_idx
  ON public.quote_resume_tokens (quote_id);
CREATE INDEX IF NOT EXISTS quote_resume_tokens_active_idx
  ON public.quote_resume_tokens (quote_id, expires_at)
  WHERE revoked_at IS NULL;

-- Server-only. No anon/authenticated GRANT: the customer-facing endpoint uses
-- the service_role client and returns only safe fields.
GRANT ALL ON public.quote_resume_tokens TO service_role;

ALTER TABLE public.quote_resume_tokens ENABLE ROW LEVEL SECURITY;

-- Deny-by-default: no policies for anon/authenticated. Admins may inspect.
CREATE POLICY "Admins can view quote resume tokens"
  ON public.quote_resume_tokens FOR SELECT
  USING (public.is_admin());
