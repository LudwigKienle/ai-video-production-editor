import type { FxUniforms } from '../../types.ts';
import { ADJUSTMENT_GUARD_GLSL } from '../postPluginsCommon/adjustmentGuard.ts';
import { PHOTOREALIZER_DEFAULT_MASKS as M, type PreparedPhotorealizer } from './model.ts';

const glslFloat = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * GLSL ES 3.00 port of `PhotorealizerCore::processPixel` (v0.3). Pure
 * per-pixel colour math plus a deterministic integer-hash sensor texture;
 * statement order and constants follow the C++ core (the embedded Metal
 * kernel in PhotorealizerMetal.mm is the same math with the masks inlined).
 */
export const PHOTOREALIZER_FRAGMENT = /* glsl */ `
uniform float c_plasticReduction;
uniform float c_skinRealism;
uniform float c_highlightRealism;
uniform float c_colorNaturalize;
uniform float c_textureAmount;
uniform float c_microContrast;
uniform float c_gamutGuard;
uniform float c_shadowDepth;
uniform float c_smoothnessBreakup;
uniform float c_outputMix;
uniform bool c_adjustmentLayerGuard;
uniform int s_textureSeed;

// PhotorealizerCore::defaultMasks()
const float MASK_SKIN = ${glslFloat(M.skin)};
const float MASK_PLASTIC = ${glslFloat(M.plastic)};
const float MASK_HIGHLIGHT = ${glslFloat(M.highlight)};
const float MASK_DETAIL = ${glslFloat(M.detail)};

${ADJUSTMENT_GUARD_GLSL}

float pr_luma(vec3 p) { return 0.2627 * p.r + 0.6780 * p.g + 0.0593 * p.b; }

float pr_hash01(int x, int y, int z) {
  uint h = (uint(x) * 73856093u) ^ (uint(y) * 19349663u) ^ (uint(z) * 83492791u);
  h ^= h >> 16u;
  h *= 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return float(h & 0x00ffffffu) / 16777216.0;
}

float pr_softClip(float value, float knee, float amount) {
  if (value <= knee) return value;
  float over = value - knee;
  return knee + over / (1.0 + over * amount * 8.0);
}

float pr_skinWeight(vec3 p) {
  if (!(p.r > p.g && p.g > p.b)) return 0.0;
  float rg = p.r - p.g;
  float gb = p.g - p.b;
  float warm = (rg * gb) / (p.r * p.r + 0.001);
  float exposure = bw_clamp01(1.0 - abs(pr_luma(p) - 0.52) / 0.42);
  return bw_clamp01(warm * 3.0) * exposure;
}

void main() {
  if (c_adjustmentLayerGuard && bw_sourceLooksLikeBlankAdjustment(u_src)) {
    fragColor = vec4(0.0);
    return;
  }
  ivec2 ip = ivec2(bw_pixel());
  vec4 dry = texelFetch(u_src, ip, 0);
  vec3 rgb = dry.rgb;

  float lum0 = pr_luma(rgb);
  float skin = bw_clamp01(max(MASK_SKIN, pr_skinWeight(rgb)) * c_skinRealism);
  float plastic = bw_clamp01(MASK_PLASTIC * c_plasticReduction);
  float highlight = bw_clamp01(max(MASK_HIGHLIGHT, (lum0 - 0.62) / 0.28));

  vec3 chromaV = rgb - lum0;
  float chroma = abs(chromaV.r) + abs(chromaV.g) + abs(chromaV.b);

  float neon = bw_clamp01((chroma - 0.22) / 0.42);
  float gamutCompress = neon * c_gamutGuard;
  rgb.r = lum0 + chromaV.r * (1.0 - 0.38 * gamutCompress);
  rgb.g = lum0 + chromaV.g * (1.0 - 0.30 * gamutCompress);
  rgb.b = lum0 + chromaV.b * (1.0 - 0.34 * gamutCompress);

  rgb.r += 0.018 * skin;
  rgb.g += 0.007 * skin;
  rgb.b -= 0.020 * skin;

  float lum1 = pr_luma(rgb);
  float pivot = 0.42;
  float contrast = 1.0 + c_microContrast * 0.18;
  float shapedLum = pivot + (lum1 - pivot) * contrast;
  rgb += shapedLum - lum1;

  float roll = c_highlightRealism * (0.45 + 0.55 * highlight);
  rgb.r = pr_softClip(rgb.r, 0.74, roll);
  rgb.g = pr_softClip(rgb.g, 0.74, roll);
  rgb.b = pr_softClip(rgb.b, 0.74, roll);

  float lum2 = pr_luma(rgb);
  float shadowMask = bw_clamp01((0.42 - lum2) / 0.42);
  rgb.r *= 1.0 - shadowMask * c_shadowDepth * 0.07;
  rgb.g *= 1.0 - shadowMask * c_shadowDepth * 0.06;
  rgb.b *= 1.0 - shadowMask * c_shadowDepth * 0.04;

  int seed = s_textureSeed;
  float n1 = pr_hash01(ip.x, ip.y, seed) - 0.5;
  float n2 = pr_hash01(ip.x + 19, ip.y - 7, seed + 113) - 0.5;
  float n3 = pr_hash01(ip.x - 5, ip.y + 23, seed + 271) - 0.5;
  float textureMask = bw_clamp01((0.20 + plastic * 0.65 + c_smoothnessBreakup * 0.35) * MASK_DETAIL);
  float textureGain = c_textureAmount * textureMask * 0.018;
  rgb += vec3(n1, n2, n3) * textureGain;

  float lum3 = pr_luma(rgb);
  float naturalSat = 1.0 - c_colorNaturalize * (0.08 + neon * 0.22 + highlight * 0.12);
  rgb = clamp(lum3 + (rgb - lum3) * naturalSat, 0.0, 1.0);

  float t = bw_clamp01(c_outputMix);
  float u = 1.0 - t;
  fragColor = vec4(dry.rgb * u + rgb * t, dry.a * u + dry.a * t);
}
`;

export function photorealizerUniforms(state: PreparedPhotorealizer): FxUniforms {
  const c = state.controls;
  return {
    c_plasticReduction: c.plasticReduction,
    c_skinRealism: c.skinRealism,
    c_highlightRealism: c.highlightRealism,
    c_colorNaturalize: c.colorNaturalize,
    c_textureAmount: c.textureAmount,
    c_microContrast: c.microContrast,
    c_gamutGuard: c.gamutGuard,
    c_shadowDepth: c.shadowDepth,
    c_smoothnessBreakup: c.smoothnessBreakup,
    c_outputMix: c.outputMix,
    c_adjustmentLayerGuard: c.adjustmentLayerGuard,
    s_textureSeed: state.textureSeed,
  };
}
