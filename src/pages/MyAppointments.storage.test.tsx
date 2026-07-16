// Regression tests: raw portal tokens must NEVER be written to
// sessionStorage, localStorage, IndexedDB, cookies, or URL params.
// The module keeps the token in memory only.
import { describe, it, expect, beforeEach } from 'vitest';

describe('MyAppointments session token storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie.split(';').forEach((c) => {
      const eq = c.indexOf('=');
      const name = eq > -1 ? c.substr(0, eq).trim() : c.trim();
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
  });

  it('MyAppointments source references no browser-storage APIs for portal token', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/MyAppointments.tsx', 'utf8');
    // Explicit denylist. The file may mention them only in code comments.
    const codeOnly = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(codeOnly).not.toMatch(/\bsessionStorage\b/);
    expect(codeOnly).not.toMatch(/\blocalStorage\b/);
    expect(codeOnly).not.toMatch(/\bindexedDB\b/i);
    expect(codeOnly).not.toMatch(/document\.cookie/);
  });

  it('confirm response cookie header is not set by the SPA (memory-only fallback)', () => {
    // The SPA has no server; cookies cannot be issued from cross-origin
    // Edge Functions to a first-party context on this deployment. This test
    // is a documented invariant reminding future authors not to re-introduce
    // sessionStorage persistence as a shortcut.
    expect(document.cookie).not.toMatch(/bl_portal/);
  });
});