# Voice repair Phase 5 — address confirmation

Phase 5 adds a deterministic voice-only address gate after firm pricing and before scheduling or generated-quote delivery.

## Behavior

- A geocoded address remains pending until the caller explicitly confirms the canonical address.
- The readback is concise, preserves the canonical street wording, expands suffixes for speech, and reads the house number digit by digit.
- A house-number mismatch asks for the number one digit at a time.
- Missing or uncertain components receive a bounded clarification attempt.
- One direct correction is revalidated without starting an unbounded readback loop.
- If uncertainty remains, the firm quote is preserved for manual review; scheduling and delivery authority remain closed.
- Web and SMS behavior are unchanged.

## Verification

The focused controller suite passed 54 tests, including the three Phase 5 acceptance cases:

1. One concise confirmation before scheduling.
2. One bounded clarification before manual review.
3. One direct correction followed by revalidation without a second readback.

The compatibility pass also completed the full shared Deno suite after reconciling two superseded regression expectations with the approved Phase 5 wording and canonical street readback. The source/test repair is commit `308ba78fb7f9e0b2b1a5cfc5aad9f49f2c8eaa46`.

The Phase 2 single-flight SQL release candidate remains review-only and unapplied.
