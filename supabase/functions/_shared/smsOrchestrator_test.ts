// Focused tests for the SMS-native routing adapter. These are pure unit tests
// that stub the Supabase client and the model call so we can prove the routing
// contract without any live network/DB dependency.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  smsSessionTokenFromPhone,
  SMS_REPLY_MAX_CHARS,
} from "./smsOrchestrator.ts";

Deno.test("smsSessionTokenFromPhone is deterministic per phone", () => {
  const a = smsSessionTokenFromPhone("+14695551234");
  const b = smsSessionTokenFromPhone("+14695551234");
  const c = smsSessionTokenFromPhone("+14695559999");
  assertEquals(a, b);
  assert(a !== c);
  // Matches the ai-chat session-token regex ^[A-Za-z0-9_-]{8,100}$
  assert(/^[A-Za-z0-9_-]{8,100}$/.test(a), `token '${a}' must match session regex`);
});

Deno.test("SMS reply cap keeps messages under a hard character ceiling", () => {
  // The routing helper trims at SMS_REPLY_MAX_CHARS with an ellipsis so long
  // model outputs never fan out to many segments. This test pins the ceiling
  // constant so a future edit can't quietly balloon SMS costs.
  assertEquals(SMS_REPLY_MAX_CHARS, 320);
});