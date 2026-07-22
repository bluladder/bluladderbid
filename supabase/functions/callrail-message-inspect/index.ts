import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { verifyAdmin, getBearer } from '../_shared/auth.ts'

// Admin diagnostic: fetch raw CallRail data for a specific outbound message /
// conversation so we can read failure_reason / carrier response fields that
// are NOT visible in normal send responses. Guarded by CRON_SECRET header.

const API = 'https://api.callrail.com/v3';

async function cr(path: string, key: string) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Token token=${key}`, Accept: 'application/json' },
  });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { status: r.status, body };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = await verifyAdmin(getBearer(req));
  if (!admin) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const messageId = url.searchParams.get('message_id') ?? '';
  const conversationId = url.searchParams.get('conversation_id') ?? '';
  const account = Deno.env.get('CALLRAIL_ACCOUNT_ID') ?? '';
  const company = Deno.env.get('CALLRAIL_COMPANY_ID') ?? '';
  const key = Deno.env.get('CALLRAIL_API_KEY') ?? '';
  const sender = Deno.env.get('CALLRAIL_SENDER_NUMBER') ?? '';

  if (!account || !key) {
    return new Response(JSON.stringify({ error: 'missing_callrail_config' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: Record<string, unknown> = {
    config: { account_present: !!account, company_present: !!company, sender_present: !!sender, sender_last4: sender.slice(-4) },
    inputs: { messageId, conversationId },
  };

  // 1. Conversation detail
  if (conversationId) {
    results.conversation = await cr(`/a/${account}/text-messages/${conversationId}.json`, key);
    results.conversation_messages = await cr(`/a/${account}/text-messages/${conversationId}/messages.json`, key);
  }

  // 2. Try to look up message by ID via several documented / undocumented shapes.
  if (messageId) {
    results.message_direct = await cr(`/a/${account}/text-messages/messages/${messageId}.json`, key);
    results.message_alt = await cr(`/a/${account}/messages/${messageId}.json`, key);
  }

  // 3. List recent outbound messages to sender for comparison (last 20)
  const listPath = `/a/${account}/text-messages.json?per_page=20&sort=created_at&order=desc`;
  results.recent_conversations = await cr(listPath, key);

  return new Response(JSON.stringify(results, null, 2), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
