import { describe, it, expect } from 'vitest';
import {
  isAllowedEvent, validateActivation, validateAudienceConditions, summarizeAudience,
  realConditions, getAudienceMode, withinEffectiveWindow, DEFAULT_STOP_CONDITIONS,
  type EditorCampaign, type EditorStep,
} from './campaignModel';
import { CAMPAIGN_TEMPLATES } from './campaignTemplates';

function baseCampaign(p: Partial<EditorCampaign> = {}): EditorCampaign {
  return {
    name: 'Test', description: null, status: 'draft', event_name: 'chat_lead_created',
    version: 1, effective_start: null, effective_end: null, allowed_channels: ['sms'],
    required_consent: 'requested_follow_up', reentry_enabled: false, reentry_cooldown_hours: null,
    abandonment_delay_minutes: null, stop_conditions: { ...DEFAULT_STOP_CONDITIONS },
    audience_conditions: { __mode: 'all' }, ...p,
  };
}
function baseStep(p: Partial<EditorStep> = {}): EditorStep {
  return {
    step_order: 1, channel: 'sms', delay_hours: 1, subject: null,
    body_template: 'Hi {{first_name}} {{link}} Reply STOP', active: true,
    is_marketing: true, business_hours_only: false, ...p,
  };
}

describe('campaign event allowlist', () => {
  it('accepts known events', () => {
    expect(isAllowedEvent('quote_abandoned')).toBe(true);
    expect(isAllowedEvent('booking_completed')).toBe(true);
  });
  it('rejects unknown event names', () => {
    expect(isAllowedEvent('do_something_evil')).toBe(false);
    expect(isAllowedEvent('quote_created')).toBe(false);
    expect(isAllowedEvent(null)).toBe(false);
  });
});

describe('activation validation', () => {
  it('a valid campaign passes', () => {
    const r = validateActivation(baseCampaign(), [baseStep()]);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
  it('cannot activate without a trigger', () => {
    const r = validateActivation(baseCampaign({ event_name: null }), [baseStep()]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /trigger event/i.test(e))).toBe(true);
  });
  it('cannot activate without explicit audience behavior', () => {
    const c = baseCampaign({ audience_conditions: {} });
    const r = validateActivation(c, [baseStep()]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /audience behavior must be explicitly/i.test(e))).toBe(true);
  });
  it('cannot activate with no channel', () => {
    const r = validateActivation(baseCampaign({ allowed_channels: [] }), [baseStep()]);
    expect(r.errors.some((e) => /at least one channel/i.test(e))).toBe(true);
  });
  it('requires a valid abandonment delay for abandonment campaigns', () => {
    const c = baseCampaign({ event_name: 'quote_abandoned', abandonment_delay_minutes: 0 });
    const r = validateActivation(c, [baseStep()]);
    expect(r.errors.some((e) => /abandonment delay/i.test(e))).toBe(true);
  });
  it('requires re-entry cooldown when re-entry enabled', () => {
    const c = baseCampaign({ reentry_enabled: true, reentry_cooldown_hours: 0 });
    const r = validateActivation(c, [baseStep()]);
    expect(r.errors.some((e) => /cooldown/i.test(e))).toBe(true);
  });
  it('requires email subject on email steps', () => {
    const c = baseCampaign({ allowed_channels: ['email'] });
    const s = baseStep({ channel: 'email', subject: '', is_marketing: false });
    const r = validateActivation(c, [s]);
    expect(r.errors.some((e) => /subject/i.test(e))).toBe(true);
  });
  it('blocks a marketing step on transactional consent', () => {
    const c = baseCampaign({ required_consent: 'transactional', event_name: 'booking_completed' });
    const s = baseStep({ is_marketing: true });
    const r = validateActivation(c, [s]);
    expect(r.errors.some((e) => /marketing step requires/i.test(e))).toBe(true);
  });
  it('rejects invalid effective date ordering', () => {
    const c = baseCampaign({ effective_start: '2030-01-02T00:00:00Z', effective_end: '2030-01-01T00:00:00Z' });
    const r = validateActivation(c, [baseStep()]);
    expect(r.errors.some((e) => /start date must be before/i.test(e))).toBe(true);
  });
});

describe('audience conditions', () => {
  it('rejects unknown condition keys', () => {
    const v = validateAudienceConditions({ __mode: 'conditions', evil_key: true });
    expect(v.valid).toBe(false);
    expect(v.unknownKeys).toContain('evil_key');
  });
  it('flags contradictions', () => {
    const v = validateAudienceConditions({ customer_type: 'new', booked_before: true });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => /contradiction/i.test(e))).toBe(true);
  });
  it('accepts a supported condition set', () => {
    const v = validateAudienceConditions({ __mode: 'conditions', customer_type: 'new', quote_status: ['firm'] });
    expect(v.valid).toBe(true);
  });
  it('realConditions strips meta and empties', () => {
    const r = realConditions({ __mode: 'conditions', service_types: [], customer_type: 'new' });
    expect(r).toEqual({ customer_type: 'new' });
  });
  it('getAudienceMode reads the marker', () => {
    expect(getAudienceMode({ __mode: 'all' })).toBe('all');
    expect(getAudienceMode({})).toBeNull();
  });
});

describe('human-readable audience summaries', () => {
  it('describes all-prospects', () => {
    expect(summarizeAudience({ __mode: 'all' })).toMatch(/all otherwise-eligible/i);
  });
  it('matches structured never-booked window-cleaning summary', () => {
    const s = summarizeAudience({ __mode: 'conditions', customer_type: 'new', service_types: ['window_cleaning'], sms_consent: 'granted' });
    expect(s).toMatch(/never-booked/i);
    expect(s).toMatch(/window_cleaning/i);
    expect(s).toMatch(/granted SMS consent/i);
  });
});

describe('effective window', () => {
  it('is inside when unbounded', () => {
    expect(withinEffectiveWindow(null, null)).toBe(true);
  });
  it('is outside before start / after end', () => {
    expect(withinEffectiveWindow('2999-01-01T00:00:00Z', null)).toBe(false);
    expect(withinEffectiveWindow(null, '2000-01-01T00:00:00Z')).toBe(false);
  });
});

describe('recommended templates', () => {
  it('all default to draft and never active', () => {
    for (const t of CAMPAIGN_TEMPLATES) expect(t.campaign.status).toBe('draft');
  });
  it('every template uses an allowlisted event', () => {
    for (const t of CAMPAIGN_TEMPLATES) expect(isAllowedEvent(t.campaign.event_name)).toBe(true);
  });
  it('templates validate for activation once reviewed', () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      const r = validateActivation({ ...t.campaign }, t.steps.map((s) => ({ ...s })));
      expect(r.ok, `${t.key}: ${r.errors.join('; ')}`).toBe(true);
    }
  });
});
