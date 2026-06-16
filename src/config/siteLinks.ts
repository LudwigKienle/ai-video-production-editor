const normalizeHttpUrl = (value?: string): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const configuredAdobePortfolioUrl = normalizeHttpUrl(import.meta.env.VITE_ADOBE_PORTFOLIO_URL);
const defaultAdobePortfolioUrl = 'https://luikienle.myportfolio.com/work';

export const ADOBE_PORTFOLIO_URL = configuredAdobePortfolioUrl || defaultAdobePortfolioUrl;
export const HAS_CUSTOM_ADOBE_PORTFOLIO_URL = Boolean(configuredAdobePortfolioUrl);

export const buildAdobePortfolioCaseUrl = (casePath?: string): string => {
  if (!casePath) return ADOBE_PORTFOLIO_URL;
  const normalizedBase = ADOBE_PORTFOLIO_URL.replace(/\/+$/, '');

  // If the base URL already targets a concrete page (e.g. "/work"),
  // do not append per-case slugs to avoid broken links.
  try {
    const parsed = new URL(normalizedBase);
    if (parsed.pathname && parsed.pathname !== '/') {
      return normalizedBase;
    }
  } catch {
    return normalizedBase;
  }

  const normalizedPath = casePath.replace(/^\/+/, '');
  if (!normalizedPath) return normalizedBase;
  return `${normalizedBase}/${normalizedPath}`;
};
