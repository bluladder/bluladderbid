#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import textwrap


def block(value: str) -> str:
    return textwrap.dedent(value).lstrip("\n")


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one exact occurrence, found {count}: {old[:100]!r}"
        )
    file.write_text(text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    file = Path(path)
    text = file.read_text()
    updated, count = re.subn(
        pattern,
        lambda _match: replacement,
        text,
        count=1,
        flags=flags,
    )
    if count != 1:
        raise SystemExit(
            f"{path}: expected one regex occurrence, found {count}: {pattern[:120]!r}"
        )
    file.write_text(updated)


def replace_region(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{path}: start marker not found: {start_marker[:120]!r}")
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise SystemExit(f"{path}: end marker not found: {end_marker[:120]!r}")
    file.write_text(text[:start] + replacement + text[end:])


ADDRESS_GATE = "supabase/functions/_shared/voice/voiceAddressGate.ts"
CONTROLLER = "supabase/functions/_shared/workflow/workflowController.ts"
ROLLOUT_TEST = "supabase/functions/_shared/workflow/workflowController_rollout_test.ts"

# ---------------------------------------------------------------------------
# Concise, voice-safe address readback and bounded component correction parsing.
# ---------------------------------------------------------------------------
replace_once(
    ADDRESS_GATE,
    '  if (component === "unit") return raw.length <= 20 ? raw : null;',
    block(
        r'''
        if (component === "city") {
          const explicit = raw.match(
            /\bcity(?:\s+is)?\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,2})(?:[,.!?]|$)/i,
          )?.[1];
          const value = (explicit ?? raw).replace(/[.!?]+$/, "").trim();
          if (/^(?:the\s+)?city$/i.test(value)) return null;
          return /^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,2}$/
              .test(value)
            ? value
            : null;
        }
        if (component === "unit") return raw.length <= 20 ? raw : null;'''
    ),
)

replace_once(
    ADDRESS_GATE,
    '  if (component === "street") {\n    const corrected = raw.match(',
    block(
        r'''
        if (component === "street") {
          const direct = raw.replace(
            /^(?:no[, ]+)?(?:the\s+)?street(?:\s+name)?(?:\s+is)?\s+/i,
            "",
          ).replace(/[.!?]+$/, "").trim();
          const corrected = raw.match('''
    ),
)

replace_once(
    ADDRESS_GATE,
    block(
        '''
            if (corrected) {
              return [corrected, suffix ? expandStreetSuffix(suffix) : ""]
                .filter(Boolean).join(" ");
            }
          }
          return raw.length <= 80 && !/@/.test(raw) ? raw : null;'''
    ),
    block(
        '''
            if (corrected) {
              return [corrected, suffix ? expandStreetSuffix(suffix) : ""]
                .filter(Boolean).join(" ");
            }
            if (direct !== raw && direct.length <= 80) return direct;
          }
          return raw.length <= 80 && !/@/.test(raw) ? raw : null;'''
    ),
)

regex_once(
    ADDRESS_GATE,
    r'/\*\* Split "5612 Binbranch Lane, McKinney, TX 75071" for a spoken readback\. \*/\n'
    r'export function buildAddressReadback\(formatted: string\): string \{.*?\n\}\n\n'
    r'(?=/\*\* Ask for the house number one digit at a time \(mismatch recovery\)\. \*/)',
    block(
        r'''
        /** Build one concise confirmation while reading the house number digit by digit. */
        export function buildAddressReadback(formatted: string): string {
          const segs = String(formatted ?? "").split(",").map((s) => s.trim()).filter(
            Boolean,
          );
          const street = segs[0] ?? "";
          const remainder = segs.slice(1);
          const unit = remainder.find((segment) =>
            /^(?:apt|apartment|unit|suite|#)\b/i.test(segment)
          ) ?? "";
          const city = remainder.find((segment) =>
            segment !== unit && !/^[A-Z]{2}\b(?:\s+\d{5})?/i.test(segment)
          ) ?? "";
          const words = street.split(/\s+/).filter(Boolean);
          const house = houseNumberOf(street);
          const body = house ? words.slice(1) : words;
          const suffix = body.length > 1
            ? expandStreetSuffix(body[body.length - 1])
            : "";
          const name = (body.length > 1 ? body.slice(0, -1) : body).join(" ");
          const parts: string[] = [];
          if (house) parts.push(speakDigits(house));
          if (name) parts.push(name);
          if (suffix) parts.push(suffix);
          const conciseStreet = [parts.join(" "), unit].filter(Boolean).join(", ") ||
            street || formatted;
          return `I found ${conciseStreet}${city ? ` in ${city}` : ""}. Is that correct?`;
        }

        '''
    ),
    flags=re.DOTALL,
)

# ---------------------------------------------------------------------------
# One confirmation + one clarification maximum. Preserve the firm quote and
# stop all scheduling/provider continuation if the address remains uncertain.
# ---------------------------------------------------------------------------
replace_once(
    CONTROLLER,
    block(
        '''
        function isControllerOwnedManualReviewTerminal(
          lastStep: string | null | undefined,
        ): boolean {
          return lastStep?.startsWith("manual_review:retry_exhausted:") === true ||
            lastStep?.startsWith("manual_review:conditional_modifier_budget:") === true;
        }'''
    ),
    block(
        '''
        function isControllerOwnedManualReviewTerminal(
          lastStep: string | null | undefined,
        ): boolean {
          return lastStep?.startsWith("manual_review:retry_exhausted:") === true ||
            lastStep?.startsWith("manual_review:conditional_modifier_budget:") === true ||
            lastStep === "manual_review:address_uncertain";
        }'''
    ),
)

capture_block = block(
    '''
      const capture = (next: QuoteSession, lastStep = next.lastStep ?? null) => {
        session = { ...next, lastStep };
        sessionPatch.fields = session.fields;
        sessionPatch.field_status = session.fieldStatus;
        sessionPatch.required_remaining = computeRequired(session.fields);
        sessionPatch.quote_status = session.quoteStatus;
        sessionPatch.booking_ready = session.bookingReady;
        sessionPatch.last_step = lastStep;
      };
    '''
)
helpers = capture_block + block(
    '''

      const addressClarificationAttempts = (): number =>
        Math.max(
          0,
          Number(session.fields.voiceJourney?.retryCounts?.address ?? 0) || 0,
        );

      const addressManualReview = (
        spoken =
          "I couldn't confirm the service address safely, so I kept your quote but stopped scheduling. A team member can verify the address with you.",
      ): ControllerTurnResult => {
        const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
        const next = mergeFields(
          session,
          {
            serviceAreaStatus: "manual_review_required",
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              retryCounts,
              pendingAddressComponent: null,
              requestedNextStep: "none",
              availability: null,
              booking: { status: "not_started" as const },
            },
          },
          { markDerived: ["serviceAreaStatus"] },
        );
        capture(
          { ...next, quoteStatus: session.quoteStatus, bookingReady: false },
          "manual_review:address_uncertain",
        );
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: { kind: "handoff", reason: "safety_or_access_flag" },
            spoken,
          },
        };
      };

      const beginAddressClarification = (
        lastStep: string,
        spoken: string,
      ): ControllerTurnResult => {
        const attempts = addressClarificationAttempts();
        if (attempts >= VOICE_QUOTE_POLICY.address.clarificationLimit) {
          return addressManualReview();
        }
        const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
        capture(
          mergeFields(session, {
            voiceJourney: {
              ...(session.fields.voiceJourney ?? {}),
              retryCounts: { ...retryCounts, address: attempts + 1 },
            },
          }),
          lastStep,
        );
        return {
          sessionId: session.id,
          sessionPatch,
          pre: {
            kind: "fsm",
            action: {
              kind: "ask",
              field: "address",
              prompt: spoken,
            } as unknown as WorkflowAction,
            spoken,
          },
        };
      };
    '''
)
replace_once(CONTROLLER, capture_block, helpers)

regex_once(
    CONTROLLER,
    r'  const validateVoiceAddress = async \([\s\S]*?\n  \};\n\n'
    r'(?=  if \(session\.lastStep\?\.startsWith\("confirming:"\)\) \{)',
    block(
        '''
          const validateVoiceAddress = async (
            candidate: string,
            requireConfirmation = true,
          ): Promise<ControllerTurnResult> => {
            const raw = await measure(
              "address_service_area",
              () =>
                executeTool(
                  "validate_service_area",
                  toolContext,
                  { address: candidate },
                ),
            ) as Record<string, unknown>;
            const components = addressComponentsFromServiceAreaResult(raw);
            const status = String(raw.status ?? "validation_unavailable");
            const formatted = typeof raw.formattedAddress === "string"
              ? raw.formattedAddress.trim()
              : "";
            if (
              (status === "eligible" || status === "manual_review_required") &&
              formatted
            ) {
              const confirmedStatus = status === "eligible"
                ? "eligible" as const
                : "manual_review_required" as const;
              if (!requireConfirmation) {
                if (confirmedStatus !== "eligible") {
                  return addressManualReview(
                    "I corrected the address, but it still needs a team member to verify the service area. I kept your quote and stopped scheduling.",
                  );
                }
                const corrected = mergeFields(
                  session,
                  {
                    address: formatted,
                    addressComponents: components,
                    serviceAreaStatus: confirmedStatus,
                    serviceAreaResult: raw,
                    voiceJourney: {
                      ...(session.fields.voiceJourney ?? {}),
                      pendingAddressComponent: null,
                    },
                  },
                  { markVerified: ["address", "serviceAreaStatus"] },
                );
                const nextAction = decideResidentialQuoteAction(corrected, []);
                if (nextAction.kind === "ask") {
                  capture(corrected, `asked:${nextAction.field}`);
                  return {
                    sessionId: session.id,
                    sessionPatch,
                    pre: {
                      kind: "fsm",
                      action: nextAction,
                      spoken: nextAction.prompt,
                    },
                  };
                }
                if (nextAction.kind === "offer_scheduling") {
                  capture(corrected, "offered_scheduling");
                  return {
                    sessionId: session.id,
                    sessionPatch,
                    pre: {
                      kind: "fsm",
                      action: nextAction,
                      spoken:
                        "Thanks, I corrected the address. Would you like me to check current appointment times?",
                    },
                  };
                }
                return addressManualReview(
                  "I corrected the address, but I couldn't safely continue toward scheduling. I kept your quote for a team member to review.",
                );
              }
              const next = mergeFields(session, {
                address: formatted,
                addressComponents: components,
                serviceAreaStatus: "pending_confirmation",
                serviceAreaResult: raw,
                voiceJourney: {
                  ...(session.fields.voiceJourney ?? {}),
                  pendingAddressComponent: null,
                },
              });
              capture(next, "confirming:address");
              const spoken = buildAddressReadback(formatted);
              return {
                sessionId: session.id,
                sessionPatch,
                pre: {
                  kind: "fsm",
                  action: {
                    kind: "ask",
                    field: "address",
                    prompt: spoken,
                  } as unknown as WorkflowAction,
                  spoken,
                },
              };
            }
            if (status === "address_incomplete") {
              const missing = nextMissingAddressComponent(components);
              capture(
                mergeFields(session, {
                  addressComponents: components,
                  serviceAreaStatus: "unavailable",
                  serviceAreaResult: raw,
                  voiceJourney: {
                    ...(session.fields.voiceJourney ?? {}),
                    pendingAddressComponent: missing,
                  },
                }),
                `address_component:${missing}`,
              );
              return beginAddressClarification(
                `address_component:${missing}`,
                `${addressComponentQuestion(missing)} This is the one address clarification I need before scheduling.`,
              );
            }
            const customerMessage =
              typeof raw.customerMessage === "string" && raw.customerMessage.trim()
                ? raw.customerMessage
                : "I couldn't verify that address right now.";
            if (status === "ineligible") {
              capture(
                mergeFields(
                  session,
                  {
                    serviceAreaStatus: "ineligible",
                    serviceAreaResult: raw,
                    voiceJourney: {
                      ...(session.fields.voiceJourney ?? {}),
                      requestedNextStep: "none",
                      availability: null,
                      booking: { status: "not_started" as const },
                    },
                  },
                  { markDerived: ["serviceAreaStatus", "serviceAreaResult"] },
                ),
                "service_area_ineligible",
              );
              return {
                sessionId: session.id,
                sessionPatch,
                pre: {
                  kind: "fsm",
                  action: { kind: "handoff", reason: "safety_or_access_flag" },
                  spoken: customerMessage,
                },
              };
            }
            capture(
              mergeFields(session, {
                serviceAreaStatus: "unavailable",
                serviceAreaResult: raw,
              }, { markDerived: ["serviceAreaStatus", "serviceAreaResult"] }),
              "service_area_unavailable",
            );
            return addressManualReview(
              `${customerMessage} I kept your quote but stopped scheduling so a team member can verify the address.`,
            );
          };

        '''
    ),
    flags=re.DOTALL,
)

replace_once(
    CONTROLLER,
    block(
        '''
            } else if (field === "address" && session.fields.address) {
              const candidateStatus = String(
                session.fields.serviceAreaResult?.status ?? "",
              );
              const confirmedStatus = candidateStatus === "eligible"
                ? "eligible"
                : candidateStatus === "manual_review_required"
                ? "manual_review_required"
                : "unavailable";
              capture(
                mergeFields(session, {
                  address: session.fields.address,
                  serviceAreaStatus: confirmedStatus,
                }, { markVerified: ["address", "serviceAreaStatus"] }),
                "address_confirmed",
              );
            }
            f = session.fields;'''
    ),
    block(
        '''
            } else if (field === "address" && session.fields.address) {
              const candidateStatus = String(
                session.fields.serviceAreaResult?.status ?? "",
              );
              const confirmedStatus = candidateStatus === "eligible"
                ? "eligible" as const
                : candidateStatus === "manual_review_required"
                ? "manual_review_required" as const
                : "unavailable" as const;
              capture(
                mergeFields(session, {
                  address: session.fields.address,
                  serviceAreaStatus: confirmedStatus,
                }, { markVerified: ["address", "serviceAreaStatus"] }),
                "address_confirmed",
              );
              if (confirmedStatus !== "eligible") {
                return addressManualReview(
                  "I confirmed the address, but the service area still needs a team member to verify it. I kept your quote and stopped scheduling.",
                );
              }
            }
            f = session.fields;'''
    ),
)

replace_region(
    CONTROLLER,
    '    } else if (field === "address") {',
    '    } else {\n      return askConfirmation(',
    block(
        '''
            } else if (field === "address") {
              const component = correctedAddressComponent(input.utterance);
              const correction = component
                ? normalizeAddressComponentAnswer(component, input.utterance)
                : null;
              if (component && correction) {
                const attempts = addressClarificationAttempts();
                if (attempts >= VOICE_QUOTE_POLICY.address.clarificationLimit) {
                  return addressManualReview();
                }
                const retryCounts = session.fields.voiceJourney?.retryCounts ?? {};
                const components = {
                  ...(session.fields.addressComponents ?? {}),
                  [component]: correction,
                };
                const completed = formatAddressComponents(components);
                capture(
                  mergeFields(session, {
                    addressComponents: components,
                    voiceJourney: {
                      ...(session.fields.voiceJourney ?? {}),
                      retryCounts: { ...retryCounts, address: attempts + 1 },
                      pendingAddressComponent: null,
                    },
                  }),
                  "address_correction_captured",
                );
                return await validateVoiceAddress(completed, false);
              }
              return beginAddressClarification(
                "address_component:choose",
                "Which part should I correct: the house number, street, city, state, or ZIP code?",
              );
        '''
    ),
)

replace_region(
    CONTROLLER,
    '  if (session.lastStep?.startsWith("address_component:")) {',
    '  if (session.lastStep === "offered_scheduling") {',
    block(
        '''
          if (session.lastStep?.startsWith("address_component:")) {
            const token = session.lastStep.slice("address_component:".length);
            const component = token === "choose"
              ? correctedAddressComponent(input.utterance)
              : token as AddressComponentName;
            if (!component) return addressManualReview();
            const value = normalizeAddressComponentAnswer(component, input.utterance);
            if (!value) return addressManualReview();
            const components = {
              ...(session.fields.addressComponents ?? {}),
              [component]: value,
            };
            if (
              !components.house_number || !components.street || !components.city ||
              !components.state || !components.postal_code
            ) {
              capture(
                mergeFields(session, {
                  addressComponents: components,
                  voiceJourney: {
                    ...(session.fields.voiceJourney ?? {}),
                    pendingAddressComponent: nextMissingAddressComponent(components),
                  },
                }),
                "address_correction_incomplete",
              );
              return addressManualReview();
            }
            capture(
              mergeFields(session, {
                addressComponents: components,
                voiceJourney: {
                  ...(session.fields.voiceJourney ?? {}),
                  pendingAddressComponent: null,
                },
              }),
              "address_components_complete",
            );
            return await validateVoiceAddress(formatAddressComponents(components), false);
          }
        '''
    ),
)

# ---------------------------------------------------------------------------
# Focused acceptance tests for Phase 5.
# ---------------------------------------------------------------------------
test_file = Path(ROLLOUT_TEST)
test_text = test_file.read_text()
marker = 'Deno.test("phase5 address candidate receives one concise confirmation before scheduling"'
if marker in test_text:
    raise SystemExit("Phase 5 tests are already present")

test_text += block(
    r'''

    function setPhase5AddressSession(sb: any) {
      setFirmWindowSession(sb, "schedule");
      const base = {
        ...sb._state.session.fields,
        name: "Casey Caller",
        email: "casey.phase5@example.invalid",
        phone: "+14695550155",
        callerIdConfirmationStatus: "contact_confirmed",
      } as QuoteSessionFields;
      const inputsKey = sessionInputsKey(base);
      sb._state.session.fields = {
        ...base,
        lastQuoteResult: {
          ...(base.lastQuoteResult ?? {}),
          status: "firm",
          finalQuoteDisposition: "firm",
          inputsKey,
          estimatedTotal: 200.26,
          total: 185,
        },
        voiceJourney: {
          ...(base.voiceJourney ?? {}),
          requestedNextStep: "schedule",
          quoteContext: {
            inputsKey,
            finalQuoteDisposition: "firm",
            estimatedTotal: 200.26,
            spokenAt: "2026-08-05T00:00:00.000Z",
          },
          availability: null,
          booking: { status: "not_started" },
        },
      };
      sb._state.session.field_status = {
        name: "verified",
        email: "verified",
        phone: "verified",
      };
      sb._state.session.last_step = "asked:address";
    }

    const PHASE5_ELIGIBLE_ADDRESS = {
      status: "eligible",
      formattedAddress: "5612 Binbranch Ln, McKinney, TX 75071",
      streetNumber: "5612",
      route: "Binbranch Ln",
      city: "McKinney",
      state: "TX",
      postalCode: "75071",
    } as const;

    Deno.test("phase5 address candidate receives one concise confirmation before scheduling", async () => {
      const sb = makeFake({ pricingRows: PRICING_ROWS });
      setPhase5AddressSession(sb);
      const providerCalls: string[] = [];
      const turn = await runControllerTurn({
        supabase: sb,
        conversationId: "c1",
        channel: "voice",
        utterance: "5612 Binbranch Lane, McKinney, Texas 75071",
        history: [],
        runTool: ((name: string) => {
          providerCalls.push(name);
          return Promise.resolve(PHASE5_ELIGIBLE_ADDRESS);
        }) as any,
      });
      assertEquals(turn.pre.kind, "fsm");
      if (turn.pre.kind === "fsm") {
        assertEquals(turn.pre.action.kind, "ask");
        assertEquals((turn.pre.action as any).field, "address");
        assertEquals(
          turn.pre.spoken,
          "I found five-six-one-two Binbranch Lane in McKinney. Is that correct?",
        );
        assertEquals(turn.pre.spoken.includes("spelled"), false);
        assertEquals((turn.pre.spoken.match(/\?/g) ?? []).length, 1);
        assertEquals(turn.pre.spoken.includes("$"), false);
      }
      let row = await persistAndReload(sb, turn);
      assertEquals(providerCalls, ["validate_service_area"]);
      assertEquals((row.fields as any).serviceAreaStatus, "pending_confirmation");
      assertEquals(row.last_step, "confirming:address");
      assertEquals((row.fields as any).voiceJourney.requestedNextStep, "schedule");
      providerCalls.length = 0;
      const confirmed = await runControllerTurn({
        supabase: sb,
        conversationId: "c1",
        channel: "voice",
        utterance: "yes",
        history: [],
        runTool: ((name: string) => {
          providerCalls.push(name);
          return Promise.resolve({});
        }) as any,
      });
      row = await persistAndReload(sb, confirmed);
      assertEquals(providerCalls, []);
      assertEquals((row.fields as any).address, PHASE5_ELIGIBLE_ADDRESS.formattedAddress);
      assertEquals((row.field_status as any)?.address, "verified");
      assertEquals((row.field_status as any)?.serviceAreaStatus, "verified");
      assertEquals((row.fields as any).serviceAreaStatus, "eligible");
      assertEquals((row.fields as any).voiceJourney.requestedNextStep, "schedule");
      assertEquals(confirmed.pre.kind, "fsm");
      if (confirmed.pre.kind === "fsm") {
        assertEquals(confirmed.pre.action.kind, "offer_scheduling");
        assertEquals(confirmed.pre.spoken.includes("$"), false);
      }
    });

    Deno.test("phase5 address uncertainty allows one clarification then preserves quote for manual review", async () => {
      const sb = makeFake({ pricingRows: PRICING_ROWS });
      setPhase5AddressSession(sb);
      sb._state.session.fields = {
        ...sb._state.session.fields,
        address: PHASE5_ELIGIBLE_ADDRESS.formattedAddress,
        addressComponents: {
          house_number: "5612",
          street: "Binbranch Ln",
          city: "McKinney",
          state: "TX",
          postal_code: "75071",
        },
        serviceAreaStatus: "pending_confirmation",
        serviceAreaResult: PHASE5_ELIGIBLE_ADDRESS,
      };
      sb._state.session.last_step = "confirming:address";
      const providerCalls: string[] = [];
      const first = await runControllerTurn({
        supabase: sb,
        conversationId: "c1",
        channel: "voice",
        utterance: "No, that is not right",
        history: [],
        runTool: ((name: string) => {
          providerCalls.push(name);
          return Promise.resolve({});
        }) as any,
      });
      let row = await persistAndReload(sb, first);
      assertStringIncludes(first.pre.spoken, "Which part should I correct");
      assertEquals((row.fields as any).voiceJourney.retryCounts.address, 1);
      assertEquals(row.last_step, "address_component:choose");
      assertEquals(providerCalls, []);

      const second = await runControllerTurn({
        supabase: sb,
        conversationId: "c1",
        channel: "voice",
        utterance: "I am not sure",
        history: [],
        runTool: ((name: string) => {
          providerCalls.push(name);
          return Promise.resolve({});
        }) as any,
      });
      row = await persistAndReload(sb, second);
      assertEquals(second.pre.kind, "fsm");
      if (second.pre.kind === "fsm") {
        assertEquals(second.pre.action.kind, "handoff");
        assertStringIncludes(second.pre.spoken, "kept your quote but stopped scheduling");
      }
      assertEquals(row.quote_status, "firm");
      assertEquals(row.last_step, "manual_review:address_uncertain");
      assertEquals((row.fields as any).serviceAreaStatus, "manual_review_required");
      assertEquals((row.fields as any).voiceJourney.requestedNextStep, "none");
      assertEquals((row.fields as any).voiceJourney.availability, null);
      assertEquals((row.fields as any).voiceJourney.booking.status, "not_started");
      assertEquals((row.fields as any).address, PHASE5_ELIGIBLE_ADDRESS.formattedAddress);
      assertEquals(providerCalls, []);

      const terminal = await runControllerTurn({
        supabase: sb,
        conversationId: "c1",
        channel: "voice",
        utterance: "The city is Frisco",
        history: [],
        runTool: ((name: string) => {
          providerCalls.push(name);
          return Promise.resolve({});
        }) as any,
      });
      assertEquals(terminal.pre.kind, "fsm");
      if (terminal.pre.kind === "fsm") {
        assertEquals(terminal.pre.action.kind, "handoff");
      }
      assertEquals(providerCalls, []);
    });

    Deno.test("phase5 one direct address correction is revalidated once without a second readback", async () => {
      const sb = makeFake({ pricingRows: PRICING_ROWS });
      setPhase5AddressSession(sb);
      sb._state.session.fields = {
        ...sb._state.session.fields,
        address: "5610 Binbranch Ln, McKinney, TX 75071",
        addressComponents: {
          house_number: "5610",
          street: "Binbranch Ln",
          city: "McKinney",
          state: "TX",
          postal_code: "75071",
        },
        serviceAreaStatus: "pending_confirmation",
        serviceAreaResult: {
          ...PHASE5_ELIGIBLE_ADDRESS,
          formattedAddress: "5610 Binbranch Ln, McKinney, TX 75071",
          streetNumber: "5610",
        },
      };
      sb._state.session.last_step = "confirming:address";
      const providerCalls: string[] = [];
      const turn = await runControllerTurn({
        supabase: sb,
        conversationId: "c1",
        channel: "voice",
        utterance: "No, the house number is 5612",
        history: [],
        runTool: ((name: string, _context: unknown, args: Record<string, unknown>) => {
          providerCalls.push(name);
          assertEquals(args.address, "5612 Binbranch Ln, McKinney TX 75071");
          return Promise.resolve(PHASE5_ELIGIBLE_ADDRESS);
        }) as any,
      });
      const row = await persistAndReload(sb, turn);
      assertEquals(providerCalls, ["validate_service_area"]);
      assertEquals((row.fields as any).voiceJourney.retryCounts.address, 1);
      assertEquals((row.fields as any).serviceAreaStatus, "eligible");
      assertEquals((row.field_status as any)?.address, "verified");
      assertEquals((row.field_status as any)?.serviceAreaStatus, "verified");
      assertEquals(row.last_step, "offered_scheduling");
      assertEquals((row.fields as any).voiceJourney.availability, null);
      assertEquals((row.fields as any).voiceJourney.booking.status, "not_started");
      assertEquals(turn.pre.kind, "fsm");
      if (turn.pre.kind === "fsm") {
        assertEquals(turn.pre.action.kind, "offer_scheduling");
        assertEquals(
          turn.pre.spoken,
          "Thanks, I corrected the address. Would you like me to check current appointment times?",
        );
        assertEquals(turn.pre.spoken.includes("I found"), false);
      }
    });
    '''
)
test_file.write_text(test_text)

print("Phase 5 transformation applied to exactly three source/test files.")
