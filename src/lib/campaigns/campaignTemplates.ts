// Optional draft templates for common campaign mappings. These are NEVER
// activated automatically — creating one always yields a `draft` campaign the
// administrator must review and explicitly turn on.
import {
  type EditorCampaign, type EditorStep, DEFAULT_STOP_CONDITIONS,
} from './campaignModel';

export interface CampaignTemplate {
  key: string;
  label: string;
  description: string;
  campaign: Omit<EditorCampaign, 'id'>;
  steps: Omit<EditorStep, 'id'>[];
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    key: 'new_lead_nurture',
    label: 'New lead nurture',
    description: 'Follow up with never-booked chat leads. Stops on booking, reply, takeover, opt-out.',
    campaign: {
      name: 'New lead nurture (draft)',
      description: 'Nurture never-booked leads created from chat.',
      status: 'draft',
      event_name: 'chat_lead_created',
      version: 1,
      effective_start: null,
      effective_end: null,
      allowed_channels: ['sms'],
      required_consent: 'requested_follow_up',
      reentry_enabled: false,
      reentry_cooldown_hours: null,
      abandonment_delay_minutes: null,
      stop_conditions: { ...DEFAULT_STOP_CONDITIONS, on_booking: 'stop_nurture' },
      audience_conditions: { __mode: 'conditions', customer_type: 'new' },
    },
    steps: [
      { step_order: 1, channel: 'sms', delay_hours: 1, subject: null, body_template: 'Hi {{first_name}}, this is BluLadder — happy to answer any questions about your quote. {{link}} Reply STOP to opt out.', active: true, is_marketing: true, business_hours_only: true },
    ],
  },
  {
    key: 'abandoned_quote',
    label: 'Abandoned quote',
    description: 'Re-engage firm, never-booked quotes. Stops on booking, reply, callback, takeover, opt-out.',
    campaign: {
      name: 'Abandoned quote follow-up (draft)',
      description: 'Re-engage firm quotes that were never booked.',
      status: 'draft',
      event_name: 'quote_abandoned',
      version: 1,
      effective_start: null,
      effective_end: null,
      allowed_channels: ['sms'],
      required_consent: 'requested_follow_up',
      reentry_enabled: false,
      reentry_cooldown_hours: null,
      abandonment_delay_minutes: 1440,
      stop_conditions: { ...DEFAULT_STOP_CONDITIONS, on_booking: 'stop_abandoned' },
      audience_conditions: { __mode: 'conditions', customer_type: 'new', quote_status: ['firm'] },
    },
    steps: [
      { step_order: 1, channel: 'sms', delay_hours: 0, subject: null, body_template: 'Hi {{first_name}}, your BluLadder quote is still ready when you are: {{link}} Reply STOP to opt out.', active: true, is_marketing: true, business_hours_only: true },
    ],
  },
  {
    key: 'manual_quote_followup',
    label: 'Manual quote follow-up',
    description: 'Follow up on manual quote requests. Stops on staff takeover, resolved, reply.',
    campaign: {
      name: 'Manual quote follow-up (draft)',
      description: 'Follow up on quotes needing manual review.',
      status: 'draft',
      event_name: 'manual_quote_requested',
      version: 1,
      effective_start: null,
      effective_end: null,
      allowed_channels: ['sms'],
      required_consent: 'requested_follow_up',
      reentry_enabled: false,
      reentry_cooldown_hours: null,
      abandonment_delay_minutes: null,
      stop_conditions: { ...DEFAULT_STOP_CONDITIONS, on_reply: 'stop' },
      audience_conditions: { __mode: 'conditions', manual_review: true },
    },
    steps: [
      { step_order: 1, channel: 'sms', delay_hours: 2, subject: null, body_template: 'Hi {{first_name}}, we are preparing your custom BluLadder quote and will be in touch shortly. Reply STOP to opt out.', active: true, is_marketing: false, business_hours_only: true },
    ],
  },
  {
    key: 'callback_request',
    label: 'Callback request',
    description: 'Acknowledge callback requests. Stops on resolved or takeover.',
    campaign: {
      name: 'Callback request (draft)',
      description: 'Acknowledge and follow up on callback requests.',
      status: 'draft',
      event_name: 'callback_requested',
      version: 1,
      effective_start: null,
      effective_end: null,
      allowed_channels: ['sms'],
      required_consent: 'requested_follow_up',
      reentry_enabled: false,
      reentry_cooldown_hours: null,
      abandonment_delay_minutes: null,
      stop_conditions: { ...DEFAULT_STOP_CONDITIONS, on_reply: 'stop' },
      audience_conditions: { __mode: 'all' },
    },
    steps: [
      { step_order: 1, channel: 'sms', delay_hours: 0, subject: null, body_template: 'Hi {{first_name}}, thanks for asking us to call — a BluLadder team member will reach out shortly. Reply STOP to opt out.', active: true, is_marketing: false, business_hours_only: true },
    ],
  },
];
