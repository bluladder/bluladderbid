import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KlamathCompliancePage } from '@/pages/KlamathCompliancePage';
import {
  KLAMATH_MESSAGING_PRIVACY_REQUIRED_STATEMENTS,
  KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS,
  KLAMATH_PRIVACY_COPY,
  KLAMATH_TERMS_COPY,
} from './klamathComplianceCopy';

interface MessagingComplianceTemplate {
  candidate: {
    publicSurfaces: {
      privacyPolicyRequiredStatements: string[];
      termsRequiredStatements: string[];
    };
  };
  ownerApproval: { status: string };
  legalReview: { status: string };
}

const template = JSON.parse(
  fs.readFileSync(
    path.resolve(
      process.cwd(),
      'docs/operations/bluladder-klamath-messaging-compliance-review.template.json',
    ),
    'utf8',
  ),
) as MessagingComplianceTemplate;

describe('Klamath compliance-only copy contract', () => {
  it('renders the exact privacy and terms statements frozen for carrier review', () => {
    expect([...KLAMATH_MESSAGING_PRIVACY_REQUIRED_STATEMENTS]).toEqual(
      template.candidate.publicSurfaces.privacyPolicyRequiredStatements,
    );
    expect([...KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS]).toEqual(
      template.candidate.publicSurfaces.termsRequiredStatements,
    );
  });

  it('includes every frozen statement exactly once in the assembled paragraphs', () => {
    const privacy = Object.values(KLAMATH_PRIVACY_COPY).join(' ');
    const terms = Object.values(KLAMATH_TERMS_COPY).join(' ');
    for (const statement of KLAMATH_MESSAGING_PRIVACY_REQUIRED_STATEMENTS) {
      expect(privacy.split(statement)).toHaveLength(2);
    }
    for (const statement of KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS) {
      expect(terms.split(statement)).toHaveLength(2);
    }
  });

  it('renders every frozen statement through the public compliance page', () => {
    const privacyPage = render(KlamathCompliancePage({
      route: '/privacy',
      publicName: 'BluLadder Klamath',
      tagline: 'Next Level Clean',
      publicContactReady: false,
      publicContacts: [],
    }));
    for (const statement of KLAMATH_MESSAGING_PRIVACY_REQUIRED_STATEMENTS) {
      expect(privacyPage.container.textContent).toContain(statement);
    }
    cleanup();

    const termsPage = render(KlamathCompliancePage({
      route: '/terms',
      publicName: 'BluLadder Klamath',
      tagline: 'Next Level Clean',
      publicContactReady: false,
      publicContacts: [],
    }));
    for (const statement of KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS) {
      expect(termsPage.container.textContent).toContain(statement);
    }
  });

  it('does not convert exact copy alignment into owner or legal approval', () => {
    expect(template.ownerApproval.status).toBe('pending');
    expect(template.legalReview.status).toBe('pending');
  });
});
