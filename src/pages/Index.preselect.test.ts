import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Structural guarantee: quote_started must fire ONLY from a user-interaction
 * handler on the homeowner Index page. React effects, programmatic
 * preselection, or default state must not be able to trigger it.
 *
 * A visitor landing on `/?embed=1&preselect_service=window-cleaning` with no
 * interaction must NOT produce a quote_started message. Preselection is not
 * wired into Index's `additionalServices` state at mount time, and the bridge
 * call site lives inside `handleAdditionalServicesChange` — the click/toggle
 * handler — never inside a `useEffect`.
 */
describe('Index quote_started trigger placement', () => {
  const source = readFileSync(resolve(__dirname, 'Index.tsx'), 'utf8');

  it('does not import useEffect (no effect-based bridge fire)', () => {
    // A future refactor that reintroduces useEffect must be reviewed against
    // this invariant. If useEffect is legitimately needed, this assertion can
    // be relaxed but the bridge-fire-from-effect ban below must stay.
    expect(source).not.toMatch(/from 'react';[\s\S]*useEffect/);
  });

  it('does not fire bridgeFireQuoteStarted from a useEffect body', () => {
    // Any useEffect(...) block containing bridgeFireQuoteStarted would break
    // the "no programmatic fire" guarantee for preselection.
    const effectBlocks = source.match(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[[\s\S]*?\]\s*\)/g) ?? [];
    for (const block of effectBlocks) {
      expect(block).not.toMatch(/bridgeFireQuoteStarted/);
    }
  });

  it('fires bridgeFireQuoteStarted only inside handleAdditionalServicesChange', () => {
    // The exact interaction handler for service toggles.
    const handler = source.match(
      /handleAdditionalServicesChange\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s{2}\};/,
    );
    expect(handler, 'handleAdditionalServicesChange not found').toBeTruthy();
    expect(handler![0]).toMatch(/bridgeFireQuoteStarted/);

    // And there is exactly one call site in the file.
    const callSites = source.match(/bridgeFireQuoteStarted\s*\(/g) ?? [];
    expect(callSites.length).toBe(1);
  });

  it('DEFAULT_ADDITIONAL_SERVICES has no service enabled (preselect query param cannot pre-fire)', async () => {
    const { DEFAULT_ADDITIONAL_SERVICES } = await import('@/types/homeowner');
    const { hasAnyServiceSelected } = await import('@/lib/pricing/toQuoteInput');
    expect(hasAnyServiceSelected(DEFAULT_ADDITIONAL_SERVICES)).toBe(false);
  });
});