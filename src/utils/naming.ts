export type NamingTokens = Record<string, string | number | Date | undefined>;

const TOKEN_PATTERN = /\{(\w+)(?::([^}]+))?\}/g;

const sanitizeTemplateName = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
};

const toDate = (value?: string | number | Date) => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
};

const formatDateToken = (format: string | undefined, value?: string | number | Date) => {
  const date = toDate(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const template = format || 'YYYYMMDD';
  return template
    .replace(/YYYY/g, year)
    .replace(/YY/g, year.slice(-2))
    .replace(/MM/g, month)
    .replace(/DD/g, day);
};

export const renderNamingTemplate = (template: string, tokens: NamingTokens) => {
  const trimmed = template.trim();
  if (!trimmed) return '';
  const raw = trimmed.replace(TOKEN_PATTERN, (_match, key: string, format?: string) => {
    if (key === 'date') {
      return formatDateToken(format, tokens.date);
    }
    const value = tokens[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
  return sanitizeTemplateName(raw);
};
