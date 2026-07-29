export interface BookingIntentSignatureInput {
  customerEmail: string;
  serviceAddress: string;
  scheduledStart: string;
  scheduledEnd: string;
  technicianIds: string[];
  services: unknown;
  homeDetails: unknown;
  additionalServices: unknown;
  promotion: unknown;
}

export function buildBookingIntentSignature(
  input: BookingIntentSignatureInput,
): string {
  return JSON.stringify({
    customerEmail: input.customerEmail.trim().toLowerCase(),
    serviceAddress: input.serviceAddress.trim().replace(/\s+/g, ' '),
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    technicianIds: [...input.technicianIds].sort(),
    services: input.services,
    homeDetails: input.homeDetails,
    additionalServices: input.additionalServices,
    promotion: input.promotion,
  });
}
