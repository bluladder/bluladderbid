import { describe, it, expect } from 'vitest';
import { PHONE_FALLBACK, PRIMARY_PUBLIC_PHONE } from './contact';

describe('contact config phone mapping', () => {
  it('primary public number is the approved 866 number', () => {
    expect(PRIMARY_PUBLIC_PHONE.e164).toBe('+18662422583');
    expect(PRIMARY_PUBLIC_PHONE.isPublic).toBe(true);
  });

  it('app/AI number is the 469 747 number and not public', () => {
    expect(PHONE_FALLBACK.app_ai.e164).toBe('+14697472877');
    expect(PHONE_FALLBACK.app_ai.isPublic).toBe(false);
  });

  it('ResponsiBid number is present but never the primary/public contact', () => {
    expect(PHONE_FALLBACK.responsibid.e164).toBe('+14692426556');
    expect(PHONE_FALLBACK.responsibid.isPublic).toBe(false);
    expect(PRIMARY_PUBLIC_PHONE.e164).not.toBe(PHONE_FALLBACK.responsibid.e164);
  });

  it('no placeholder / fake numbers in the mapping', () => {
    const values = Object.values(PHONE_FALLBACK).map((p) => p.e164);
    for (const v of values) {
      expect(v).not.toMatch(/5551234567|0000000000|1234567890/);
      expect(v).toMatch(/^\+1\d{10}$/);
    }
  });
});
