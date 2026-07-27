export type ServiceKey =
  | 'window_cleaning'
  | 'gutter_cleaning'
  | 'gutter_guards'
  | 'house_wash'
  | 'driveway_cleaning'
  | 'roof_cleaning'
  | 'solar_panel_cleaning'
  | 'screen_repair'
  | 'christmas_lights'
  | 'commercial_services';

export interface CustomerFeatureSnapshot {
  asOf: string;
  lifetimeValue: number;
  completedJobCount: number;
  cancellationCount: number;
  daysSinceLastCompleted: number | null;
  serviceCounts: Partial<Record<ServiceKey, number>>;
  serviceLastCompletedAt: Partial<Record<ServiceKey, string>>;
  inferredServiceCadenceDays: Partial<Record<ServiceKey, number>>;
  recentComplaint: boolean;
  recentCancellation: boolean;
  season: 'winter' | 'spring' | 'summer' | 'fall';
  /** Archived Jobber clients are never eligible for recommendations or learning. */
  isArchived?: boolean;
}

export interface RecommendationModel {
  modelKey: string;
  version: number;
  weights: Record<string, number>;
  bounds: {
    minWeight: number;
    maxWeight: number;
    maxDeltaPerRun: number;
    minimumOutcomes: number;
    minimumPositiveOutcomes: number;
  };
  priors: {
    baseProbability: number;
    serviceDefaultCadenceDays: Partial<Record<ServiceKey, number>>;
  };
}

export interface RecommendationCandidate {
  serviceKey: ServiceKey;
  score: number;
  confidence: number;
  reasonCodes: string[];
  evidence: Array<{ key: string; value: string | number | boolean }>;
  explanation: string;
}

const SERVICE_SEASON: Partial<Record<ServiceKey, CustomerFeatureSnapshot['season'][]>> = {
  gutter_cleaning: ['fall', 'winter'],
  gutter_guards: ['spring', 'summer', 'fall'],
  house_wash: ['spring', 'summer'],
  driveway_cleaning: ['spring', 'summer'],
  window_cleaning: ['spring', 'summer', 'fall'],
  solar_panel_cleaning: ['spring', 'summer'],
  christmas_lights: ['fall', 'winter'],
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function daysBetween(asOf: string, earlier: string): number {
  return Math.max(0, Math.floor((new Date(asOf).getTime() - new Date(earlier).getTime()) / 86_400_000));
}

export function scoreServiceRecommendation(args: {
  serviceKey: ServiceKey;
  features: CustomerFeatureSnapshot;
  model: RecommendationModel;
}): RecommendationCandidate {
  const { serviceKey, features, model } = args;

  if (features.isArchived) {
    return {
      serviceKey,
      score: 0,
      confidence: 1,
      reasonCodes: ['ARCHIVED_CLIENT_EXCLUDED'],
      evidence: [
        { key: 'model_version', value: model.version },
        { key: 'archived_client', value: true },
      ],
      explanation: 'Archived Jobber clients are excluded from recommendations and model learning.',
    };
  }

  const cadence = features.inferredServiceCadenceDays[serviceKey]
    ?? model.priors.serviceDefaultCadenceDays[serviceKey]
    ?? 365;
  const lastCompleted = features.serviceLastCompletedAt[serviceKey];
  const serviceCount = features.serviceCounts[serviceKey] ?? 0;
  const daysSinceService = lastCompleted ? daysBetween(features.asOf, lastCompleted) : null;
  const dueRatio = daysSinceService == null ? 0 : daysSinceService / Math.max(1, cadence);
  const recencyDue = dueRatio >= 1 ? Math.min(2, dueRatio) : 0;
  const priorService = serviceCount > 0 ? Math.min(1, serviceCount / 3) : 0;
  const crossSellGap = serviceCount === 0 && features.completedJobCount > 0 ? 1 : 0;
  const seasonMatch = SERVICE_SEASON[serviceKey]?.includes(features.season) ? 1 : 0;
  const repeatCustomer = features.completedJobCount >= 2 ? 1 : 0;
  const recentComplaint = features.recentComplaint ? 1 : 0;
  const recentCancellation = features.recentCancellation ? 1 : 0;

  const weighted =
    Math.log(model.priors.baseProbability / (1 - model.priors.baseProbability))
    + (model.weights.recency_due ?? 0) * recencyDue
    + (model.weights.prior_service ?? 0) * priorService
    + (model.weights.cross_sell_gap ?? 0) * crossSellGap
    + (model.weights.season_match ?? 0) * seasonMatch
    + (model.weights.repeat_customer ?? 0) * repeatCustomer
    + (model.weights.recent_complaint ?? 0) * recentComplaint
    + (model.weights.recent_cancellation ?? 0) * recentCancellation;

  const score = clamp01(sigmoid(weighted));
  const dataPoints = Number(serviceCount > 0)
    + Number(features.completedJobCount > 0)
    + Number(daysSinceService != null)
    + Number(features.lifetimeValue > 0);
  const confidence = clamp01(0.2 + dataPoints * 0.15 + Math.min(0.2, features.completedJobCount * 0.02));

  const reasonCodes: string[] = [];
  const evidence: RecommendationCandidate['evidence'] = [
    { key: 'model_version', value: model.version },
    { key: 'service_count', value: serviceCount },
    { key: 'cadence_days', value: cadence },
  ];

  if (recencyDue > 0) {
    reasonCodes.push('SERVICE_DUE');
    evidence.push({ key: 'days_since_service', value: daysSinceService ?? 0 });
  }
  if (priorService > 0) reasonCodes.push('PRIOR_SERVICE');
  if (crossSellGap > 0) reasonCodes.push('CROSS_SELL_GAP');
  if (seasonMatch > 0) reasonCodes.push('SEASON_MATCH');
  if (repeatCustomer > 0) reasonCodes.push('REPEAT_CUSTOMER');
  if (recentComplaint > 0) reasonCodes.push('RECENT_COMPLAINT_SUPPRESSION');
  if (recentCancellation > 0) reasonCodes.push('RECENT_CANCELLATION');

  const explanation = features.recentComplaint
    ? 'Recommendation score is suppressed because a recent complaint or sensitive escalation is present.'
    : recencyDue > 0
      ? `This service appears due based on a ${cadence}-day cadence and the recorded service history.`
      : crossSellGap > 0
        ? 'This is a conservative cross-sell candidate because the customer has completed work but has no recorded history for this service.'
        : 'This is a low-confidence baseline recommendation derived from current season and customer history.';

  return {
    serviceKey,
    score: Number(score.toFixed(6)),
    confidence: Number(confidence.toFixed(6)),
    reasonCodes,
    evidence,
    explanation,
  };
}

export function rankRecommendations(args: {
  services: ServiceKey[];
  features: CustomerFeatureSnapshot;
  model: RecommendationModel;
  limit?: number;
}): RecommendationCandidate[] {
  if (args.features.isArchived) return [];

  return args.services
    .map((serviceKey) => scoreServiceRecommendation({ serviceKey, features: args.features, model: args.model }))
    .filter((candidate) => !candidate.reasonCodes.includes('RECENT_COMPLAINT_SUPPRESSION'))
    .filter((candidate) => !candidate.reasonCodes.includes('ARCHIVED_CLIENT_EXCLUDED'))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.serviceKey.localeCompare(b.serviceKey))
    .slice(0, args.limit ?? 3);
}

