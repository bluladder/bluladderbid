export interface TemplateVar {
  token: string;
  label: string;
  example: string;
}

// Variables supported by the server-side render_msg_template() function.
export const TEMPLATE_VARS: TemplateVar[] = [
  { token: '{{first_name}}', label: 'First name', example: 'Jordan' },
  { token: '{{name}}', label: 'Full name', example: 'Jordan Smith' },
  { token: '{{service}}', label: 'Service', example: 'Window Cleaning' },
  { token: '{{date}}', label: 'Appointment date', example: 'Tue, Jul 14' },
  { token: '{{time}}', label: 'Arrival time', example: '9:00 AM' },
  { token: '{{link}}', label: 'Quote / appointment link', example: 'https://…' },
  { token: '{{total}}', label: 'Total price', example: '$349.00' },
];

export function previewTemplate(text: string): string {
  let out = text || '';
  for (const v of TEMPLATE_VARS) {
    const re = new RegExp(v.token.replace(/[{}]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
    out = out.replace(re, v.example);
  }
  return out;
}
