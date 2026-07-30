UPDATE public.test_identities
SET active = false,
    note = COALESCE(note, '') || ' | 2026-07-30: deactivated by owner authorization to enable real production Jobber writes for live voice booking. Row preserved (protected=true); set active=true to restore simulation/suppression.',
    updated_at = now()
WHERE phone = '+14692150144';