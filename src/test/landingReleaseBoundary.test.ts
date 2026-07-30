import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const index = readFileSync(resolve(__dirname, '../pages/Index.tsx'), 'utf8');
const serviceLanding = readFileSync(resolve(__dirname, '../pages/ServiceLanding.tsx'), 'utf8');
const chatWidget = readFileSync(resolve(__dirname, '../components/chat/ChatWidget.tsx'), 'utf8');
const recurringFlow = readFileSync(
  resolve(__dirname, '../components/booking/RecurringServiceRequestFlow.tsx'),
  'utf8',
);

describe('landing release boundary', () => {
  it('does not expose a PDF action that only claims a future download', () => {
    for (const source of [index, serviceLanding]) {
      expect(source).not.toContain('handleDownloadPDF');
      expect(source).not.toContain('The PDF will download shortly');
      expect(source).not.toContain('onDownloadPDF=');
    }
  });

  it('keeps the closed chat bubble above the mobile sticky booking action', () => {
    expect(chatWidget).toContain(
      'bottom-[calc(6rem+env(safe-area-inset-bottom))]',
    );
    expect(chatWidget).toContain('sm:bottom-6');
    expect(chatWidget).toContain('z-40');
  });

  it('keeps service-specific plan failures visible and retryable', () => {
    expect(serviceLanding).toContain('planPhase={bundleState.phase}');
    expect(serviceLanding).toContain('onRetryPlan={bundleState.refetch}');
  });

  it('does not promise an unproven callback or appointment after a plan request', () => {
    expect(recurringFlow).not.toContain('within 1 business day');
    expect(recurringFlow).not.toContain("We'll call to confirm");
    expect(recurringFlow).toContain('No appointment has been scheduled yet');
  });
});
