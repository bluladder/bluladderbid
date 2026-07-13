import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  PHONE_FALLBACK,
  type PhoneEntry,
  type PhonePurpose,
} from '@/config/contact';

/**
 * Reads the admin-editable `phone_numbers` table and exposes a lookup by
 * PURPOSE. Falls back to the approved constants until the row loads, so the
 * correct number is always shown and never guessed.
 */
export function usePhoneNumbers() {
  const [byPurpose, setByPurpose] = useState<Record<string, PhoneEntry>>(
    PHONE_FALLBACK,
  );

  useEffect(() => {
    let active = true;
    supabase
      .from('phone_numbers')
      .select('purpose, e164, display_format, label, is_public, is_active')
      .eq('is_active', true)
      .then(({ data }) => {
        if (!active || !data) return;
        const map: Record<string, PhoneEntry> = { ...PHONE_FALLBACK };
        for (const row of data) {
          map[row.purpose] = {
            purpose: row.purpose as PhonePurpose,
            e164: row.e164,
            display: row.display_format,
            label: row.label,
            isPublic: row.is_public,
          };
        }
        setByPurpose(map);
      });
    return () => {
      active = false;
    };
  }, []);

  const get = (purpose: PhonePurpose): PhoneEntry =>
    byPurpose[purpose] ?? PHONE_FALLBACK[purpose];

  return { get, primary: get('primary_public'), all: byPurpose };
}
