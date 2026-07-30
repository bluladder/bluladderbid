# Voice Incident Report — Latest Inbound Call, 2026-07-30

**Classification:** internal engineering handoff. Sanitized for a public repository.
All caller identifiers (phone, email, street address), provider credentials, and secrets are
redacted. No unrelated customer data is included. Read-only audit: no code, config, hosted
state, or outbound message was changed while producing this report.

---

## 1. Call identity

| Field | Value |
|---|---|
| Vapi call ID | `019fb51e-3190-7992-ba82-57a793908b58` |
| Internal conversation ID | `2395db21-b236-46d0-8775-df6c613cb254` |
| Session token mapping | `chat_conversations.session_token = vapi_call:019fb51e-…` |
| Channel | `voice` (inbound) |
| Start (UTC) | 2026-07-30 22:21:34.38 |
| End (UTC) | 2026-07-30 22:24:06.77 (last journal turn 22:24:08) |
| Duration | ≈ 2 min 33 s |
| Caller | allowlisted internal test line (redacted) |
| Deployed voice build at call time | `voice-adapter-4C-b.6.6-hangup-journal-fallback` |
| Route | legacy orchestrator lane (**inference** — see §5) |
| Provider transcript / recording metadata | **not available**; no end-of-call report received |
| Adapter logs for the window | **not available** (retention starts ≈ 23:10Z) |

Builds 6.7 (`…-6.7`) and 6.8 (`…-6.8-address-gate-enforcement`) were both deployed *after*
this call; the call did not benefit from either.

---

## 2. Ordered transcript reconstruction

Source: canonical `chat_messages` voice journal for the conversation above (provider
transcript unavailable). Wording preserved except for redactions in ⟨angle brackets⟩.
`C` = caller, `A` = assistant.

1. **A:** "Give me just a moment. Great! I can certainly help you with a window cleaning quote. To get started, could you please provide the address of the home where we would be working?"
   **C:** "Yes."
2. **C:** "⟨house number spoken digit-by-digit⟩ ⟨street⟩ Lane."
   **A:** "One moment while I pull that up. Could you please provide the city or ZIP code for ⟨partial address⟩ so we can check if it's in our service area?"
3. **C:** ⟨house number⟩ ⟨street name spelled letter-by-letter⟩, "McKinney, Texas ⟨ZIP⟩."
   **A:** "Sure, let me look that up. It looks like I'm having a little trouble verifying the exact street address ⟨partial address⟩ in McKinney. Could you please double-check the street name or spelling for me?"
4. **C:** ⟨garbled street name from ASR⟩
   **A:** "Sure, one sec. I want to make sure I have that right — did you say ⟨address, written abbreviation form⟩, McKinney, TX ⟨ZIP⟩?"
5. **C:** "Yes."
   **A:** "Give me just a moment. **thought Okay, I need `squareFootage` and `stories` for the window cleaning quote. Let me ask the user for these details.** Great, McKinney is inside our service area! To give you an accurate window cleaning quote, how many square feet is your home, and is it a one, two, or three-story house?"
6. **C:** "Alright. I'm about to hang up."
   **A:** "One moment please. McKinney is in our service area! … square footage … and how many stories …?"
7. **C:** "Alright. I'm about to hang up. Please hurry."
   **A:** "One moment please. I have verified your address as ⟨address⟩ … how many square feet …, one or two-story house?"
8. **C:** "Please hurry. Hey. Can I talk to ⟨owner first name⟩?"
   **A:** "One moment please. Just so I'm accurate: I haven't sent anything yet. I can have a teammate follow up with the written quote, or we can pick an appointment time right now — which would you like?"
9. **C:** "I need to talk to you."
   **A:** *(byte-identical repeat of turn 8)*
10. **C:** "I don't even know the price. So I'll talk to you later."
    **A:** "Absolutely — let me pull that up. Sure. About how large is the home in square feet?"
    → caller hung up.

---

## 3. Turn-by-turn state and tool outcomes

