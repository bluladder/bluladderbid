import { describe, expect, it } from 'vitest';
import {
  decidePublicSurface,
  parsePublicSiteBootstrap,
  publicContactHref,
  type PublicSiteBootstrap,
} from './klamathPublicSurface';

const bootstrap: PublicSiteBootstrap = {
  status: 'resolved',
  tenantKey: 'bluladder-klamath',
  publicName: 'BluLadder Klamath',
  tagline: 'Next Level Clean',
  accessMode: 'compliance_only',
  complianceRoutes: ['/privacy', '/terms', '/contact'],
  customerRuntimeReady: false,
  publicContactReady: false,
  publicContacts: [],
};

describe('Klamath public surface boundary', () => {
  it('preserves the exact DFW production host and development previews', () => {
    expect(decidePublicSurface('bid.bluladder.com', '/', null)).toEqual({
      mode: 'existing_dfw',
    });
    expect(decidePublicSurface('localhost', '/', null)).toEqual({
      mode: 'development_preview',
    });
    expect(decidePublicSurface('preview.lovable.app', '/', null)).toEqual({
      mode: 'development_preview',
    });
  });

  it.each([
    ['/klamath', '/opt-in'],
    ['/klamath/privacy', '/privacy'],
    ['/klamath/terms/', '/terms'],
    ['/klamath/contact', '/contact'],
  ] as const)('exposes only the exact Klamath compliance path %s on the DFW host', (path, route) => {
    expect(decidePublicSurface('bid.bluladder.com', path, null)).toEqual({
      mode: 'klamath_compliance',
      route,
      pathPrefix: '/klamath',
      publicName: 'BluLadder Klamath',
      tagline: 'Next Level Clean',
      publicContactReady: false,
      publicContacts: [],
    });
  });

  it('does not let neighboring or customer-action paths escape into the Klamath surface', () => {
    for (const path of ['/klamathish', '/klamath/services', '/klamath/quote/example']) {
      expect(decidePublicSurface('bid.bluladder.com', path, null)).toEqual({
        mode: 'existing_dfw',
      });
    }
  });

  it('blocks unknown hosts and Klamath without server authority', () => {
    expect(decidePublicSurface('other.example.com', '/', null)).toEqual({
      mode: 'blocked',
      reason: 'unknown_host',
    });
    expect(decidePublicSurface('klamath.bluladder.com', '/privacy', null)).toEqual({
      mode: 'blocked',
      reason: 'site_unavailable',
    });
  });

  it.each(['/privacy', '/terms', '/contact'] as const)(
    'allows only the exact compliance route %s after bootstrap',
    (route) => {
      expect(decidePublicSurface('klamath.bluladder.com', route, bootstrap)).toEqual({
        mode: 'klamath_compliance',
        route,
        pathPrefix: '',
        publicName: 'BluLadder Klamath',
        tagline: 'Next Level Clean',
        publicContactReady: false,
        publicContacts: [],
      });
    },
  );

  it('keeps quote, booking, portal, admin, chat entry, and root routes blocked', () => {
    for (const route of ['/', '/services', '/quote/example', '/customer-portal', '/admin']) {
      expect(decidePublicSurface('klamath.bluladder.com', route, bootstrap)).toEqual({
        mode: 'blocked',
        reason: 'route_unavailable',
      });
    }
  });

  it('does not treat a provider customer mode as customer-runtime authority', () => {
    const customer = { ...bootstrap, accessMode: 'customer' as const };
    expect(decidePublicSurface('klamath.bluladder.com', '/', customer)).toEqual({
      mode: 'blocked',
      reason: 'route_unavailable',
    });
  });

  it('rejects malformed, cross-tenant, reordered, or readiness-enabling payloads', () => {
    expect(parsePublicSiteBootstrap(bootstrap)).toEqual(bootstrap);
    for (const value of [
      null,
      { ...bootstrap, tenantKey: 'bluladder-dfw' },
      { ...bootstrap, publicName: 'BluLadder' },
      { ...bootstrap, complianceRoutes: ['/terms', '/privacy', '/contact'] },
      { ...bootstrap, customerRuntimeReady: true },
      { ...bootstrap, publicContactReady: true },
      { ...bootstrap, publicContacts: [{ channel: 'phone', label: 'Phone', value: 'not-e164' }] },
    ]) {
      expect(parsePublicSiteBootstrap(value)).toBeNull();
    }
  });

  it('accepts only normalized unique reviewed contact payloads', () => {
    const published = {
      ...bootstrap,
      publicContactReady: true,
      publicContacts: [
        { channel: 'phone' as const, label: 'Call support', value: '+15415550100' },
        { channel: 'sms' as const, label: 'Text support', value: '+15415550102' },
        { channel: 'email' as const, label: 'Email support', value: 'support@example.com' },
      ],
    };
    expect(parsePublicSiteBootstrap(published)).toEqual(published);
    expect(decidePublicSurface('klamath.bluladder.com', '/contact', published)).toMatchObject({
      mode: 'klamath_compliance',
      publicContactReady: true,
      publicContacts: published.publicContacts,
    });
    expect(published.publicContacts.map(publicContactHref)).toEqual([
      'tel:+15415550100',
      'sms:+15415550102',
      'mailto:support@example.com',
    ]);
    for (const contacts of [
      [{ channel: 'email', label: 'Email', value: 'UPPER@example.com' }],
      [{ channel: 'phone', label: ' Phone ', value: '+15415550100' }],
      [{ channel: 'sms', label: 'Text', value: '5415550102' }],
      [
        { channel: 'phone', label: 'One', value: '+15415550100' },
        { channel: 'phone', label: 'Two', value: '+15415550101' },
      ],
      [
        { channel: 'sms', label: 'One', value: '+15415550102' },
        { channel: 'sms', label: 'Two', value: '+15415550103' },
      ],
    ]) {
      expect(parsePublicSiteBootstrap({ ...published, publicContacts: contacts })).toBeNull();
    }
  });
});
