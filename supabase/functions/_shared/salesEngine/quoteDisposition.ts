export type EngineStatus = "firm" | "estimated" | "manual_review_required" | "missing_information" | "error" | "pricing_unavailable";
export type ProductPolicyStatus = "approved" | "manual_review_required" | "owner_decision_required";
export type ChannelEligibility = "eligible" | "ineligible" | "owner_decision_required";
export type FinalQuoteDisposition = "firm" | "estimated" | "incomplete" | "manual_review" | "owner_decision_required" | "error";

export interface QuoteDisposition {
  engineStatus: EngineStatus;
  productPolicyStatus: ProductPolicyStatus;
  channelEligibility: ChannelEligibility;
  finalQuoteDisposition: FinalQuoteDisposition;
  reasons: string[];
}

export function resolveQuoteDisposition(input: {
  engineStatus: EngineStatus;
  productPolicyStatus?: ProductPolicyStatus;
  channelEligibility?: ChannelEligibility;
  reasons?: readonly string[];
}): QuoteDisposition {
  const productPolicyStatus = input.productPolicyStatus ?? "approved";
  const channelEligibility = input.channelEligibility ?? "eligible";
  let finalQuoteDisposition: FinalQuoteDisposition;
  if (input.engineStatus === "error" || input.engineStatus === "pricing_unavailable") finalQuoteDisposition = "error";
  else if (input.engineStatus === "missing_information") finalQuoteDisposition = "incomplete";
  else if (input.engineStatus === "manual_review_required" || productPolicyStatus === "manual_review_required" || channelEligibility === "ineligible") finalQuoteDisposition = "manual_review";
  else if (productPolicyStatus === "owner_decision_required" || channelEligibility === "owner_decision_required") finalQuoteDisposition = "owner_decision_required";
  else finalQuoteDisposition = input.engineStatus === "estimated" ? "estimated" : "firm";
  return { engineStatus: input.engineStatus, productPolicyStatus, channelEligibility, finalQuoteDisposition, reasons:[...(input.reasons ?? [])] };
}
