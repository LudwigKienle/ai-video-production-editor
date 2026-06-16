import { ClipFilters, FilmLutId } from '../types';

type FilmLutPreset = {
  id: FilmLutId;
  name: string;
  description: string;
  delta: {
    brightness: number;
    contrast: number;
    saturate: number;
    hueRotate: number;
  };
};

export const FILM_LUTS: FilmLutPreset[] = [
  {
    id: 'none',
    name: 'None',
    description: 'No film emulation.',
    delta: { brightness: 0, contrast: 0, saturate: 0, hueRotate: 0 },
  },
  {
    id: 'kodak-2383',
    name: 'Kodak 2383 Print',
    description: 'Punchy contrast with a gentle warm bias.',
    delta: { brightness: -2, contrast: 18, saturate: 8, hueRotate: 3 },
  },
  {
    id: 'kodak-portra-400',
    name: 'Kodak Portra 400',
    description: 'Soft contrast, rich skin tones, warm highlights.',
    delta: { brightness: 4, contrast: -6, saturate: 14, hueRotate: 5 },
  },
  {
    id: 'fuji-400h',
    name: 'Fuji 400H',
    description: 'Cooler greens with pastel contrast.',
    delta: { brightness: 2, contrast: -8, saturate: 6, hueRotate: -6 },
  },
  {
    id: 'fuji-3513',
    name: 'Fuji 3513 Print',
    description: 'Classic print contrast with cooler shadows.',
    delta: { brightness: -1, contrast: 14, saturate: 5, hueRotate: -4 },
  },
  {
    id: 'cinestill-800t',
    name: 'Cinestill 800T',
    description: 'Tungsten warmth with extra pop.',
    delta: { brightness: -3, contrast: 12, saturate: 12, hueRotate: 8 },
  },
  {
    id: 'ilford-hp5',
    name: 'Ilford HP5',
    description: 'High contrast monochrome feel.',
    delta: { brightness: -4, contrast: 22, saturate: -100, hueRotate: 0 },
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    description: 'Desaturated, gritty, high-contrast look.',
    delta: { brightness: -6, contrast: 24, saturate: -55, hueRotate: 0 },
  },
];

type LookPreset = {
  id: string;
  name: string;
  category: 'Film Stock' | 'Clean Cinematic' | 'Vintage/Lo-fi' | 'Stylized';
  description: string;
  filters: Partial<ClipFilters>;
};

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: 'film-kodak-2383',
    name: 'Kodak 2383 Print',
    category: 'Film Stock',
    description: 'Crisp contrast, warm highlights, restrained glow.',
    filters: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, lut: 'kodak-2383', lutIntensity: 88, grain: 18, halation: 12, bloom: 8, vignette: 10 },
  },
  {
    id: 'film-portra-400',
    name: 'Kodak Portra 400',
    category: 'Film Stock',
    description: 'Soft rolloff, warm skin bias, gentle texture.',
    filters: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, lut: 'kodak-portra-400', lutIntensity: 86, grain: 14, halation: 8, bloom: 6, vignette: 8 },
  },
  {
    id: 'film-fuji-3513',
    name: 'Fuji 3513 Print',
    category: 'Film Stock',
    description: 'Cooler shadows with a clean print snap.',
    filters: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, lut: 'fuji-3513', lutIntensity: 90, grain: 12, halation: 10, bloom: 6, vignette: 10 },
  },
  {
    id: 'clean-neutral-glow',
    name: 'Neutral Glow',
    category: 'Clean Cinematic',
    description: 'Subtle bloom and halation with a soft vignette.',
    filters: { brightness: 102, contrast: 104, saturate: 104, hueRotate: 0, lut: 'none', lutIntensity: 100, grain: 4, halation: 10, bloom: 14, vignette: 10 },
  },
  {
    id: 'clean-crisp',
    name: 'Crisp Cinematic',
    category: 'Clean Cinematic',
    description: 'Sharper contrast with controlled glow.',
    filters: { brightness: 100, contrast: 112, saturate: 108, hueRotate: 0, lut: 'none', lutIntensity: 100, grain: 6, halation: 12, bloom: 18, vignette: 12 },
  },
  {
    id: 'vintage-warm',
    name: 'Warm Lo-Fi',
    category: 'Vintage/Lo-fi',
    description: 'Heavy glow, lifted mids, warm halation.',
    filters: { brightness: 98, contrast: 95, saturate: 92, hueRotate: 6, lut: 'cinestill-800t', lutIntensity: 88, grain: 42, halation: 48, bloom: 52, vignette: 40 },
  },
  {
    id: 'vintage-bypass',
    name: 'Gritty Bypass',
    category: 'Vintage/Lo-fi',
    description: 'Desaturated, punchy contrast with deep vignette.',
    filters: { brightness: 96, contrast: 120, saturate: 82, hueRotate: 0, lut: 'bleach-bypass', lutIntensity: 92, grain: 35, halation: 30, bloom: 34, vignette: 48 },
  },
  {
    id: 'film-fuji-400h',
    name: 'Fuji 400H Soft',
    category: 'Film Stock',
    description: 'Pastel highlights and cool, airy mids.',
    filters: { brightness: 102, contrast: 96, saturate: 104, hueRotate: 0, lut: 'fuji-400h', lutIntensity: 88, grain: 14, halation: 6, bloom: 8, vignette: 8 },
  },
  {
    id: 'film-cinestill-night',
    name: 'Cinestill Night',
    category: 'Film Stock',
    description: 'Neon-friendly tungsten look for night scenes.',
    filters: { brightness: 96, contrast: 112, saturate: 114, hueRotate: 2, lut: 'cinestill-800t', lutIntensity: 90, grain: 22, halation: 26, bloom: 24, vignette: 14 },
  },
  {
    id: 'clean-commercial',
    name: 'Commercial Clean',
    category: 'Clean Cinematic',
    description: 'Bright polished ad look with minimal texture.',
    filters: { brightness: 106, contrast: 108, saturate: 112, hueRotate: 0, lut: 'none', lutIntensity: 100, grain: 2, halation: 6, bloom: 10, vignette: 6 },
  },
  {
    id: 'clean-cool-steel',
    name: 'Cool Steel',
    category: 'Clean Cinematic',
    description: 'Subtle cool bias for modern tech visuals.',
    filters: { brightness: 100, contrast: 110, saturate: 98, hueRotate: 12, lut: 'none', lutIntensity: 100, grain: 4, halation: 8, bloom: 12, vignette: 8 },
  },
  {
    id: 'stylized-neon-dream',
    name: 'Neon Dream',
    category: 'Stylized',
    description: 'High saturation with glowing highlights.',
    filters: { brightness: 102, contrast: 118, saturate: 140, hueRotate: 18, lut: 'none', lutIntensity: 100, grain: 10, halation: 34, bloom: 38, vignette: 12 },
  },
  {
    id: 'stylized-mono-noir',
    name: 'Mono Noir',
    category: 'Stylized',
    description: 'Dark monochrome drama with strong falloff.',
    filters: { brightness: 92, contrast: 138, saturate: 10, hueRotate: 0, lut: 'ilford-hp5', lutIntensity: 88, grain: 26, halation: 14, bloom: 12, vignette: 44 },
  },
];

