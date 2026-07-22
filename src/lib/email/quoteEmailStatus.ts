// Pure decision function for the save-quote email attempt status.
// Extracted so it can be unit-tested independent of the Deno runtime.
//
// Contract mirrors supabase/functions/save-quote/index.ts:
//   - 2xx + provider_message_id  -> "accepted"  (delivery NOT yet confirmed)
//   - pre-send suppression       -> "suppressed"
//   - anything else              -> "failed"
export type QuoteEmailStatus = 'accepted' | 'failed' | 'suppressed';

export interface QuoteEmailStatusInput {
  ok: boolean;
  providerMessageId: string | null;
  failureCategory?: string | null;
}

export function decideQuoteEmailStatus(input: QuoteEmailStatusInput): QuoteEmailStatus {
  if (input.ok && input.providerMessageId) return 'accepted';
  if (input.failureCategory === 'suppressed') return 'suppressed';
  return 'failed';
}