export type RecommendationOutcomeType =
  | 'shown'
  | 'offered'
  | 'accepted'
  | 'rejected'
  | 'ignored'
  | 'booked'
  | 'cancelled'
  | 'completed'
  | 'paid'
  | 'owner_suppressed'
  | 'owner_overridden';

export interface LearningOutcome {
  feature: string;
  outcomeType?: RecommendationOutcomeType;
  positive?: boolean;
  isArchivedClient?: boolean;
}

/** Completed and paid are strongest; accepted/booked are weaker positive signals. */
export function outcomeLearningValue(outcome: LearningOutcome): number | null {
  if (outcome.isArchivedClient) return null;
  if (typeof outcome.positive === 'boolean') return outcome.positive ? 1 : 0;

  switch (outcome.outcomeType) {
    case 'paid': return 1;
    case 'completed': return 0.95;
    case 'booked': return 0.7;
    case 'accepted': return 0.5;
    case 'offered':
    case 'shown': return null;
    case 'ignored': return 0.25;
    case 'rejected': return 0;
    case 'cancelled': return 0;
    case 'owner_suppressed':
    case 'owner_overridden': return null;
    default: return null;
  }
}

export function proposeBoundedWeightUpdate(args: {
  currentWeights: Record<string, number>;
  outcomes: LearningOutcome[];
  bounds: RecommendationModel['bounds'];
  learningRate?: number;
}): { eligible: boolean; proposedWeights: Record<string, number>; summary: Record<string, number> } {
  const eligibleOutcomes = args.outcomes
    .map((outcome) => ({ ...outcome, value: outcomeLearningValue(outcome) }))
    .filter((outcome): outcome is LearningOutcome & { value: number } => outcome.value != null);
  const positives = eligibleOutcomes.filter((outcome) => outcome.value >= 0.5).length;

  if (eligibleOutcomes.length < args.bounds.minimumOutcomes || positives < args.bounds.minimumPositiveOutcomes) {
    return { eligible: false, proposedWeights: { ...args.currentWeights }, summary: {} };
  }

  const learningRate = args.learningRate ?? 0.05;
  const grouped = new Map<string, { totalValue: number; total: number }>();
  for (const outcome of eligibleOutcomes) {
    const current = grouped.get(outcome.feature) ?? { totalValue: 0, total: 0 };
    current.total += 1;
    current.totalValue += outcome.value;
    grouped.set(outcome.feature, current);
  }

  const proposedWeights = { ...args.currentWeights };
  const summary: Record<string, number> = {};
  for (const [feature, counts] of grouped) {
    const observedRate = counts.totalValue / counts.total;
    const centeredSignal = observedRate - 0.5;
    const rawDelta = centeredSignal * learningRate;
    const delta = Math.max(-args.bounds.maxDeltaPerRun, Math.min(args.bounds.maxDeltaPerRun, rawDelta));
    const current = args.currentWeights[feature] ?? 0;
    const next = Math.max(args.bounds.minWeight, Math.min(args.bounds.maxWeight, current + delta));
    proposedWeights[feature] = Number(next.toFixed(6));
    summary[feature] = Number((next - current).toFixed(6));
  }

  return { eligible: true, proposedWeights, summary };
}
