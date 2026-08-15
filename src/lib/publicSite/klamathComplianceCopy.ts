/**
 * Exact repository candidate for the Klamath compliance-only surface.
 *
 * These statements are mechanically compared with the messaging-compliance
 * review template. They remain candidate copy until the separate owner and
 * qualified legal/compliance gates are recorded as complete.
 */
export const KLAMATH_MESSAGING_PRIVACY_REQUIRED_STATEMENTS = [
  'We do not share, sell, rent, transfer, or otherwise provide mobile phone numbers, text messaging opt-in data, or messaging consent to third parties, affiliates, or lead generators for marketing or promotional purposes.',
  'Message frequency varies.',
  'Message and data rates may apply.',
  'Reply STOP to opt out and HELP for help.',
] as const;

export const KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS = [
  'The messaging program is operated by BluLadder Klamath.',
  'Messages may include requested quote and booking links, reminders, operator follow-up, and authentication. Marketing and promotional messages are outside this launch program.',
  'Message frequency varies and message and data rates may apply.',
  'Reply STOP to opt out and HELP for help.',
  'For customer support, reply HELP or visit https://klamath.bluladder.com/contact.',
  'Privacy Policy: https://klamath.bluladder.com/privacy.',
  'Carriers are not liable for delayed or undelivered messages.',
  'Consent is not a condition of purchase.',
] as const;

export const KLAMATH_PRIVACY_COPY = {
  informationUse:
    'We use information you provide to prepare requested quotes, manage requested bookings, provide service reminders, respond to support requests, and protect account access.',
  mobileInformation: KLAMATH_MESSAGING_PRIVACY_REQUIRED_STATEMENTS.join(' '),
  choices:
    'Transactional messages are limited to the service you request. Marketing messages require a separate, unchecked opt-in and are not a condition of purchase.',
} as const;

export const KLAMATH_TERMS_COPY = {
  messagingProgram: KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS.slice(0, 2).join(' '),
  frequencyAndCarrierTerms: KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS.slice(2, 7).join(' '),
  consent: `${KLAMATH_MESSAGING_TERMS_REQUIRED_STATEMENTS[7]} Transactional consent applies only to the quote, booking, reminder, support, or authentication service requested.`,
} as const;
