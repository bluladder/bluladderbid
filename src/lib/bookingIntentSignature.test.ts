import { describe, expect, it } from 'vitest';
import { buildBookingIntentSignature } from './bookingIntentSignature';

const base = {
  customerEmail: 'Customer@Example.com',
  serviceAddress: '123 Main St, Aubrey, TX 76227',
  scheduledStart: '2026-08-01T14:00:00Z',
  scheduledEnd: '2026-08-01T16:00:00Z',
  technicianIds: ['tech-2', 'tech-1'],
  services: [{ name: 'Window Cleaning', price: 200 }],
  homeDetails: { squareFootage: 2000 },
  additionalServices: { windowCleaning: true },
  promotion: null,
};

describe('buildBookingIntentSignature', () => {
  it('is stable for the same normalized booking intent', () => {
    expect(buildBookingIntentSignature(base)).toBe(
      buildBookingIntentSignature({
        ...base,
        customerEmail: ' customer@example.com ',
        serviceAddress: '123  Main St, Aubrey, TX 76227',
        technicianIds: ['tech-1', 'tech-2'],
      }),
    );
  });

  it.each([
    ['service', { services: [{ name: 'House Wash', price: 300 }] }],
    ['property', { homeDetails: { squareFootage: 2500 } }],
    ['add-on', { additionalServices: { gutterCleaning: true } }],
    ['promotion', { promotion: { id: 'windows-99' } }],
    ['address', { serviceAddress: '125 Main St, Aubrey, TX 76227' }],
  ])('rotates when %s intent changes', (_label, patch) => {
    expect(buildBookingIntentSignature({ ...base, ...patch })).not.toBe(
      buildBookingIntentSignature(base),
    );
  });
});
