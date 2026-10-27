/**
 * Brand tokens: colours, measures and the brand texts.
 *
 * Colours were sampled from the reference artwork (1600 × 2000 px, median of
 * the inked pixels per element):
 *   green  #1F3B2D  (31, 59, 45)   mark + wordmark
 *   gold   #B8892E  (184, 137, 46) arrow, smile, rule
 *   claim  #8A6420  (138, 100, 32) the claim text is a deeper gold
 *   cream  #F4EFE2  (244, 239, 226) background
 *
 * All geometry uses "logo units" = pixels of that reference artboard, with the
 * origin in the centre of the smiley ring (artboard 800, 817).
 *
 * The brand name lives in exactly one constant below (BRAND_NAME) so the public
 * release guard has a single hit to decide on.
 */

export const BRAND_COLORS = {
  green: '#1F3B2D',
  gold: '#B8892E',
  goldDeep: '#8A6420',
  cream: '#F4EFE2',
  /** Lighter gold for the smile shimmer highlight. */
  goldLight: '#E9C979',
} as const;

export type BrandColor = keyof typeof BRAND_COLORS;

/**
 * Colours of the mark per background. `light` is the reference artwork (cream);
 * `dark` is for the dark app theme, like a boot logo on black: the green parts
 * turn cream, the gold stays gold (a touch brighter so it carries on black).
 */
export type BrandPalette = Record<BrandColor, string>;
export const BRAND_PALETTES: Record<'light' | 'dark', BrandPalette> = {
  light: { ...BRAND_COLORS },
  dark: { green: '#F1EADB', gold: '#C9993C', goldDeep: '#C9993C', cream: '#050506', goldLight: '#F0D488' },
};

/**
 * Single source of the brand name. Brand texts and identifiers stay inside
 * src/brand and scripts/brand; other code only imports from here.
 */
export const BRAND_NAME = 'BUCKSWOOD';
export const PRODUCT_NAME = 'AI VIDEO PRODUCTION EDITOR';
export const CLAIM = 'MAKE EVERYONE HAPPY';

/**
 * Which wordmark the lockup shows. Decided: 'buckswood+product' is the standard.
 * - 'buckswood'          brand name only (as in the reference artwork), optional
 * - 'buckswood+product'  brand name large, product name small underneath (default)
 * - 'product'            product name only, set in the serif, optional
 */
export type WordmarkMode = 'buckswood' | 'buckswood+product' | 'product';
export const WORDMARK_MODES: WordmarkMode[] = ['buckswood', 'buckswood+product', 'product'];
export const DEFAULT_WORDMARK: WordmarkMode = 'buckswood+product';

/** Reference artboard position of the logo-unit origin (ring centre). */
export const ARTBOARD = { width: 1600, height: 2000, originX: 800, originY: 817 } as const;

/** Stroke widths and key measures in logo units (measured on the reference). */
export const BRAND_MEASURES = {
  ringRadius: 156.5,
  ringStroke: 25,
  antlerStroke: 25,
  antlerTineOuterStroke: 20,
  antlerTineInnerStroke: 16,
  smileStroke: 22,
  shaftStroke: 12,
  loopStroke: 11,
  fletchStroke: 9,
  ruleWidth: 240,
  ruleStroke: 3,
  /** Cap heights of the type lines. */
  wordmarkCap: 120,
  productCap: 22,
  productOnlyCap: 62,
  claimCap: 27,
  /** Target widths (reference: wordmark 1252, claim 689). */
  wordmarkWidth: 1252,
  claimWidth: 689,
} as const;

/** Fonts (OFL, from npm @fontsource) used for the outlines in brandGlyphs.generated.ts. */
export const BRAND_FONTS = {
  serif: { family: 'Cormorant Garamond', weight: 600, package: '@fontsource/cormorant-garamond', license: 'SIL OFL 1.1' },
  sans: { family: 'Jost', weight: 500, package: '@fontsource/jost', license: 'SIL OFL 1.1' },
} as const;

/** macOS app icon grid (1024 canvas, 824 body, continuous-corner radius). */
export const ICON_GRID = { canvas: 1024, body: 824, radius: 185, markHeight: 610 } as const;
