import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('Meta conversion integration contract', () => {
  it('fires Lead only after save-quote returns its durable quote id', () => {
    const source = readSource('../../components/homeowner/OneTimeSummary.tsx');
    const persistence = source.indexOf("supabase.functions.invoke('save-quote'");
    const durableResponse = source.indexOf('if (resp?.quoteId)');
    const lead = source.indexOf('fireLead({');

    expect(persistence).toBeGreaterThan(-1);
    expect(durableResponse).toBeGreaterThan(persistence);
    expect(lead).toBeGreaterThan(durableResponse);
    expect(source.match(/fireLead\s*\(\{/g)).toHaveLength(1);
  });

  it('fires InitiateCheckout from the scheduling entry action before opening intake', () => {
    const source = readSource('../../components/homeowner/OneTimeSummary.tsx');
    const handler = source.slice(
      source.indexOf('const handleEnterScheduling'),
      source.indexOf('// Show booking flow'),
    );

    expect(handler.indexOf('fireInitiateCheckout({')).toBeGreaterThan(-1);
    expect(handler.indexOf('setShowBookingFlow(true)')).toBeGreaterThan(
      handler.indexOf('fireInitiateCheckout({'),
    );
    expect(source).toContain('onClick={handleEnterScheduling}');
  });

  it('fires Schedule only inside the durable booking plus Jobber confirmation branch', () => {
    const source = readSource('../../components/booking/BookingFlow.tsx');
    const confirmation = source.indexOf('if (data.bookingId && data.jobberVisitId)');
    const schedule = source.indexOf('fireSchedule(bookingForPixel)');

    expect(confirmation).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(confirmation);
    expect(source.match(/fireSchedule\s*\(bookingForPixel\)/g)).toHaveLength(1);
    expect(source).not.toContain('CompleteRegistration');
    expect(source).not.toContain('Purchase');
  });

  it('checks explicit consent denial before loading or initializing Meta', () => {
    const source = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const consentCheck = source.indexOf('=== "denied"');
    const loader = source.indexOf('connect.facebook.net/en_US/fbevents.js');
    const pageView = source.indexOf('fbq("track", "PageView")');

    expect(consentCheck).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(consentCheck);
    expect(pageView).toBeGreaterThan(consentCheck);
  });
});
