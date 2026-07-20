
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS decline_notes text,
  ADD COLUMN IF NOT EXISTS decline_source text,
  ADD COLUMN IF NOT EXISTS decline_version integer,
  ADD COLUMN IF NOT EXISTS declined_by uuid;

CREATE INDEX IF NOT EXISTS idx_quotes_declined_at ON public.quotes (declined_at) WHERE declined_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_decline_reason ON public.quotes (decline_reason) WHERE decline_reason IS NOT NULL;

COMMENT ON COLUMN public.quotes.decline_reason IS 'Structured reason code chosen by the customer (or admin) when the quote is declined.';
COMMENT ON COLUMN public.quotes.decline_notes IS 'Optional free-form notes provided at decline time.';
COMMENT ON COLUMN public.quotes.decline_source IS 'Where the decline was initiated: customer_quote_view, admin, api.';
COMMENT ON COLUMN public.quotes.decline_version IS 'quotes.pricing_rule_version at time of decline (for auditing).';
COMMENT ON COLUMN public.quotes.declined_by IS 'auth.uid() of the admin who declined on behalf of the customer, if any.';
