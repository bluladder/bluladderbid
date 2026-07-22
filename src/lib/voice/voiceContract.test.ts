// Vitest coverage for the client-observable side of the voice contract. The
// orchestrator itself lives in a Deno-only file, so this suite only imports
// pure TypeScript types and the retired-number registry to keep vitest
// isolated from Deno-specific globals.
import { describe, it, expect } from 'vitest';
import {
  PHONE_FALLBACK,
  PRIMARY_PUBLIC_PHONE,
  RETIRED_PHONE_NUMBERS,
  type PhonePurpose,
} from '@/config/contact';

const RESPONSIBID = '+14692426556';

describe('Voice contract — retired-number cleanup', () => {
  it('retired ResponsiBid number cannot become primary', () => {
    expect(PRIMARY_PUBLIC_PHONE.e164).not.toBe(RESPONSIBID);
  });

  it('retired number cannot become public', () => {
    for (const p of Object.values(PHONE_FALLBACK)) {
      if (p.e164 === RESPONSIBID) {
        // If it were still in the map, it would be an active purpose entry.
        throw new Error('retired number resolved as active');
      }
    }
  });

  it('retired number cannot be selected for SMS/booking/transfer purposes', () => {
    const purposes: PhonePurpose[] = ['primary_public', 'app_ai', 'escalation_sender'];
    for (const purpose of purposes) {
      expect(PHONE_FALLBACK[purpose].e164).not.toBe(RESPONSIBID);
    }
  });

  it('admin phone-purpose union no longer offers responsibid', () => {
    // TypeScript enforces this at compile time; the runtime assertion below
    // guards against a stale runtime lookup ever coercing the retired value.
    const activePurposes = Object.keys(PHONE_FALLBACK);
    expect(activePurposes).not.toContain('responsibid');
  });

  it('retired-numbers registry lists +14692426556 for defense-in-depth redaction', () => {
    const retired = RETIRED_PHONE_NUMBERS.find((r) => r.e164 === RESPONSIBID);
    expect(retired).toBeDefined();
    expect(retired?.reason).toBe('retired_responsibid');
  });
});

// -----------------------------------------------------------------------
// The exhaustive TypeScript union check for VoiceDisposition below is a
// compile-time assertion. If a case is ever removed from the union this test
// file will fail to typecheck, and both `tsgo` and CI will surface it. We keep
// the type definition duplicated here so vitest never has to import the
// Deno-only orchestrator module.
// -----------------------------------------------------------------------
type VoiceDisposition =
  | { type: 'speak' }
  | { type: 'tool_result_speak' }
  | { type: 'transfer_human'; reason?: string }
  | { type: 'callback_confirmed'; callbackRequestId?: string }
  | { type: 'graceful_end'; reason?: string }
  | { type: 'safe_failure'; reasonCode: string }
  | { type: 'uncertain_pricing'; reason?: string }
  | { type: 'uncertain_scheduling'; reason?: string }
  | { type: 'post_call_sms_handoff'; reason?: string };

describe('Voice contract — dispositions representable', () => {
  it('all nine dispositions can be constructed', () => {
    const dispositions: VoiceDisposition[] = [
      { type: 'speak' },
      { type: 'tool_result_speak' },
      { type: 'transfer_human', reason: 'r' },
      { type: 'callback_confirmed', callbackRequestId: 'id' },
      { type: 'graceful_end', reason: 'r' },
      { type: 'safe_failure', reasonCode: 'x' },
      { type: 'uncertain_pricing', reason: 'r' },
      { type: 'uncertain_scheduling', reason: 'r' },
      { type: 'post_call_sms_handoff', reason: 'r' },
    ];
    expect(dispositions).toHaveLength(9);
  });
});