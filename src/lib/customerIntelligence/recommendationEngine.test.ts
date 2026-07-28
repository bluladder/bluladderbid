import { describe, expect, it } from 'vitest';
import {
  outcomeLearningValue,
  proposeBoundedWeightUpdate,
  rankRecommendations,
  scoreServiceRecommendation,
  type CustomerFeatureSnapshot,
  type RecommendationModel,
} from './recommendationEngine';
import type { OrganizationServiceCatalogEntry } from '../../../packages/sales-engine/pricing/organizationPricing';

const DFW = 'b1addf00-0000-4000-8000-000000000001';
const OREGON = 'b1addf00-0000-4000-8000-000000000002';

const model: RecommendationModel = {
  id: 'dfw-model-v1',
  organizationId: DFW,
  modelKey: 'service_next_best_action',
  version: 1,
  status: 'approved',
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
  organizationId: DFW,
  featureVersion: 'customer-features-v1',
  inputFingerprint: 'fnv1a32:fixture',
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
  archivedStatus: 'active',
};

const catalog = ['window_cleaning', 'house_wash'].map((serviceKey): OrganizationServiceCatalogEntry => ({
  id: `dfw-${serviceKey}`,
  organizationId: DFW,
  serviceKey,
  name: serviceKey,
  kind: 'standard',
  approvalStatus: 'approved',
  quoteAvailability: 'enabled',
  planAvailability: 'enabled',
  pricingStrategies: ['square_footage'],
  pricingPriority: ['square_footage'],
  laborStrategy: 'configured_formula',
  durationStrategy: 'configured_formula',
}));

const outcome = (feature: string, outcomeType: 'paid' | 'rejected') => ({
  organizationId: DFW,
  modelId: model.id,
  feature,
  outcomeType,
  archivedStatus: 'active' as const,
});

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
      catalog,
    })).toEqual([]);
  });

  it('fully excludes archived Jobber clients', () => {
    const archived = { ...features, archivedStatus: 'archived' as const };
    expect(rankRecommendations({ services: ['window_cleaning', 'house_wash'], features: archived, model, catalog })).toEqual([]);
    expect(scoreServiceRecommendation({ serviceKey: 'window_cleaning', features: archived, model }).reasonCodes)
      .toContain('ARCHIVED_CLIENT_EXCLUDED');
  });

  it('ranks an overdue repeat service above a new cross-sell', () => {
    const ranked = rankRecommendations({
      services: ['house_wash', 'window_cleaning'],
      features,
      model,
      catalog,
    });
    expect(ranked[0].serviceKey).toBe('window_cleaning');
  });

  it('treats paid and completed as the strongest outcomes', () => {
    const base = { organizationId: DFW, modelId: model.id, feature: 'x', archivedStatus: 'active' as const };
    expect(outcomeLearningValue({ ...base, outcomeType: 'paid' })).toBe(1);
    expect(outcomeLearningValue({ ...base, outcomeType: 'completed' })).toBe(0.95);
    expect(outcomeLearningValue({ ...base, outcomeType: 'booked' })).toBeLessThan(0.95);
    expect(outcomeLearningValue({ ...base, outcomeType: 'accepted' })).toBeLessThan(0.7);
  });

  it('disregards all outcomes from archived clients', () => {
    expect(outcomeLearningValue({
      organizationId: DFW,
      modelId: model.id,
      feature: 'x',
      outcomeType: 'paid',
      archivedStatus: 'archived',
    })).toBeNull();
  });

  it('does not learn until minimum evidence thresholds are met', () => {
    const result = proposeBoundedWeightUpdate({
      organizationId: DFW,
      modelId: model.id,
      currentWeights: model.weights,
      outcomes: Array.from({ length: 10 }, () => outcome('season_match', 'paid')),
      bounds: model.bounds,
    });
    expect(result.eligible).toBe(false);
    expect(result.proposedWeights).toEqual(model.weights);
  });

  it('limits each learning update and preserves global bounds', () => {
    const outcomes = [
      ...Array.from({ length: 30 }, () => outcome('season_match', 'paid')),
      ...Array.from({ length: 25 }, () => outcome('cross_sell_gap', 'rejected')),
      ...Array.from({ length: 5 }, () => outcome('cross_sell_gap', 'paid')),
    ];
    const result = proposeBoundedWeightUpdate({
      organizationId: DFW,
      modelId: model.id,
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

  it('fails closed when model and feature organizations conflict', () => {
    expect(() => scoreServiceRecommendation({
      serviceKey: 'window_cleaning',
      features,
      model: { ...model, organizationId: OREGON },
    })).toThrow('organization_lineage_mismatch');
  });

  it('does not rank unavailable or cross-organization services', () => {
    expect(rankRecommendations({
      services: ['window_cleaning'],
      features,
      model,
      catalog: catalog.map((entry) => ({ ...entry, organizationId: OREGON })),
    })).toEqual([]);
  });

  it('does not learn across organizations or model versions', () => {
    expect(() => proposeBoundedWeightUpdate({
      organizationId: DFW,
      modelId: model.id,
      currentWeights: model.weights,
      outcomes: [{ ...outcome('season_match', 'paid'), organizationId: OREGON }],
      bounds: model.bounds,
    })).toThrow('organization_lineage_mismatch');
    expect(() => proposeBoundedWeightUpdate({
      organizationId: DFW,
      modelId: model.id,
      currentWeights: model.weights,
      outcomes: [{ ...outcome('season_match', 'paid'), modelId: 'another-model' }],
      bounds: model.bounds,
    })).toThrow('model_lineage_mismatch');
  });

  it('requires owner-approved model versions', () => {
    expect(() => scoreServiceRecommendation({
      serviceKey: 'window_cleaning',
      features,
      model: { ...model, status: 'draft' },
    })).toThrow('model_unapproved');
  });
});
