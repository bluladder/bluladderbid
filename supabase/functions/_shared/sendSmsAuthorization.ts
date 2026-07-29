export interface SmsEventAuthorizationInput {
  serviceCaller: boolean;
  eventType: string;
  bookingId?: string;
  quoteId?: string;
  resumeToken?: string;
}

type VerifyQuoteCapability = (
  quoteId: string,
  resumeToken: string,
) => Promise<boolean>;

export async function authorizeSmsEventRequest(
  input: SmsEventAuthorizationInput,
  verifyQuoteCapability: VerifyQuoteCapability,
): Promise<boolean> {
  if (input.serviceCaller) return true;

  if (
    input.eventType !== "quote_created" ||
    !input.quoteId ||
    input.bookingId ||
    typeof input.resumeToken !== "string"
  ) {
    return false;
  }

  return await verifyQuoteCapability(input.quoteId, input.resumeToken);
}
