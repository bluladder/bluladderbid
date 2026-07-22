// ============================================================================
// Pure, framework-free campaign admin model.
//
// This module carries NO I/O. It defines the allowlisted events, the audience
// condition schema that the SERVER engine already understands, plain-language
// summaries, and the activation/validation rules the editor enforces before a
// campaign can go live. It is unit-tested directly (campaignModel.test.ts) and
// shared by the campaign editor, dry-run tool and enrollment admin.
//
// It must stay in lock-step with supabase/functions/_shared/campaignEngine.ts.
// Do NOT invent event names or audience keys the server cannot evaluate.
// ============================================================================

// ---- Allowlisted trigger events (mirror of campaignEngine.ALLOWED_EVENTS) ----
export const ALLOWED_EVENTS = [
  'chat_lead_created',
  'quote_calculated',
  'manual_quote_requested',
  'callback_requested',
  'quote_abandoned',
  'booking_completed',
  'appointment_rescheduled',
  'appointment_cancelled',
  'customer_replied',
  'consent_granted',
  'consent_revoked',
  'manual_staff_takeover',
] as const;
export type CampaignEvent = (typeof ALLOWED_EVENTS)[number];

export function isAllowedEvent(name: unknown): name is CampaignEvent {
  return typeof name === 'string' && (ALLOWED_EVENTS as readonly string[]).includes(name);
}

export const EVENT_LABELS: Record<CampaignEvent, string> = {
  chat_lead_created: 'Chat lead created',
  quote_calculated: 'Quote calculated',
  manual_quote_requested: 'Manual quote requested',
  callback_requested: 'Callback requested',
  quote_abandoned: 'Quote abandoned',
  booking_completed: 'Booking completed',
  appointment_rescheduled: 'Appointment rescheduled',
  appointment_cancelled: 'Appointment cancelled',
  customer_replied: 'Customer replied',
  consent_granted: 'Consent granted',
  consent_revoked: 'Consent revoked',
  manual_staff_takeover: 'Manual staff takeover',
};

// Marketing-style nurture events that require follow-up / marketing consent to
// deliver anything beyond transactional messages.
export const NURTURE_EVENTS: CampaignEvent[] = [
  'chat_lead_created',
  'quote_calculated',
  'manual_quote_requested',
  'callback_requested',
  'quote_abandoned',
];

export type ConsentType = 'transactional' | 'requested_follow_up' | 'marketing';
export const CONSENT_TYPES: ConsentType[] = ['transactional', 'requested_follow_up', 'marketing'];
export const CONSENT_LABELS: Record<ConsentType, string> = {
  transactional: 'Transactional (service-related, always allowed)',
  requested_follow_up: 'Requested follow-up (customer asked us to follow up)',
  marketing: 'Marketing (explicit marketing opt-in required)',
};

export type Channel = 'sms' | 'email';
export type CampaignStatus = 'draft' | 'active' | 'inactive';
export type AudienceMode = 'all' | 'conditions';

// ---- Audience condition schema (mirror of engine matchesAudience) ----
export interface AudienceFieldOption { value: string; label: string }
export interface AudienceFieldDef {
  key: string;
  label: string;
  kind: 'enum' | 'boolean' | 'multi' | 'tags';
  options?: AudienceFieldOption[];
  help?: string;
}

