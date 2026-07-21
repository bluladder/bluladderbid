UPDATE public.phone_numbers
SET e164 = '+14697472877',
    display_format = '(469) 747-2877',
    is_public = true,
    provider = 'callrail',
    description = 'Primary public BluLadder contact number. Shared CallRail line used for customer texting, calling, and voice AI. Presented anywhere a customer sees a phone number.',
    revision = revision + 1,
    updated_at = now()
WHERE purpose = 'primary_public';