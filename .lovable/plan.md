# BluLadder Pricing Centralization — Audit + Build Plan

## Phase 1–2 findings (completed now, evidence-based)

**Current authoritative path:** Customer input → `useServicePricing.ts` (a **frontend React hook**, ~556 lines) computes every price → the booking flow sends `subtotal`, `total`, per-service `price`, and `discountAmount` to `jobber-create-booking`, which **trusts them verbatim** (`unitPrice: svc.price`; stores `booking.total` as-is). There is **no server-side recalculation**. This is the core defect.

### Every pricing source discovered
| Source | Controls | In prod? | Hard-coded fallback? | Admin-editable? | Safe? |
|---|---|---|---|---|---|
| `pricing_config` table (11 keys) | All service rates/mods/minimums, bundles | ✅ authoritative | n/a | ✅ (Admin Pricing tab) | ✅ |
| `useServicePricing.ts` (frontend) | The real quote math | ✅ | uses hook below | no | ⚠️ frontend-authoritative |
| `usePricingConfig.DEFAULT_PRICING` | Fallback if DB read fails | ✅ | ✅ **wrong values** | no | ❌ |
| `chat-quote` edge fn `DEFAULT_PRICING` + `calculateQuote` | AI chat quotes | ✅ | ✅ **wrong values** + simplified math | no | ❌ |
| `validate-discount-code` edge fn | Discount lookup only (no total calc) | ✅ | no | codes are admin-editable | ✅ |
| `jobber-create-booking` | Persists total + Jobber line items | ✅ | trusts frontend total | no | ❌ trusts client |
| MCP `get_pricing_info` | Read-only config exposure | ✅ | no | no | ✅ read-only |

### CONFLICTS REQUIRING YOUR APPROVAL (values differ; I will NOT change silently)
The two fallback blocks disagree badly with the live DB. If the DB read ever fails, customers get quoted these **wrong** numbers:

| Item | DB (LIVE/authoritative) | Fallback (wrong) |
|---|---|---|
| Window exterior $/sqft | **0.08** | 0.045 |
| Window interior $/sqft | **0.075** | 0.035 |
| Window minimum | **185** | 150 |
| Window story 2/3 mod | **12% / 18%** | 25% / 50% |
| Window heavy condition | **15%** | 40% |
| House wash $/sqft / min | **0.25 / 396** | 0.12 / 200 |
| Gutter $/sqft / min | **0.08 / 200** | 0.06 / 100 |
| Roof $/sqft / min | **0.30 / 500** | 0.10 / 250 |
| Driveway $/sqft / min | **0.20 / 200** | 0.50 / 150 |
| Pressure wash $/sqft | **0.25** | 0.40 |

**Recommendation (needs your OK):** the DB values are authoritative — replace both fallbacks with **no fallback**: on DB failure return `pricing_unavailable` / `manual_review_required` instead of guessing. I will preserve every live DB value exactly.

**Services with no configured price** (currently manual/quote-only, not in engine): screens, tracks/sills, hard-water restoration line item, solar-panel cleaning, mobile screen repair, commercial. These stay `manual_review` unless you provide rates.

## Proposed implementation

### Phase 3 — Canonical model
Keep the existing `pricing_config` JSON schema (it already models sqft/per-unit/min/modifiers/surface-mult/bundles and is admin-editable — no need to rebuild). Add a **version stamp**: new `pricing_versions` table (immutable snapshots of the full config each time it's published) + `pricing_config.version` counter.

### Phase 4 — One deterministic server engine
- `supabase/functions/_shared/pricingEngine.ts`: a single pure module that ports the **exact** current `useServicePricing` math (decimal-safe integer-cent arithmetic, rounding only at defined points), returns structured output (version, line items, adjustments, discounts, minimum adjustments, subtotal, total, duration, `firm | estimated | manual_review_required | missing_information`, trace, Jobber line-item mapping). Rejects negative/malformed/extreme quantities; never assumes 2000 sqft/1 story.
- `calculate-quote` edge function wrapping it (rate-limited, input-validated with Zod).

### Phase 5 — De-duplicate
- `chat-quote` → calls the shared engine; delete its `DEFAULT_PRICING` + `calculateQuote`.
- `jobber-create-booking` → **recompute** server-side and reconcile against submitted total; reject mismatches.
- Frontend `useServicePricing` → thin client that calls `calculate-quote` for the authoritative total (keeps instant local estimate for UX, clearly labeled "estimate" until server confirms).
- Remove `usePricingConfig.DEFAULT_PRICING` fallback path.

### Phase 6 — Snapshots
Add to `quotes`/`bookings`: `pricing_engine_version`, `pricing_rule_version`, `input_snapshot`, `line_item_snapshot`, `discount_snapshot`. Never retroactively recompute historical rows.

### Phase 7 — Admin controls
Audit existing `PricingEditor`/`PricingTabContent`. Add explicit **Publish** action that writes a `pricing_versions` snapshot + audit row, validation before publish, version history, and a preview that calls `calculate-quote`. Repair, not rebuild.

### Phase 8 — AI contract (contract only, no chat build)
Define `calculate_bluLadder_quote` tool spec pointing at `calculate-quote`; AI may only pass structured inputs and read results, never do arithmetic or use prompt prices. Rate limiting added.

### Phase 9–10 — Tests + controlled verification
Vitest + Deno test matrix (minimums, tiers, story mods, add-ons, exclusivity, bundles, frequency discounts, invalid/missing inputs, ignored client totals, snapshot immutability, override-audit, unauthorized-edit, DB-failure-safe, admin==customer parity, determinism, Jobber reconciliation). Then run tsgo, eslint, build, all tests. Controlled quote-only verification with the approved test identity — **no** Jobber records, SMS, or email.

## Decisions I need from you before I touch live paths
1. Approve treating the **DB values as canonical** and **removing the divergent fallbacks** (no guessed prices on failure).
2. Confirm screens/tracks/solar/screen-repair/commercial stay **manual-review** (or supply rates).
3. OK to add the snapshot/version columns and `pricing_versions` table.

On approval I'll implement Phases 3–10 exactly as above, preserving every current production price.

---

## Follow-up task — make the Deno test suite deterministic (2026-07-14)

Six Deno tests are environment-dependent: they pass in local isolation but fail
in environments where `SUPABASE_URL` / service env vars are present, because
helpers like `campaignEmitter` (`emitCampaignEvent`) and other network-touching
utilities attempt real `fetch` calls instead of hitting an injected stub.
Symptoms show as `emitCampaignEvent FAILED ... status=0/400` log lines and
intermittent failures depending on ambient env.

**Task:** introduce explicit test-environment setup / dependency injection so
every Deno test runs hermetically:
- Inject a fetch/HTTP client (or a `SUPABASE_URL`-guard) into `campaignEmitter`
  and any other module that performs network I/O, defaulting to a no-op/stub in
  tests.
- Add a shared Deno test bootstrap that clears/sets a known env baseline before
  each network-touching test.
- Gate real-network paths behind an explicit env flag so absence of config is a
  deterministic skip, not a failure.

**Hard constraint:** do NOT weaken production suppression, auth, or admin gating
to make tests pass. Tests must be fixed via mocks/DI, never by loosening runtime
safety.