| Time (UTC) | Event | Outcome |
|---|---|---|
| 22:21:35 | quote session created (voice), caller-ID captured | `contact_confirmed` |
| 22:22:19–22:23:23 | `validate_service_area` invoked ≥3× | final persisted: `status: eligible`, `reason: geocoder_ambiguous_or_partial`, Collin County |
| throughout | `calculate_bluladder_quote` | `status: missing_information`, `missing: [squareFootage, stories]`, total `0` — **no price ever produced** |
| — | quote session fields | `stories: 1` = `captured`; `squareFootage` outstanding; `required_remaining: [squareFootage]` |
| — | conversation facts | `facts.property = {}` — **diverges from the quote session above** |
| 22:23:40 | geocoding health issue | opened and resolved |
| 22:23:41 | `escalate_to_human` | `ai_escalations` row `eefe45fd…` created, severity high, needs attention |
| 22:23:41.9 | owner escalation email | **sent / accepted** |
| 22:23:43 | owner escalation SMS row `758e5b9c…` | created, **stuck `status=processing`, `outbox_state=null`** — never dispatched |
| never | availability lookup, slot hold, booking, Jobber write, save-quote, quote-by-text, customer SMS | **none attempted** |
| after hangup | post-hangup bid-link follow-up | **did not fire** (no end-of-call report from provider) |
| final | conversation | `conversation_state=collecting_property_details`, `booking_status=quoted`, `needs_attention=true` |

---

## 4. Confirmed root causes and implicated code

| # | Customer-visible defect | Implicated file / function | Class | Status on `main` |
|---|---|---|---|---|
| 1 | Internal reasoning spoken aloud (`thought Okay, I need squareFootage…`) | `supabase/functions/_shared/aiOrchestrator.ts` — no-tool `choice.content` path returned without the reply sanitizer | orchestration | addressed in 6.8 (`voiceReplySafety.ts` funnel) |
| 2 | Two questions per turn (sqft **and** stories), asked 4×; turns 8–9 byte-identical | same finalize path; no single-question / no-repeat guard | orchestration | partially addressed in 6.8; no repeat-suppression test |
| 3 | "One moment please" filler before every urgent turn → perceived latency | `supabase/functions/_shared/voiceAdapter.ts` acknowledgement emitter | latency / UX | suppression added in 6.7/6.8 |
| 4 | Human request answered with an unrelated quote-by-text sentence; caller never told a human would call back, although the escalation itself succeeded | rail ordering in `aiOrchestrator.ts`; `_shared/voice/voiceExitIntents.ts`; reply ignored the escalation tool's own message | orchestration | rail order fixed in 6.8; **reply wording still unguarded** |
| 5 | Street name lost by ASR; caller forced to spell twice; readback used written abbreviation and no digit-by-digit house number | `supabase/functions/_shared/voice/spokenAddress.ts`; confirmation gate absent in 6.6 | parser | addressed in 6.7/6.8 |
| 6 | Address persisted `eligible` despite `geocoder_ambiguous_or_partial`, without explicit confirmation | `supabase/functions/_shared/aiTools.ts` → `validateServiceAreaTool` persistence | tool / state | addressed in 6.8; ambiguous-street case still permissive |
| 7 | **Fact loss / divergence:** quote session held `stories = 1` while conversation facts held `property = {}`, so the assistant re-asked a captured fact and the engine reported it missing | `supabase/functions/_shared/quoteSession.ts`, `_shared/conversationState.ts` (`persistFacts`, next-question selector) | state | **OPEN** |
| 8 | Owner escalation SMS never dispatched (stuck in `processing`) | `supabase/functions/_shared/sms.ts`; `claim_sms_outbox_send` claim path for `internal_escalation` | integration | **OPEN** |
| 9 | No post-hangup online-bid SMS for a caller who left with no price | `supabase/functions/_shared/voice/hangupBidLinkFollowup.ts` — triggers only on the authoritative end-of-call report, which the provider never delivered | provider + design gap | **OPEN** |
| 10 | Caller ended the call without ever hearing a price | compound consequence of 1–7 | — | — |

Not observed: wrong service scope, changing or repeated price (no price was produced),
availability failure, booking failure (never attempted).

---

## 5. Evidence vs inference

