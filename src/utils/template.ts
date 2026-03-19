/**
 * Fill a template string by replacing `{{KEY}}` placeholders with values.
 * Unknown placeholders are left as-is.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}