export const DEFAULT_FILTERS: ClipFilters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hueRotate: 0,
  grain: 0,
  halation: 0,
  bloom: 0,
  vignette: 0,
  lut: 'none',
  lutIntensity: 100,
  customLut: null,
  customLutName: null,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeFilters = (filters?: Partial<ClipFilters> | null): ClipFilters => {
  const normalized: ClipFilters = {
    ...DEFAULT_FILTERS,
    ...(filters || {}),
  };
  const isKnownLut = normalized.lut === 'custom' || FILM_LUTS.some((lut) => lut.id === normalized.lut);
  if (!isKnownLut) {
    normalized.lut = 'none';
  }
  return normalized;
};

const applyLut = (filters: ClipFilters): ClipFilters => {
  if (filters.lut === 'none' || filters.lut === 'custom' || filters.lutIntensity <= 0) {
    return filters;
  }
  const preset = FILM_LUTS.find((entry) => entry.id === filters.lut);
  if (!preset) {
    return filters;
  }
  const strength = clamp(filters.lutIntensity, 0, 100) / 100;
  return {
    ...filters,
    brightness: clamp(filters.brightness + preset.delta.brightness * strength, 0, 200),
    contrast: clamp(filters.contrast + preset.delta.contrast * strength, 0, 200),
    saturate: clamp(filters.saturate + preset.delta.saturate * strength, 0, 200),
    hueRotate: filters.hueRotate + preset.delta.hueRotate * strength,
  };
};

export const buildFilterString = (filters?: Partial<ClipFilters> | null) => {
  const normalized = normalizeFilters(filters);
  const effective = applyLut(normalized);
  const isNeutral =
    effective.brightness === 100 &&
    effective.contrast === 100 &&
    effective.saturate === 100 &&
    effective.hueRotate === 0;
  if (isNeutral) {
    return '';
  }
  return `brightness(${effective.brightness}%) contrast(${effective.contrast}%) saturate(${effective.saturate}%) hue-rotate(${effective.hueRotate}deg)`;
};

export const getGrainStrength = (filters?: Partial<ClipFilters> | null) => {
  const normalized = normalizeFilters(filters);
  return clamp(normalized.grain, 0, 100);
};

export const getHalationStrength = (filters?: Partial<ClipFilters> | null) => {
  const normalized = normalizeFilters(filters);
  return clamp(normalized.halation, 0, 100);
};

export const getBloomStrength = (filters?: Partial<ClipFilters> | null) => {
  const normalized = normalizeFilters(filters);
  return clamp(normalized.bloom, 0, 100);
};

export const getVignetteStrength = (filters?: Partial<ClipFilters> | null) => {
  const normalized = normalizeFilters(filters);
  return clamp(normalized.vignette, 0, 100);
};
