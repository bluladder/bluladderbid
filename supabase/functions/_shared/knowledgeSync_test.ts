import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAllowedKnowledgeUrl,
  hashContent,
  diffKnowledge,
  isConflictSensitive,
  type ScrapedItem,
  type ExistingItem,
} from "./knowledgeSync.ts";

Deno.test("allowlist accepts BluLadder.com FAQ/service pages", () => {
  assertEquals(isAllowedKnowledgeUrl("https://www.bluladder.com/faq"), true);
  assertEquals(isAllowedKnowledgeUrl("https://bluladder.com/services"), true);
  assertEquals(isAllowedKnowledgeUrl("https://www.bluladder.com/"), true);
});

Deno.test("allowlist rejects external, old Staten Island, and non-https", () => {
  assertEquals(isAllowedKnowledgeUrl("https://example.com/faq"), false);
  assertEquals(isAllowedKnowledgeUrl("https://www.bluladder.com/staten-island"), false);
  assertEquals(isAllowedKnowledgeUrl("https://www.bluladder.com/new-york/window"), false);
  assertEquals(isAllowedKnowledgeUrl("https://www.bluladder.com/blog/opinion"), false);
  assertEquals(isAllowedKnowledgeUrl("http://www.bluladder.com/faq"), false);
});

Deno.test("hash is stable for equivalent whitespace/case", () => {
  assertEquals(hashContent("Hello  World"), hashContent("hello world"));
});

const scraped: ScrapedItem[] = [
  { knowledgeKey: "web:/faq", title: "FAQ", content: "We clean windows every quarter.", category: "faq", sourcePage: "https://www.bluladder.com/faq" },
  { knowledgeKey: "web:/guarantee", title: "G", content: "100% satisfaction guarantee.", category: "guarantee", sourcePage: "https://www.bluladder.com/guarantee" },
];

Deno.test("unchanged content creates no new revision", () => {
  const existing: ExistingItem[] = [
    { knowledgeKey: "web:/faq", content: "old", sourceHash: hashContent(scraped[0].content), reviewStatus: "published" },
  ];
  const actions = diffKnowledge([scraped[0]], existing);
  assertEquals(actions[0].type, "unchanged");
});

Deno.test("new non-sensitive content becomes a draft", () => {
  const actions = diffKnowledge([scraped[0]], []);
  assertEquals(actions[0].type, "new_draft");
});

Deno.test("guarantee/policy/price content is flagged as conflict, not published", () => {
  assertEquals(isConflictSensitive("guarantee", "anything"), true);
  const actions = diffKnowledge([scraped[1]], []);
  assertEquals(actions[0].type, "conflict");
  if (actions[0].type !== "unchanged") assertEquals(actions[0].requiresOwnerReview, true);
});

Deno.test("website price cannot silently override — flagged conflict", () => {
  const priceItem: ScrapedItem = { knowledgeKey: "web:/services", title: "S", content: "Window cleaning starts at $199.", category: "service", sourcePage: "https://www.bluladder.com/services" };
  const actions = diffKnowledge([priceItem], []);
  assertEquals(actions[0].type, "conflict");
});
