
REVOKE ALL ON FUNCTION public.record_consent(public.consent_channel, public.consent_type, public.consent_status, text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consent_allows(public.consent_channel, public.consent_type, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consent(public.consent_channel, public.consent_type, public.consent_status, text, text, text, text, uuid, uuid, text, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.consent_allows(public.consent_channel, public.consent_type, text, text) TO service_role, authenticated;
