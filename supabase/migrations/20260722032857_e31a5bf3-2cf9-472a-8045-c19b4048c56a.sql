-- Deactivate the retired ResponsiBid phone-number row so no code path can
-- resolve it as primary, public, AI, SMS, transfer, or fallback. Idempotent:
-- if the row is already inactive or already missing, this is a no-op.
UPDATE public.phone_numbers
   SET is_active = false,
       is_public = false,
       description = COALESCE(description, '') ||
         CASE
           WHEN description IS NULL OR description NOT LIKE '%[retired %'
             THEN E'\n[retired ' || to_char(now(), 'YYYY-MM-DD') ||
                  '] Retired from active BluLadder Bid use. Do not select for voice, SMS, transfer, booking, support, public display, or AI prompts.'
           ELSE ''
         END
 WHERE purpose = 'responsibid'
   AND e164 = '+14692426556'
   AND (is_active = true OR is_public = true);