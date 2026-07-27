import { describe, expect, it } from 'vitest';
import {
  outcomeLearningValue,
  proposeBoundedWeightUpdate,
  rankRecommendations,
  scoreServiceRecommendation,
  type CustomerFeatureSnapshot,
  type RecommendationModel,
} from './recommendationEngine';

const model: RecommendationModel = {
  modelKey: 'service_next_best_action',
  version: 1,
  weights: {
    recency_due: 1.2,
    prior_service: 1,
    cross_sell_gap: 0.65,
    season_match: 0.45,
    repeat_customer: 0.35,
    recent_complaint: -3,
    recent_cancellation: -0.7,
  },
  bounds: {
    minWeight: -4,
    maxWeight: 4,
    maxDeltaPerRun: 0.15,
    minimumOutcomes: 30,
    minimumPositiveOutcomes: 5,
  },
  priors: {
    baseProbability: 0.15,
    serviceDefaultCadenceDays: {
      window_cleaning: 180,
      gutter_cleaning: 270,
      house_wash: 365,
    },
  },
};

const features: CustomerFeatureSnapshot = {
  asOf: '2026-07-27T00:00:00Z',
  lifetimeValue: 2400,
  completedJobCount: 5,
  cancellationCount: 0,
  daysSinceLastCompleted: 220,
  serviceCounts: { window_cleaning: 3 },
  serviceLastCompletedAt: { window_cleaning: '2025-12-01T00:00:00Z' },
  inferredServiceCadenceDays: { window_cleaning: 180 },
  recentComplaint: false,
  recentCancellation: false,
  season: 'summer',
};

describe('recommendationEngine', () => {
  it('produces reproducible, evidence-backed recommendations', () => {
    const first = scoreServiceRecommendation({ serviceKey: 'window_cleaning', features, model });
    const second = scoreServiceRecommendation({ serviceKey: 'window_cleaning', features, model });

    expect(first).toEqual(second);
    expect(first.reasonCodes).toContain('SERVICE_DUE');
    expect(first.reasonCodes).toContain('PRIOR_SERVICE');
    expect(first.evidence).toContainEqual({ key: 'model_version', value: 1 });
    expect(first.score).toBeGreaterThan(0.5);
  });

  it('suppresses recommendations during a recent complaint', () => {
    expect(rankRecommendations({
      services: ['window_cleaning', 'house_wash'],
      features: { ...features, recentComplaint: true },
      model,
    })).toEqual([]);
  });

  it('fully excludes archived Jobber clients', () => {
    const archived = { ...features, isArchived: true };
    expect(rankRecommendations({ services: ['window_cleaning', 'house_wash'], features: archived, model })).toEqual([]);
    expect(scoreServiceRecommendation({ serviceKey: 'window_cleaning', features: archived, model }).reasonCodes)
      .toContain('ARCHIVED_CLIENT_EXCLUDED');
  });

  it('ranks an overdue repeat service above a new cross-sell', () => {
    const ranked = rankRecommendations({
      services: ['house_wash', 'window_cleaning'],
      features,
      model,
    });
    expect(ranked[0].serviceKey).toBe('window_cleaning');
  });

  it('treats paid and completed as the strongest outcomes', () => {
    expect(outcomeLearningValue({ feature: 'x', outcomeType: 'paid' })).toBe(1);
    expect(outcomeLearningValue({ feature: 'x', outcomeType: 'completed' })).toBe(0.95);
    expect(outcomeLearningValue({ feature: 'x', outcomeType: 'booked' })).toBeLessThan(0.95);
    expect(outcomeLearningValue({ feature: 'x', outcomeType: 'accepted' })).toBeLessThan(0.7);
  });

  it('disregards all outcomes from archived clients', () => {
    expect(outcomeLearningValue({ feature: 'x', outcomeType: 'paid', isArchivedClient: true })).toBeNull();
  });

  it('does not learn until minimum evidence thresholds are met', () => {
    const result = proposeBoundedWeightUpdate({
      currentWeights: model.weights,
      outcomes: Array.from({ length: 10 }, () => ({ feature: 'season_match', outcomeType: 'paid' as const })),
      bounds: model.bounds,
    });
    expect(result.eligible).toBe(false);
    expect(result.proposedWeights).toEqual(model.weights);
  });

  it('limits each learning update and preserves global bounds', () => {
    const outcomes = [
      ...Array.from({ length: 30 }, () => ({ feature: 'season_match', outcomeType: 'paid' as const })),
      ...Array.from({ length: 10 }, () => ({ feature: 'cross_sell_gap', outcomeType: 'rejected' as const })),
    ];
    const result = proposeBoundedWeightUpdate({
      currentWeights: { season_match: 3.99, cross_sell_gap: -3.99 },
      outcomes,
      bounds: model.bounds,
      learningRate: 1,
    });

    expect(result.eligible).toBe(true);
    expect(result.proposedWeights.season_match).toBeLessThanOrEqual(4);
    expect(result.proposedWeights.cross_sell_gap).toBeGreaterThanOrEqual(-4);
    expect(Math.abs(result.summary.season_match)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(result.summary.cross_sell_gap)).toBeLessThanOrEqual(0.15);
  });
});
