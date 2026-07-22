import { runControllerTurn, persistControllerPatch } from "./supabase/functions/_shared/workflow/workflowController.ts";
import { selectRoute } from "./supabase/functions/_shared/workflow/rolloutRoute.ts";

// Route decision proof.
const decision = selectRoute({
  syntheticTestHeader: "TEST_SECRET_VALUE",
  callerIdE164: null,
  env: { enabled: "true", allowlist: null, testSecret: "TEST_SECRET_VALUE" },
});
console.log("route:", JSON.stringify(decision));

// In-memory supabase (returning-customer known).
const state: any = {
  session: { id: "qs_syn", channel: "voice", conversation_ids: ["c_syn"], fields: {}, field_status: {}, required_remaining: [], quote_status: "none", booking_ready: false },
  convo: { id: "c_syn", quote_session_id: "qs_syn", session_token: "tok_syn", channel: "voice" },
};
const customers = [{ id: "cust_1", first_name: "Blake", phone: "+14697472877" }];
const sb: any = {
  from(t: string) {
    const q: any = {
      _t: t, _in: null,
      select() { return this; },
      eq() { return this; },
      in(_k: string, arr: unknown[]) { this._in = arr; return this; },
      order() { return this; },
      limit() { return this._run(); },
      maybeSingle() { return this._run().then((r: any) => ({ data: r.data?.[0] ?? null, error: null })); },
      single() { return this._run().then((r: any) => ({ data: r.data?.[0] ?? null, error: null })); },
      insert(row: any) { if (t === "quote_sessions") state.session = { ...state.session, ...row }; if (t === "chat_conversations") state.convo = { ...state.convo, ...row }; return { select() { return { single: () => Promise.resolve({ data: state[t === "quote_sessions" ? "session" : "convo"], error: null }) }; } }; },
      update(p: any) { if (t === "quote_sessions") state.session = { ...state.session, ...p }; if (t === "chat_conversations") state.convo = { ...state.convo, ...p }; return { eq() { return Promise.resolve({}); } }; },
      _run() {
        if (t === "quote_sessions") return Promise.resolve({ data: [state.session] });
        if (t === "chat_conversations") return Promise.resolve({ data: [state.convo] });
        if (t === "customers") return Promise.resolve({ data: customers });
        return Promise.resolve({ data: [] });
      },
    };
    return q;
  },
};

const utterances = [
  "Hi, I'd like a quote for window cleaning.",
  "Yes that's correct.",
  "About 2400 square feet.",
  "Two stories.",
  "Exterior only.",
];

for (const u of utterances) {
  const t = await runControllerTurn({
    supabase: sb, conversationId: "c_syn", channel: "voice",
    utterance: u, history: [],
    callerIdE164: "+14697472877",
  });
  await persistControllerPatch(sb, "qs_syn", t.sessionPatch);
  console.log(`\nCUSTOMER: ${u}`);
  console.log(`  route.pre: ${t.pre.kind}`);
  if ("spoken" in t.pre) console.log(`ASSISTANT: ${t.pre.spoken}`);
  else console.log(`(delegated to legacy orchestrator for pricing/scheduling/booking)`);
}
