import { EVERGREEN_EDUCATION_STEPS, EVERGREEN_EDUCATION_CAMPAIGN_ID } from "../src/lib/campaigns/evergreenEducationContent";
import { renderEducationalEmail } from "../src/lib/campaigns/renderEducationalEmail";
const esc = (s: string) => s.replace(/'/g, "''");
const parts: string[] = [];
for (let i = 0; i < EVERGREEN_EDUCATION_STEPS.length; i++) {
  const step = EVERGREEN_EDUCATION_STEPS[i];
  const { subject, body } = renderEducationalEmail(step);
  const cfg = {
    placeholder_id: step.placeholder_id, subject: step.subject, body: step.body,
    cta_label: step.cta_label, cta_url: step.cta_url,
    article_title: "", article_url: "", article_description: "",
    fallback_copy: step.fallback_copy,
  };
  parts.push(`UPDATE public.sms_campaign_steps SET subject='${esc(subject)}', body_template='${esc(body)}', content_config='${esc(JSON.stringify(cfg))}'::jsonb, updated_at=now() WHERE campaign_id='${EVERGREEN_EDUCATION_CAMPAIGN_ID}' AND step_order=${i+1};`);
}
console.log(parts.join("\n"));
