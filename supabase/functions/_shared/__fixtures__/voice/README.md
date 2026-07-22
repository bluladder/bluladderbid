# Voice adapter offline fixtures

These fixtures exercise the provider-independent voice/LLM adapter without
contacting any telephony provider. They contain no real customer PII. The
configured human transfer destination (`+14692150144`) appears only in the
transfer-resolver tests and in secure test environment configuration — never
in general conversation fixtures.

Files are JSON so they can be shared between Deno tests and any future
Node/Vitest harness without duplicating literal payloads.