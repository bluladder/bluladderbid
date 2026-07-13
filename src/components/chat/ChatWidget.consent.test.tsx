import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatWidget, { MARKETING_CONSENT_LANGUAGE } from './ChatWidget';

// jsdom does not implement Element.scrollTo, which the widget calls on mount.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).scrollTo = () => {};
});

// Consent-safety guardrails for the AI chat widget.
describe('ChatWidget marketing consent', () => {
  it('exposes explicit, descriptive marketing consent language', () => {
    expect(MARKETING_CONSENT_LANGUAGE).toMatch(/promotion/i);
    expect(MARKETING_CONSENT_LANGUAGE).toMatch(/not required/i);
  });

  it('never preselects marketing consent (checkbox starts unchecked)', () => {
    render(<ChatWidget />);
    fireEvent.click(screen.getByLabelText(/open chat/i));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});
