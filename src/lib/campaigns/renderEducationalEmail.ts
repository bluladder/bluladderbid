// ============================================================================
// Pure renderer for evergreen educational emails.
//
// Given the editable `content_config` of a step, produce the final subject
// and body_template string that the existing delivery pipeline will send.
//
// Safety guarantees enforced by tests:
//   - Missing article fields NEVER produce broken links ("undefined", empty
//     hrefs, or dangling "Read more:" lines).
//   - When no valid article URL is configured, the fallback_copy is used.
//   - The compliance footer is always appended.
// ============================================================================

import {
  EVERGREEN_COMPLIANCE_FOOTER,
  type EducationalStepContent,
} from "./evergreenEducationContent";

export interface RenderedEducationalEmail {
  subject: string;
  body: string;
}

function isNonEmpty(v: string | undefined | null): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * A URL is treated as "configured" only when it parses as an absolute http/https
 * URL. Anything else falls back — this is what prevents `href=""` or
 * `undefined` from ever leaking into the sent email.
 */
export function isConfiguredArticleUrl(url: string | undefined | null): boolean {
  if (!isNonEmpty(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Renders the article block or the fallback line. Never emits partial markup.
 * Requires BOTH a non-empty title and a valid URL to render the article
 * variant; anything less falls through to fallback_copy.
 */
export function renderArticleBlock(content: EducationalStepContent): string {
  const hasTitle = isNonEmpty(content.article_title);
  const hasUrl = isConfiguredArticleUrl(content.article_url);
  if (hasTitle && hasUrl) {
    const desc = isNonEmpty(content.article_description)
      ? `\n${content.article_description!.trim()}`
      : "";
    return `Read more: ${content.article_title!.trim()} — ${content.article_url!.trim()}${desc}`;
  }
  // Fallback — always present per content contract.
  return content.fallback_copy.trim();
}

function renderCta(content: EducationalStepContent): string {
  const label = isNonEmpty(content.cta_label) ? content.cta_label.trim() : "Learn more";
  const url = isConfiguredArticleUrl(content.cta_url) ? content.cta_url.trim() : "https://bid.bluladder.com/";
  return `→ ${label}: ${url}`;
}

export function renderEducationalEmail(
  content: EducationalStepContent,
): RenderedEducationalEmail {
  const subject = content.subject.trim();
  const body = [
    content.body.trim(),
    "",
    renderCta(content),
    "",
    renderArticleBlock(content),
    "",
    EVERGREEN_COMPLIANCE_FOOTER,
  ].join("\n");
  return { subject, body };
}