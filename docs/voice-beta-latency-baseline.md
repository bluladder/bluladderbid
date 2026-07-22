# Voice Beta — First-Response Latency Baseline (Phase 4C-β.3C)

Sanitized timing snapshot captured before Phase 4C-β.3D tuning. Content is
intentionally limited to numeric averages plus per-turn totals. NO transcript,
message content, artifact URL, customer identifier, secret, or full call id
is included. Kept in-repo solely so the next isolated browser test has a
fixed comparison target.

## Assistant

- Assistant: BluLadder Voice Beta (isolated)
- Provider: Vapi web call (browser test, no PSTN, no CallRail)

## Aggregate averages (ms)

| Bucket | Avg | Classification |
| --- | ---: | --- |
| Total turn latency | 8664 | VERY_SLOW |
| Endpointing | 177 | FAST |
| Transcriber | 490 | ACCEPTABLE |
| Model / custom adapter | 7655 | VERY_SLOW (dominant) |
| Voice synthesis | 326 | FAST |
| fromTransport | 20 | FAST |
| toTransport | 44 | FAST |

## Per-turn totals (ms)

[7735, 7373, 10448, 7282, 10483]

## Dominant contributor

Model / custom-adapter time to first useful SSE content delta. The adapter
awaited the full runOrchestrator() result before splitting the reply and
emitting SSE — meaning "streaming" was cosmetic.

## Acceptance targets for the next browser test

Fast knowledge turn:

- First useful SSE content delta <= 1200 ms
- Total model latency <= 2000 ms
- Total turn latency <= 2500 ms

Slow business turn:

- Acknowledgement begins <= 1200 ms
- No unexplained silence > ~1.5 s
- Full result may take longer once tools run

These targets are goals for the isolated test, not customer commitments.
