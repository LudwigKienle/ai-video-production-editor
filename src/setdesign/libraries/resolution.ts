/** Resolution labels like "1k", "2k", "4k" (Poly Haven, ambientCG "1K"/"1K-JPG"). */

export const resolutionValue = (label: string) => {
  const match = /^(\d+(?:\.\d+)?)\s*k/i.exec(String(label).trim());
  return match ? Number(match[1]) : Number.NaN;
};

export const normalizeResolution = (label?: string | null) => {
  if (!label) return undefined;
  const value = resolutionValue(label);
  return Number.isFinite(value) ? `${value}k` : undefined;
};

export const sortResolutions = (labels: string[]) =>
  [...new Set(labels.map((l) => normalizeResolution(l)).filter((l): l is string => !!l))].sort((a, b) => resolutionValue(a) - resolutionValue(b));

/**
 * The requested resolution if offered, else the largest one below it, else the smallest offered.
 * Without a request: `fallback` (e.g. "2k") chosen the same way.
 */
export const pickResolution = (available: string[], requested: string | undefined, fallback: string) => {
  const sorted = sortResolutions(available);
  if (!sorted.length) return undefined;
  const want = resolutionValue(normalizeResolution(requested) || fallback);
  const below = sorted.filter((label) => resolutionValue(label) <= want);
  return below.length ? below[below.length - 1] : sorted[0];
};

/** "1k" … "16k" up to a maximum pixel width (Poly Haven max_resolution). */
export const resolutionsUpTo = (maxWidth?: number) => {
  if (!maxWidth || !Number.isFinite(maxWidth)) return undefined;
  const out: string[] = [];
  for (let k = 1; k * 1024 <= maxWidth; k *= 2) out.push(`${k}k`);
  return out.length ? out : ['1k'];
};
