// Tests for the SMS Markdown scrub + length cap enforced at the CallRail
// send site. Ensures AI-drafted bodies with Markdown never reach a customer
// as raw Markdown and never exceed the 2-segment cap.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clampSmsBody, stripMarkdownForSms } from "./sms.ts";

Deno.test("stripMarkdownForSms removes bold, italic, code, headings, bullets", () => {
  const input = [
    "# Heading",
    "**bold** and _italic_ and `code`",
    "- bullet one",
    "- bullet two",
    "> quoted line",
  ].join("\n");
  const out = stripMarkdownForSms(input);
  if (out.includes("**") || out.includes("__") || out.includes("`") || out.includes("# ")) {
    throw new Error(`still has markdown: ${out}`);
  }
  if (!out.includes("bold") || !out.includes("italic")) throw new Error("content lost");
});

Deno.test("stripMarkdownForSms unwraps [text](url) into 'text (url)'", () => {
  const out = stripMarkdownForSms("See [our quote](https://bid.bluladder.com/quote).");
  assertEquals(out, "See our quote (https://bid.bluladder.com/quote).");
});

Deno.test("clampSmsBody caps at 320 chars and preserves word boundary", () => {
  const big = "word ".repeat(100); // 500 chars
  const out = clampSmsBody(big);
  if (out.length > 320) throw new Error(`too long: ${out.length}`);
  if (out.endsWith(" …")) throw new Error("kept trailing space before ellipsis");
});

Deno.test("clampSmsBody leaves short bodies alone", () => {
  assertEquals(clampSmsBody("Short body"), "Short body");
});