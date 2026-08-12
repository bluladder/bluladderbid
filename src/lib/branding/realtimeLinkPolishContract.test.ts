import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Realtime link customer-facing polish contract', () => {
  it('uses BluLadder-owned link-preview and icon assets', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toContain('lovable.dev/opengraph-image');
    expect(html).toContain('https://bid.bluladder.com/bluladder-og.png');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/bluladder-icon.png"');
    expect(existsSync(resolve(process.cwd(), 'public/bluladder-og.png'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'public/bluladder-icon.png'))).toBe(true);

    const png = readFileSync(resolve(process.cwd(), 'public/bluladder-og.png'));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('keeps the appointment dialog on the non-circular text path', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/MyAppointments.tsx'),
      'utf8',
    );
    expect(source).toContain('Text our team');
    expect(source).toContain('Text our team and we\'ll review your request');
    expect(source).toContain('please reschedule my appointment');
    expect(source).not.toContain('Text or call us');
    expect(source).not.toContain('Call {PRIMARY_PUBLIC_PHONE.display}');
  });
});
