import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rollupDeliveryState,
  isConfirmedDelivered,
  customerEscalationMessage,
} from "./escalationDelivery.ts";

Deno.test("no recipient / alerts disabled → no_recipient_configured", () => {
  assertEquals(rollupDeliveryState({ hasRecipient: false, alertsEnabled: true, sms: "skipped", email: "skipped" }), "no_recipient_configured");
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: false, sms: "queued", email: "sent" }), "no_recipient_configured");
});

Deno.test("queued SMS (unconfirmed) is 'queued', never 'sent'", () => {
  const s = rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "queued", email: "skipped" });
  assertEquals(s, "queued");
  assertEquals(isConfirmedDelivered(s), false);
});

Deno.test("confirmed email acceptance → email_sent", () => {
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "skipped", email: "sent" }), "email_sent");
});

Deno.test("one sent + one failed → partially_delivered", () => {
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "failed", email: "sent" }), "partially_delivered");
});

Deno.test("all attempted suppressed → suppressed", () => {
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "suppressed", email: "suppressed" }), "suppressed");
  // suppressed + skipped email still suppressed (only attempted channel was suppressed)
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "suppressed", email: "skipped" }), "suppressed");
});

Deno.test("everything attempted failed → delivery_failed", () => {
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "failed", email: "failed" }), "delivery_failed");
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "failed", email: "not_configured" }), "delivery_failed");
});

Deno.test("queued beats failed when both present (recorded, not failed)", () => {
  assertEquals(rollupDeliveryState({ hasRecipient: true, alertsEnabled: true, sms: "queued", email: "failed" }), "queued");
});

Deno.test("AI cannot claim delivery while only created/queued", () => {
  for (const st of ["created", "queued", "suppressed", "no_recipient_configured"] as const) {
    assertEquals(isConfirmedDelivered(st), false);
    const msg = customerEscalationMessage(st, "urgent", "(469) 747-2877");
    assertEquals(/i've recorded your request/i.test(msg), true);
    assertEquals(/sent an? .*alert/i.test(msg), false);
  }
});

Deno.test("failed delivery produces the fallback-number language", () => {
  const msg = customerEscalationMessage("delivery_failed", "high", "(469) 747-2877");
  assertEquals(msg.includes("unable to confirm"), true);
  assertEquals(msg.includes("(469) 747-2877"), true);
});

Deno.test("urgent language only when severity is urgent", () => {
  const urgent = customerEscalationMessage("sms_sent", "urgent", "(469) 747-2877");
  const high = customerEscalationMessage("sms_sent", "high", "(469) 747-2877");
  assertEquals(/urgent/i.test(urgent), true);
  assertEquals(/urgent/i.test(high), false);
});

Deno.test("office number always the approved public fallback, never ResponsiBid", () => {
  for (const st of ["created", "delivery_failed", "sms_sent"] as const) {
    const msg = customerEscalationMessage(st, "normal", "(469) 747-2877");
    assertEquals(msg.includes("469) 242-6556"), false);
  }
});
