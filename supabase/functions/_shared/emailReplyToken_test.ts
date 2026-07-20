import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { issueReplyToken, verifyReplyToken, tokenFromAddress } from "./emailReplyToken.ts";

const SECRET = "test-secret-abc";

Deno.test("issueReplyToken produces a token that verifies", async () => {
  const { token, id } = await issueReplyToken(SECRET);
  const verified = await verifyReplyToken(token, SECRET);
  assertEquals(verified, id);
});

Deno.test("tampered token fails verification", async () => {
  const { token } = await issueReplyToken(SECRET);
  const bad = token.slice(0, -1) + (token.slice(-1) === "A" ? "B" : "A");
  assertEquals(await verifyReplyToken(bad, SECRET), null);
});

Deno.test("wrong secret fails verification", async () => {
  const { token } = await issueReplyToken(SECRET);
  assertEquals(await verifyReplyToken(token, "other"), null);
});

Deno.test("token uniqueness", async () => {
  const a = await issueReplyToken(SECRET);
  const b = await issueReplyToken(SECRET);
  assertNotEquals(a.token, b.token);
});

Deno.test("tokenFromAddress parses reply+<token>@domain", () => {
  assertEquals(tokenFromAddress("reply+abc.def@notify.example.com"), "abc.def");
  assertEquals(tokenFromAddress("someone@example.com"), null);
  assertEquals(tokenFromAddress(""), null);
  assertEquals(tokenFromAddress(null), null);
});

Deno.test("malformed token strings return null", async () => {
  assertEquals(await verifyReplyToken("nodot", SECRET), null);
  assertEquals(await verifyReplyToken(".", SECRET), null);
  assertEquals(await verifyReplyToken("", SECRET), null);
});