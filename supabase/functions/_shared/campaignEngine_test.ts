import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  isAllowedEvent, matchesAudience, consentSatisfies, ALLOWED_EVENTS, STOP_EVENTS,
} from "./campaignEngine.ts";

Deno.test("only allowlisted event names are accepted", () => {
  for (const e of ALLOWED_EVENTS) assertEquals(isAllowedEvent(e), true);
  assertEquals(isAllowedEvent("send_sms"), false);
  assertEquals(isAllowedEvent("random_event"), false);
  assertEquals(isAllowedEvent(""), false);
  assertEquals(isAllowedEvent(null), false);
});

Deno.test("transactional consent is always permitted", () => {
  assertEquals(consentSatisfies("transactional", []), true);
});

Deno.test("marketing requires explicit marketing grant", () => {
  assertEquals(consentSatisfies("marketing", []), false);
  assertEquals(consentSatisfies("marketing", ["transactional"]), false);
  assertEquals(consentSatisfies("marketing", ["requested_follow_up"]), false);
  assertEquals(consentSatisfies("marketing", ["marketing"]), true);
});

Deno.test("requested_follow_up satisfied by follow-up OR marketing", () => {
  assertEquals(consentSatisfies("requested_follow_up", ["requested_follow_up"]), true);
  assertEquals(consentSatisfies("requested_follow_up", ["marketing"]), true);
  assertEquals(consentSatisfies("requested_follow_up", ["transactional"]), false);
  assertEquals(consentSatisfies("requested_follow_up", []), false);
});

Deno.test("empty audience matches everyone", () => {
  assertEquals(matchesAudience({}, {}).matched, true);
  assertEquals(matchesAudience(null, {}).matched, true);
});

Deno.test("new vs existing customer segmentation", () => {
  assertEquals(matchesAudience({ customer_type: "new" }, { customerType: "new" }).matched, true);
  assertEquals(matchesAudience({ customer_type: "new" }, { customerType: "existing" }).matched, false);
  assertEquals(matchesAudience({ customer_type: "existing" }, { customerType: "existing" }).matched, true);
});

Deno.test("service type segmentation (overlap)", () => {
  assertEquals(matchesAudience({ service_types: ["window_cleaning"] }, { serviceTypes: ["window_cleaning", "gutter_cleaning"] }).matched, true);
  assertEquals(matchesAudience({ service_types: ["roof_cleaning"] }, { serviceTypes: ["window_cleaning"] }).matched, false);
});

Deno.test("opted_out=false excludes opted-out prospects", () => {
  assertEquals(matchesAudience({ opted_out: false }, { optedOut: true }).matched, false);
  assertEquals(matchesAudience({ opted_out: false }, { optedOut: false }).matched, true);
});

Deno.test("consent condition gates enrollment", () => {
  assertEquals(matchesAudience({ sms_consent: "granted" }, { smsConsentStatus: "granted" }).matched, true);
  assertEquals(matchesAudience({ sms_consent: "granted" }, { smsConsentStatus: "unknown" }).matched, false);
  assertEquals(matchesAudience({ sms_consent: "any" }, { smsConsentStatus: "unknown" }).matched, true);
});

Deno.test("multiple conditions use AND semantics", () => {
  const conds = { customer_type: "new", service_types: ["window_cleaning"], opted_out: false };
  assertEquals(matchesAudience(conds, { customerType: "new", serviceTypes: ["window_cleaning"], optedOut: false }).matched, true);
  assertEquals(matchesAudience(conds, { customerType: "existing", serviceTypes: ["window_cleaning"], optedOut: false }).matched, false);
});

Deno.test("stop events map to scopes", () => {
  assertEquals(STOP_EVENTS.booking_completed.scope, "abandoned");
  assertEquals(STOP_EVENTS.customer_replied.scope, "all");
  assertEquals(STOP_EVENTS.appointment_cancelled.scope, "reminders");
  assertEquals(STOP_EVENTS.consent_revoked.scope, "all");
  assertEquals(STOP_EVENTS.manual_staff_takeover.scope, "all");
});
