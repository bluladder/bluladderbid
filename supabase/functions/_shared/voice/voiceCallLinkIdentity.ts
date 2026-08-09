/** Durable SMS identity shared by the active-call link tools and final-event
 * fallback. The first accepted link purpose wins for a call and destination. */
export function buildVoiceCallLinkOutboundKey(
  callId: string,
  phoneE164: string,
): string {
  return `voice_call_bid_link:${callId}:${
    phoneE164.replace(/\D/g, "").slice(-10)
  }`;
}
