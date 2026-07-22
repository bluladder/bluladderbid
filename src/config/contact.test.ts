import { describe, it, expect } from 'vitest';
import {
  PHONE_FALLBACK,
  PRIMARY_PUBLIC_PHONE,
  RETIRED_PHONE_NUMBERS,
} from './contact';

describe('contact config phone mapping', () => {
  it('primary public number is the approved 469 CallRail number', () => {
    expect(PRIMARY_PUBLIC_PHONE.e164).toBe('+14697472877');
    expect(PRIMARY_PUBLIC_PHONE.isPublic).toBe(true);
  });

  it('app/AI number is the 469 747 number and not public', () => {
    expect(PHONE_FALLBACK.app_ai.e164).toBe('+14697472877');
    expect(PHONE_FALLBACK.app_ai.isPublic).toBe(false);
  });

  it('retired ResponsiBid number is removed from the active phone registry', () => {
    // The former ResponsiBid line MUST NOT be selectable as any active
    // purpose (public, AI, SMS source, booking, transfer, fallback).
    const values = Object.values(PHONE_FALLBACK).map((p) => p.e164);
    expect(values).not.toContain('+14692426556');
    for (const purpose of Object.keys(PHONE_FALLBACK)) {
      // TypeScript union no longer includes 'responsibid'; runtime lookup must
      // also refuse to resolve it as an active entry.
      expect(purpose).not.toBe('responsibid');
    }
  });

  it('retired numbers are listed for defense-in-depth redaction only', () => {
    const retired = RETIRED_PHONE_NUMBERS.find(
      (r) => r.e164 === '+14692426556',
    );
    expect(retired).toBeDefined();
    expect(retired?.reason).toBe('retired_responsibid');
    // Retired numbers must not be exposed as the customer-facing primary.
    expect(PRIMARY_PUBLIC_PHONE.e164).not.toBe(retired?.e164);
  });

  it('no placeholder / fake numbers in the mapping', () => {
    const values = Object.values(PHONE_FALLBACK).map((p) => p.e164);
    for (const v of values) {
      expect(v).not.toMatch(/5551234567|0000000000|1234567890/);
      expect(v).toMatch(/^\+1\d{10}$/);
    }
  });
});