export const AUDIENCE_FIELDS: AudienceFieldDef[] = [
  {
    key: 'customer_type', label: 'Customer type', kind: 'enum',
    options: [
      { value: 'new', label: 'New lead (never booked)' },
      { value: 'existing', label: 'Existing / previous customer' },
    ],
    help: 'Whether the person has booked with us before.',
  },
  { key: 'booked_before', label: 'Has booked before', kind: 'boolean', help: 'True = previous customer. False = never booked.' },
  { key: 'service_types', label: 'Service type', kind: 'tags', help: 'e.g. window_cleaning, pressure_washing' },
  {
    key: 'quote_status', label: 'Quote status', kind: 'multi',
    options: [
      { value: 'firm', label: 'Firm' }, { value: 'estimated', label: 'Estimated' },
      { value: 'manual_review', label: 'Manual review' }, { value: 'converted', label: 'Converted' },
      { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' },
    ],
  },
  { key: 'manual_review', label: 'Manual-review status', kind: 'boolean' },
  {
    key: 'booking_status', label: 'Booking status', kind: 'multi',
    options: [
      { value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'Completed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
  { key: 'lead_source', label: 'Lead source', kind: 'tags', help: 'e.g. website, google, referral' },
  {
    key: 'service_area_status', label: 'Service-area status', kind: 'multi',
    options: [
      { value: 'in_area', label: 'In service area' },
      { value: 'out_of_area', label: 'Out of service area' },
    ],
  },
  { key: 'city', label: 'City', kind: 'tags' },
  { key: 'tags', label: 'Customer tags', kind: 'tags' },
  {
    key: 'sms_consent', label: 'SMS consent', kind: 'enum',
    options: [
      { value: 'granted', label: 'Granted' }, { value: 'revoked', label: 'Revoked' }, { value: 'unknown', label: 'Unknown' },
    ],
  },
  {
    key: 'email_consent', label: 'Email consent', kind: 'enum',
    options: [
      { value: 'granted', label: 'Granted' }, { value: 'revoked', label: 'Revoked' }, { value: 'unknown', label: 'Unknown' },
    ],
  },
  {
    key: 'opted_out', label: 'Opt-out state', kind: 'enum',
    options: [{ value: 'false', label: 'Not opted out (exclude opt-outs)' }],
    help: 'Marketing/opt-out suppression is always enforced at delivery regardless of this.',
  },
];

const AUDIENCE_KEYS = new Set(AUDIENCE_FIELDS.map((f) => f.key));

export type AudienceConditions = Record<string, unknown>;

// Reads the explicit audience mode marker. Missing marker = not yet chosen.
export function getAudienceMode(conditions: AudienceConditions | null | undefined): AudienceMode | null {
  const m = conditions?.__mode;
  return m === 'all' || m === 'conditions' ? m : null;
}

// Strips meta keys, returning only the real condition entries.
export function realConditions(conditions: AudienceConditions | null | undefined): AudienceConditions {
  const out: AudienceConditions = {};
  for (const [k, v] of Object.entries(conditions ?? {})) {
    if (k.startsWith('__')) continue;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

export interface ConditionValidation { valid: boolean; errors: string[]; unknownKeys: string[] }

// Validates that every supplied condition key is one the server understands and
// values are of the expected shape. Contradictions are surfaced too.
export function validateAudienceConditions(conditions: AudienceConditions | null | undefined): ConditionValidation {
  const errors: string[] = [];
  const unknownKeys: string[] = [];
  const real = realConditions(conditions);

  for (const [k, v] of Object.entries(real)) {
    if (!AUDIENCE_KEYS.has(k)) { unknownKeys.push(k); continue; }
    const def = AUDIENCE_FIELDS.find((f) => f.key === k)!;
    if (def.kind === 'boolean' && typeof v !== 'boolean') errors.push(`"${def.label}" must be true or false.`);
    if ((def.kind === 'multi' || def.kind === 'tags') && !Array.isArray(v)) errors.push(`"${def.label}" must be a list.`);
    if (def.kind === 'enum' && typeof v !== 'string') errors.push(`"${def.label}" must be a single value.`);
  }
  for (const k of unknownKeys) errors.push(`Unsupported condition "${k}" — the server cannot evaluate it.`);

  if (real.customer_type === 'new' && real.booked_before === true) {
    errors.push('Contradiction: customer type "new" cannot also have booked before.');
  }
  if (real.customer_type === 'existing' && real.booked_before === false) {
    errors.push('Contradiction: customer type "existing" cannot also be never-booked.');
  }
  if (real.opted_out === false && real.sms_consent === 'revoked') {
    errors.push('Contradiction: excluding opt-outs while also requiring revoked SMS consent.');
  }

  return { valid: errors.length === 0, errors, unknownKeys };
}

function humanList(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

// Plain-language summary of the audience for administrators.
export function summarizeAudience(conditions: AudienceConditions | null | undefined): string {
  const mode = getAudienceMode(conditions);
  const real = realConditions(conditions);
  const keys = Object.keys(real);
  if (mode === 'all' && keys.length === 0) return 'All otherwise-eligible prospects (no extra filters).';
  if (keys.length === 0) return mode === 'conditions'
    ? 'No conditions defined yet — add at least one filter.'
    : 'Audience not chosen yet.';

  const parts: string[] = [];
  if (real.customer_type === 'new' || real.booked_before === false) parts.push('never-booked');
  if (real.customer_type === 'existing' || real.booked_before === true) parts.push('previous-customer');
  if (Array.isArray(real.service_types)) parts.push(`${humanList(real.service_types)}`);
  parts.push('leads');
  const tail: string[] = [];
  if (Array.isArray(real.quote_status)) tail.push(`quote status ${humanList(real.quote_status)}`);
  if (Array.isArray(real.booking_status)) tail.push(`booking ${humanList(real.booking_status)}`);
  if (real.manual_review === true) tail.push('needing manual review');
  if (Array.isArray(real.lead_source)) tail.push(`from ${humanList(real.lead_source)}`);
  if (Array.isArray(real.city)) tail.push(`in ${humanList(real.city)}`);
  if (Array.isArray(real.service_area_status)) tail.push(`${humanList(real.service_area_status)}`);
  if (Array.isArray(real.tags)) tail.push(`tagged ${humanList(real.tags)}`);
  if (typeof real.sms_consent === 'string') tail.push(`with ${real.sms_consent} SMS consent`);
  if (typeof real.email_consent === 'string') tail.push(`with ${real.email_consent} email consent`);
  if (real.opted_out === false) tail.push('who are not opted out');

  let s = parts.filter(Boolean).join(' ');
  if (tail.length) s += ' ' + tail.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

// ---- Stop / lifecycle behavior ----
export interface StopConditions {
  on_reply?: 'pause' | 'stop' | 'transactional_only' | 'none';
  on_booking?: 'stop_abandoned' | 'stop_nurture' | 'transactional_only';
  on_cancellation?: 'stop_reminders' | 'continue_followup';
  on_takeover?: 'pause' | 'stop' | 'transactional_only';
}

export const DEFAULT_STOP_CONDITIONS: StopConditions = {
  on_reply: 'pause',
  on_booking: 'stop_abandoned',
  on_cancellation: 'stop_reminders',
  on_takeover: 'pause',
};

// ---- Campaign shape used by the editor ----
export interface EditorStep {
  id?: string;
  step_order: number;
  channel: Channel;
  delay_hours: number;
  subject: string | null;
  body_template: string;
  active: boolean;
  is_marketing: boolean;
  business_hours_only: boolean;
  content_config?: Record<string, unknown> | null;
}

export interface EditorCampaign {
  id?: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  event_name: CampaignEvent | null;
  version: number;
  effective_start: string | null;
  effective_end: string | null;
  allowed_channels: Channel[];
  required_consent: ConsentType;
  reentry_enabled: boolean;
  reentry_cooldown_hours: number | null;
  abandonment_delay_minutes: number | null;
  stop_conditions: StopConditions;
  audience_conditions: AudienceConditions;
}

export interface ActivationResult { ok: boolean; errors: string[]; warnings: string[] }

const SMS_MAX_LEN = 480; // ~3 segments; guardrail, not a hard limit
const EMAIL_MAX_LEN = 5000;

// The single source of truth for "can this campaign go live safely?".
export function validateActivation(c: EditorCampaign, steps: EditorStep[]): ActivationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isAllowedEvent(c.event_name)) errors.push('A valid trigger event must be selected.');

  const channels = c.allowed_channels ?? [];
  if (channels.length === 0) errors.push('At least one channel (SMS or Email) must be enabled.');

  if (!CONSENT_TYPES.includes(c.required_consent)) {
    errors.push('A valid consent requirement must be selected for the campaign channels.');
  }
  if (c.event_name && NURTURE_EVENTS.includes(c.event_name) && c.required_consent === 'transactional') {
    warnings.push('This is a nurture event on transactional consent — only service-related messages will ever deliver.');
  }

  const mode = getAudienceMode(c.audience_conditions);
  if (!mode) errors.push('Audience behavior must be explicitly chosen (all prospects OR a condition set).');
  const audVal = validateAudienceConditions(c.audience_conditions);
  if (!audVal.valid) errors.push(...audVal.errors);
  if (mode === 'conditions' && Object.keys(realConditions(c.audience_conditions)).length === 0) {
    errors.push('Condition-based audience selected but no conditions were defined.');
  }

  if (typeof c.reentry_enabled !== 'boolean') errors.push('Re-entry behavior must be explicitly configured.');
  if (c.reentry_enabled && (!c.reentry_cooldown_hours || c.reentry_cooldown_hours <= 0)) {
    errors.push('Re-entry is allowed but no valid cooldown period is set.');
  }

  const sc = c.stop_conditions ?? {};
  if (!sc.on_reply || !sc.on_booking || !sc.on_cancellation || !sc.on_takeover) {
    errors.push('All stop / lifecycle behaviors (reply, booking, cancellation, takeover) must be set.');
  }

  if (c.event_name === 'quote_abandoned') {
    if (!c.abandonment_delay_minutes || c.abandonment_delay_minutes <= 0) {
      errors.push('Abandonment campaigns require a valid abandonment delay (minutes).');
    }
  }

  if (c.effective_start && c.effective_end) {
    if (new Date(c.effective_start).getTime() >= new Date(c.effective_end).getTime()) {
      errors.push('Effective start date must be before the effective end date.');
    }
  }
  if (c.effective_end && new Date(c.effective_end).getTime() < Date.now()) {
    warnings.push('Effective end date is in the past — the campaign will never enroll.');
  }

  const activeSteps = steps.filter((s) => s.active);
  if (activeSteps.length === 0) errors.push('At least one active step is required.');
  for (const s of steps) {
    const idx = s.step_order;
    if (!s.active) continue;
    if (!(s.delay_hours >= 0) || Number.isNaN(s.delay_hours)) errors.push(`Step ${idx}: delay must be zero or more hours.`);
    if (!channels.includes(s.channel)) errors.push(`Step ${idx}: channel "${s.channel}" is not an enabled campaign channel.`);
    if (!s.body_template || !s.body_template.trim()) errors.push(`Step ${idx}: message body is empty.`);
    if (s.channel === 'email' && (!s.subject || !s.subject.trim())) errors.push(`Step ${idx}: email steps require a subject.`);
    if (s.channel === 'sms' && s.body_template && s.body_template.length > SMS_MAX_LEN) errors.push(`Step ${idx}: SMS body is too long (${s.body_template.length} chars).`);
    if (s.channel === 'email' && s.body_template && s.body_template.length > EMAIL_MAX_LEN) errors.push(`Step ${idx}: email body is too long.`);
    if (s.is_marketing && c.required_consent === 'transactional') {
      errors.push(`Step ${idx}: marketing step requires the campaign to require follow-up or marketing consent.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// True when a campaign is currently within its effective window.
export function withinEffectiveWindow(
  start: string | null, end: string | null, now: number = Date.now(),
): boolean {
  if (start && new Date(start).getTime() > now) return false;
  if (end && new Date(end).getTime() < now) return false;
  return true;
}
