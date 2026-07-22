import { describe, it, expect } from "vitest";
import {
  EVERGREEN_EDUCATION_STEPS,
  EVERGREEN_EDUCATION_CAMPAIGN_ID,
  EVERGREEN_COMPLIANCE_FOOTER,
  findForbiddenTimingPhrases,
  type EducationalStepContent,
} from "@/lib/campaigns/evergreenEducationContent";
import {
  renderEducationalEmail,
  renderArticleBlock,
  isConfiguredArticleUrl,
} from "@/lib/campaigns/renderEducationalEmail";

function withArticle(base: EducationalStepContent): EducationalStepContent {
  return {
    ...base,
    article_title: "How BluLadder cleans homes safely",
    article_url: "https://bluladder.com/guide/exterior-cleaning-basics",
    article_description: "A short guide to the methods we use and why.",
  };
}

describe("Evergreen Service Education Nurture — content layer", () => {
  it("has exactly six touches and all are email-only", () => {
    expect(EVERGREEN_EDUCATION_STEPS).toHaveLength(6);
    // Data module carries no SMS content — the campaign is email-only by design.
    // The absence of any `channel` field on EducationalStepContent is the
    // structural guarantee; this test asserts the exported constants stay
    // aligned with that guarantee.
    for (const step of EVERGREEN_EDUCATION_STEPS) {
      expect(step.placeholder_id.startsWith("evergreen_edu_")).toBe(true);
      expect(step.subject.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(0);
      expect(step.cta_label.trim().length).toBeGreaterThan(0);
      expect(step.cta_url.startsWith("https://")).toBe(true);
      expect(step.fallback_copy.trim().length).toBeGreaterThan(0);
    }
  });

  it("campaign id matches the foundation slice UUID", () => {
    expect(EVERGREEN_EDUCATION_CAMPAIGN_ID).toBe(
      "55555555-5555-4555-9555-555555555555",
    );
  });

  it("every touch renders with no article configured (uses fallback, no broken links)", () => {
    for (const step of EVERGREEN_EDUCATION_STEPS) {
      const { subject, body } = renderEducationalEmail(step);
      expect(subject).toBe(step.subject.trim());
      expect(body).toContain(step.fallback_copy.trim());
      // Never render the article header line without an article.
      expect(body).not.toMatch(/Read more:/);
      // No broken markup / placeholders.
      expect(body).not.toMatch(/undefined/);
      expect(body).not.toMatch(/href=""/);
      expect(body).not.toMatch(/\{\{article_/);
      expect(body.endsWith(EVERGREEN_COMPLIANCE_FOOTER)).toBe(true);
    }
  });

  it("every touch renders with an approved article configured", () => {
    for (const step of EVERGREEN_EDUCATION_STEPS) {
      const configured = withArticle(step);
      const { body } = renderEducationalEmail(configured);
      expect(body).toContain("Read more:");
      expect(body).toContain(configured.article_title!);
      expect(body).toContain(configured.article_url!);
      expect(body).toContain(configured.article_description!);
      // Fallback must not double up when an article is present.
      expect(body).not.toContain(step.fallback_copy);
      expect(body).not.toMatch(/undefined/);
    }
  });

  it("missing article fields do not create broken links", () => {
    const [base] = EVERGREEN_EDUCATION_STEPS;
    const cases: Partial<EducationalStepContent>[] = [
      { article_title: "Only a title" }, // url missing
      { article_url: "https://bluladder.com/guide" }, // title missing
      { article_title: "Title", article_url: "not a url" }, // invalid url
      { article_title: "  ", article_url: "https://bluladder.com/guide" }, // blank title
      { article_title: "Title", article_url: "" }, // empty url
      { article_title: "Title", article_url: "javascript:alert(1)" }, // unsafe scheme
    ];
    for (const overrides of cases) {
      const merged: EducationalStepContent = { ...base, ...overrides };
      const block = renderArticleBlock(merged);
      expect(block).toBe(base.fallback_copy.trim());
      const { body } = renderEducationalEmail(merged);
      expect(body).not.toMatch(/Read more:/);
      expect(body).not.toMatch(/undefined/);
      expect(body).not.toMatch(/href=""/);
      expect(body).not.toMatch(/javascript:/i);
    }
  });

  it("isConfiguredArticleUrl only accepts http/https absolute URLs", () => {
    expect(isConfiguredArticleUrl("https://bluladder.com/x")).toBe(true);
    expect(isConfiguredArticleUrl("http://bluladder.com/x")).toBe(true);
    expect(isConfiguredArticleUrl("")).toBe(false);
    expect(isConfiguredArticleUrl(undefined)).toBe(false);
    expect(isConfiguredArticleUrl("bluladder.com/x")).toBe(false);
    expect(isConfiguredArticleUrl("javascript:alert(1)")).toBe(false);
    expect(isConfiguredArticleUrl("mailto:test@x.com")).toBe(false);
  });

  it("Christmas-light copy is timing-neutral (no month names or fixed-season phrases)", () => {
    const christmas = EVERGREEN_EDUCATION_STEPS[5];
    expect(christmas.placeholder_id).toBe("evergreen_edu_day_365");
    const hits = findForbiddenTimingPhrases(
      `${christmas.subject}\n${christmas.body}\n${christmas.cta_label}\n${christmas.fallback_copy}`,
    );
    expect(hits).toEqual([]);
  });

  it("no touch contains fixed-season timing phrases", () => {
    for (const step of EVERGREEN_EDUCATION_STEPS) {
      const combined = [step.subject, step.body, step.cta_label, step.fallback_copy].join("\n");
      const hits = findForbiddenTimingPhrases(combined);
      expect(hits, `step ${step.placeholder_id} has forbidden phrases: ${hits.join(",")}`).toEqual([]);
    }
  });
});