**Confirmed (read directly from canonical tables):** call ID and session-token mapping;
start/end timestamps; the complete ordered voice journal quoted in §2; conversation facts and
quote payload (`missing_information`, total `0`); quote-session field states including
`stories = captured`; escalation row and its email/SMS alert states; the stuck outbox row; the
absence of any booking, availability, save-quote, quote-by-text, customer SMS, Jobber, or
post-hangup follow-up artifact; geocoding health issue open/resolve times.

**Inference (reasoned, not directly logged):**
- Legacy orchestrator lane rather than the workflow controller — conversation facts carry the
  legacy prompt/model markers and no controller state was ever persisted.
- Build 6.6 in effect — deploy ordering plus the presence of exactly the symptoms 6.7 targeted.
- The "I haven't sent anything yet" reply originating from the quote-by-text truthfulness rail —
  source-order reasoning; no rail tag is persisted per turn.

**Missing evidence (explicitly):** provider transcript, recording, and end-of-call artifacts;
`voice-llm-adapter` and `voice-vapi-events` logs for 22:15–22:40 (past retention); any
per-turn route/rail/tool audit record in the database.

---

## 6. Prioritized minimal fixes and regression tests

Ranked by customer impact. Each is intended as a small, independently reviewable change.

1. **Bidirectional quote-session ↔ conversation-facts hydration** (defect 7)
   *Files:* `supabase/functions/_shared/quoteSession.ts`, `_shared/conversationState.ts`
   (`persistFacts`, next-question selector).
   *Change:* hydrate captured session fields into `ConversationFacts.property` before the
   next-question selector and the quote engine run.
   *Tests:* a session with `stories` captured never re-asks stories; `required_remaining` and the
   quote engine's `missing` list are asserted equal for the same state.

2. **Escalation reply must speak the escalation** (defect 4)
   *Files:* `_shared/aiOrchestrator.ts`, `_shared/voice/voiceExitIntents.ts`.
   *Change:* when `escalate_to_human` succeeds, the next spoken turn states a human callback and
   asks no further intake question.
   *Tests:* "can I talk to ⟨owner⟩" → reply contains callback wording, contains no question mark,
   and is not the quote-by-text sentence; a second identical request does not emit a byte-identical
   reply.

3. **Repair the internal-escalation SMS outbox claim** (defect 8)
   *Files:* `_shared/sms.ts`, `claim_sms_outbox_send` claim path.
   *Change:* ensure `internal_escalation` rows reach `outbox_state`; add a sweeper for rows stuck
   in `processing` beyond a short threshold.
   *Tests:* an unclaimed internal escalation is re-claimed and finalized rather than orphaned; a
   sweeper run is idempotent.

4. **Time-based post-hangup fallback** (defect 9)
   *File:* `_shared/voice/hangupBidLinkFollowup.ts`.
   *Change:* fire when a voice conversation has ≥1 user journal turn, no quote delivery or booking,
   and no activity for N minutes — independent of the end-of-call report, with dedupe.
   *Tests:* missing end-of-call report + idle conversation → exactly one follow-up; a late-arriving
   end-of-call report produces no duplicate.

5. **Per-turn voice telemetry row**
   *File:* `_shared/voiceAdapter.ts`.
   *Change:* persist one row per turn recording build ID, route, the rail that produced the reply,
   tools called, and sanitizer actions.
   *Test:* a single turn writes exactly one audit row containing the rail tag and build ID.
   *Rationale:* this audit depended on log data that expires within minutes.

6. **Never persist `eligible` on an ambiguous geocode** (defect 6 residue)
   *File:* `_shared/aiTools.ts` → `validateServiceAreaTool`.
   *Change:* when the geocode reason is ambiguous or partial, require the confirmed readback to
   match the geocoded *street*, not only the house number.
   *Test:* ambiguous geocode + affirmative confirmation still requires street confirmation before
   eligibility is persisted.

---

## 7. Side effects actually created by this call

| Artifact | Result |
|---|---|
| Booking | none |
| Jobber request | none |
| Saved quote / quote-by-text | none |
| Customer-facing SMS | none |
| Escalation record | `ai_escalations` `eefe45fd…` — created, high severity, open |
| Owner escalation email | sent / accepted 22:23:41.9 UTC |
| Owner escalation SMS | row `758e5b9c…` — created, stuck `processing`, never dispatched |
| Post-hangup fallback | did not fire |

No production write of any kind was made by this audit.