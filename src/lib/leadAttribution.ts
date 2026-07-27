export type AttributionTouch = {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  referrer?: string | null;
  landingPage?: string | null;
  capturedAt?: string | null;
};

export type LeadAttribution = {
  selfReportedSource: string | null;
  selfReportedSourceDetail: string | null;
  normalizedSourceKey: string | null;
  attributionSource: string | null;
  attributionMedium: string | null;
  attributionCampaign: string | null;
  attributionContent: string | null;
  firstTouch: AttributionTouch | null;
  lastTouch: AttributionTouch | null;
  callrailTrackingNumber: string | null;
  callrailCampaign: string | null;
};

export type LeadSourceDefinition = {
  sourceKey: string;
  displayName: string;
  aliases: string[];
  isOther?: boolean;
  isActive?: boolean;
};

const clean = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const comparable = (value: string): string =>
  value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

export function normalizeLeadSource(
  value: string | null | undefined,
  definitions: LeadSourceDefinition[],
): string | null {
  const input = clean(value);
  if (!input) return null;
  const key = comparable(input);

  const match = definitions.find((definition) => {
    if (definition.isActive === false) return false;
    return [definition.sourceKey, definition.displayName, ...definition.aliases]
      .some((candidate) => comparable(candidate) === key);
  });

  return match?.sourceKey ?? null;
}

export function validateLeadSourceSelection(args: {
  sourceKey: string | null | undefined;
  sourceDetail?: string | null;
  definitions: LeadSourceDefinition[];
}): { valid: true } | { valid: false; reason: "missing" | "inactive" | "detail_required" } {
  const sourceKey = clean(args.sourceKey);
  if (!sourceKey) return { valid: false, reason: "missing" };

  const source = args.definitions.find((item) => item.sourceKey === sourceKey);
  if (!source || source.isActive === false) return { valid: false, reason: "inactive" };
  if (source.isOther && !clean(args.sourceDetail)) {
    return { valid: false, reason: "detail_required" };
  }

  return { valid: true };
}

export function mergeAttribution(
  current: LeadAttribution | null | undefined,
  incoming: Partial<LeadAttribution>,
): LeadAttribution {
  const firstTouch = current?.firstTouch ?? incoming.firstTouch ?? null;
  const lastTouch = incoming.lastTouch ?? current?.lastTouch ?? incoming.firstTouch ?? null;

  return {
    selfReportedSource: clean(incoming.selfReportedSource) ?? current?.selfReportedSource ?? null,
    selfReportedSourceDetail: clean(incoming.selfReportedSourceDetail) ?? current?.selfReportedSourceDetail ?? null,
    normalizedSourceKey: clean(incoming.normalizedSourceKey) ?? current?.normalizedSourceKey ?? null,
    attributionSource: clean(incoming.attributionSource) ?? current?.attributionSource ?? null,
    attributionMedium: clean(incoming.attributionMedium) ?? current?.attributionMedium ?? null,
    attributionCampaign: clean(incoming.attributionCampaign) ?? current?.attributionCampaign ?? null,
    attributionContent: clean(incoming.attributionContent) ?? current?.attributionContent ?? null,
    firstTouch,
    lastTouch,
    callrailTrackingNumber: clean(incoming.callrailTrackingNumber) ?? current?.callrailTrackingNumber ?? null,
    callrailCampaign: clean(incoming.callrailCampaign) ?? current?.callrailCampaign ?? null,
  };
}

export function buildJobberLeadSourcePayload(args: {
  entityType: "quote" | "booking" | "customer";
  entityId: string;
  attribution: LeadAttribution;
  mappingMode: "native" | "custom_field" | "internal_note" | "disabled";
  mappingKey?: string | null;
}) {
  const source = args.attribution.normalizedSourceKey ?? args.attribution.selfReportedSource;
  const detail = clean(args.attribution.selfReportedSourceDetail);
  const rendered = [source, detail].filter(Boolean).join(": ");
  const idempotencyKey = ["jobber", args.entityType, args.entityId, source ?? "unknown"].join(":");

  if (args.mappingMode === "disabled" || !source) {
    return { idempotencyKey, mode: "disabled" as const, payload: null };
  }
  if (args.mappingMode === "native") {
    return { idempotencyKey, mode: "native" as const, payload: { leadSource: rendered } };
  }
  if (args.mappingMode === "custom_field") {
    return {
      idempotencyKey,
      mode: "custom_field" as const,
      payload: { customFieldKey: args.mappingKey ?? "bluladder_lead_source", value: rendered },
    };
  }

  return {
    idempotencyKey,
    mode: "internal_note" as const,
    payload: { note: `BluLadder lead source: ${rendered}` },
  };
}
