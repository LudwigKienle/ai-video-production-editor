import type { FxUniforms } from '../../types.ts';
import { FE_SINF_GLSL, glslFloat as g } from './glslSinf.ts';
import { FILM_PRINT_FIELDS, FILM_STOCK_FIELDS, type PreparedFilm } from './model.ts';

/**
 * GLSL port of `FilmEmulationCore::processPixel` (v2.1, single-frame path)
 * plus the OFX adjustment-layer guard. Statement order and constants follow
 * the C++ core so CPU (cpu.ts) and WebGL agree. Single pass: the optical
 * (halation/bloom) stage only needs 8 taps around the pixel.
 */
export const FILM_EMULATION_FRAGMENT = /* glsl */ `
${FE_SINF_GLSL}
${FILM_STOCK_FIELDS.map((field) => `uniform float st_${field};`).join('\n')}
${FILM_PRINT_FIELDS.map((field) => `uniform float pr_${field};`).join('\n')}

uniform int c_inputSpace;
uniform int c_viewMode;
uniform int c_grainMode;
uniform bool c_adjustmentLayerGuard;
uniform float c_density;
uniform float c_contrast;
uniform float c_developerContrast;
uniform float c_developerGamma;
uniform float c_colorSeparation;
uniform float c_colorBoost;
uniform float c_saturation;
uniform float c_temperature;
uniform float c_tint;
uniform float c_subtractiveColor;
uniform float c_interlayer;
uniform float c_neutralizeCurves;
uniform float c_bleachBypass;
uniform float c_filmCompression;
uniform float c_compressionWhitePoint;
uniform float c_compressionRange;
uniform float c_compressionColorDensity;
uniform float c_expandBlackPoint;
uniform float c_expandWhitePoint;
uniform float c_printerCyan;
uniform float c_printerMagenta;
uniform float c_printerYellow;
uniform float c_highlightRolloff;
uniform float c_blackLift;
uniform float c_halationLocal;
uniform float c_halationGlobal;
uniform float c_halationRedShift;
uniform float c_bloomThreshold;
uniform float c_grainShadows;
uniform float c_grainMidtones;
uniform float c_grainHighlights;
uniform float c_grainChroma;
uniform float c_filmResolution;
uniform float c_dust;
uniform float c_scratches;
uniform float c_skinProtect;
uniform float c_outputMix;

uniform vec2 fe_weave;
uniform float fe_exposureGain;
uniform float fe_grainAmount;
uniform bool fe_colorStage;
uniform bool fe_textureStage;
uniform float fe_haloAmount;
uniform float fe_bloomAmount;
uniform float fe_opticalRadius;
uniform float fe_grainScale;
uniform float fe_grainProfileBias;

float fe_clamp01(float v) { return clamp(v, 0.0, 1.0); }
// Core smoothstep: epsilon 0.0001 (bw_smoothstep uses 0.00001).
float fe_smooth(float e0, float e1, float x) {
  float t = fe_clamp01((x - e0) / max(0.0001, e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}
float fe_safePow(float v, float e) { return pow(max(0.0, v), e); }
float fe_log2(float v) { return log2(max(0.000001, v)); }
float fe_luma(vec3 c) { return 0.2627 * c.r + 0.6780 * c.g + 0.0593 * c.b; }
vec3 fe_sat(vec3 c, float amount) { float y = fe_luma(c); return vec3(y) + (c - vec3(y)) * amount; }
vec3 fe_mix(vec3 a, vec3 b, float t) { return a * (1.0 - t) + b * t; }

float fe_decode1(float value) {
  float v = clamp(value, 0.0, 64.0);
  if (c_inputSpace == 2) return v;
  if (c_inputSpace == 3) return exp2((v - 0.410557) * 7.5) * 0.18;
  if (c_inputSpace == 4) return exp2((v - 0.391) * 6.65) * 0.18;
  if (c_inputSpace == 5) return exp2((v - 0.278) * 7.85) * 0.18;
  if (c_inputSpace == 6) return exp2((v - 0.405) * 7.05) * 0.18;
  if (c_inputSpace == 7) return exp2((v - 0.380) * 6.45) * 0.18;
  return fe_safePow(v, 2.4);
}
vec3 fe_decode(vec3 c) { return vec3(fe_decode1(c.r), fe_decode1(c.g), fe_decode1(c.b)); }

float fe_encode1(float value) {
  float v = max(0.0, value);
  float o;
  if (c_inputSpace == 2) o = v;
  else if (c_inputSpace == 3) o = fe_log2(v / 0.18) / 7.5 + 0.410557;
  else if (c_inputSpace == 4) o = fe_log2(v / 0.18) / 6.65 + 0.391;
  else if (c_inputSpace == 5) o = fe_log2(v / 0.18) / 7.85 + 0.278;
  else if (c_inputSpace == 6) o = fe_log2(v / 0.18) / 7.05 + 0.405;
  else if (c_inputSpace == 7) o = fe_log2(v / 0.18) / 6.45 + 0.380;
  else o = fe_safePow(v, 1.0 / 2.4);
  return clamp(o, 0.0, c_inputSpace == 2 ? 64.0 : 1.0);
}

// OFX FloatSampler: bilinear inside the frame, transparent black outside.
vec4 fe_sample(vec2 p) {
  vec2 hi = u_size - 1.0;
  if (p.x < 0.0 || p.x > hi.x || p.y < 0.0 || p.y > hi.y) return vec4(0.0);
  return bw_sample(u_src, p);
}

float fe_curve1(float value, float contrast, float toe, float shoulder, float logPivot) {
  float v = max(0.0, value);
  float logValue = fe_log2(v + 0.00001);
  logValue = logPivot + (logValue - logPivot) * contrast;
  v = exp2(logValue);
  if (toe > 0.0001) {
    float t = toe * 0.20;
    v = (v * (1.0 + t)) / (1.0 + t / max(v, 0.00001));
  }
  if (shoulder > 0.0001) v = v / (1.0 + v * shoulder * 0.34);
  return max(0.0, v);
}
vec3 fe_curve(vec3 c, float contrast, float toe, float shoulder) {
  float lp = fe_log2(0.18);
  return vec3(fe_curve1(c.r, contrast, toe, shoulder, lp), fe_curve1(c.g, contrast, toe, shoulder, lp), fe_curve1(c.b, contrast, toe, shoulder, lp));
}

float fe_skinMask(vec3 c) {
  float sum = max(0.0001, c.r + c.g + c.b);
  float nr = c.r / sum;
  float ng = c.g / sum;
  float nb = c.b / sum;
  float y = fe_luma(c);
  float hueZone = fe_smooth(0.32, 0.46, nr) * (1.0 - fe_smooth(0.54, 0.68, nr)) * fe_smooth(0.24, 0.36, ng) * (1.0 - fe_smooth(0.40, 0.52, nb));
  float brightness = fe_smooth(0.035, 0.14, y) * (1.0 - fe_smooth(1.25, 2.2, y));
  float skinOrder = fe_smooth(-0.06, 0.08, c.r - c.b);
  return fe_clamp01(hueZone * brightness * skinOrder);
}

vec3 fe_subtractive(vec3 c, float amount, float skin) {
  float a = fe_clamp01(amount) * (1.0 - skin * 0.62);
  if (a <= 0.0001) return c;
  float y = max(0.0001, fe_luma(c));
  vec3 chroma = (c - vec3(y)) / y;
  float sat = max(abs(chroma.r), max(abs(chroma.g), abs(chroma.b)));
  float density = 1.0 - fe_clamp01(sat * a * 0.24);
  vec3 o = vec3(
    c.r * (density - a * max(0.0, -chroma.r) * 0.08),
    c.g * (density - a * max(0.0, -chroma.g) * 0.06),
    c.b * (density - a * max(0.0, -chroma.b) * 0.10));
  return o + vec3(y * a * 0.010, y * a * 0.002, -y * a * 0.008);
}

vec3 fe_tempTint(vec3 c, float temperature, float tint, float skin) {
  float protect = 1.0 - skin * 0.54;
  float temp = clamp(temperature, -1.0, 1.0) * protect;
  float tn = clamp(tint, -1.0, 1.0) * protect;
  return c * vec3(1.0 + temp * 0.055 - tn * 0.010, 1.0 + tn * 0.040, 1.0 - temp * 0.060 - tn * 0.016);
}

vec3 fe_developer(vec3 c, float skin) {
  float contrast = 1.0 + clamp(c_developerContrast, -1.0, 1.0) * 0.42;
  float gamma = 1.0 / max(0.12, 1.0 + clamp(c_developerGamma, -1.0, 1.0) * 0.55);
  vec3 p = fe_curve(c, contrast, 0.08 * max(0.0, c_developerContrast), 0.12);
  p = vec3(fe_safePow(p.r, gamma), fe_safePow(p.g, gamma), fe_safePow(p.b, gamma));
  float y = fe_luma(p);
  float sep = fe_clamp01(c_colorSeparation) * (1.0 - skin * 0.50);
  if (sep > 0.0001) {
    p.r = y + (p.r - y) * (1.0 + sep * 0.42);
    p.g = y + (p.g - y) * (1.0 + sep * 0.30);
    p.b = y + (p.b - y) * (1.0 + sep * 0.46);
    p.r -= max(0.0, p.g - p.r) * sep * 0.035;
    p.b -= max(0.0, p.g - p.b) * sep * 0.025;
  }
  float boost = clamp(c_colorBoost, -1.0, 1.0);
  if (abs(boost) > 0.0001) p = fe_sat(p, 1.0 + boost * 0.36 * (1.0 - skin * 0.45));
  return p;
}

float fe_compress1(float value, float threshold, float impact, float whitePoint) {
  if (value <= threshold) return value;
  float over = value - threshold;
  float soft = threshold + over / (1.0 + over * impact * (1.8 / whitePoint));
  return value + (soft - value) * impact;
}

vec3 fe_compression(vec3 c) {
  float impact = fe_clamp01(c_filmCompression);
  if (impact <= 0.0001) return c;
  float whitePoint = clamp(c_compressionWhitePoint, 0.35, 4.0);
  float range = clamp(c_compressionRange, 0.05, 1.0);
  float density = fe_clamp01(c_compressionColorDensity);
  float threshold = whitePoint * (1.0 - range * 0.42);
  vec3 o = vec3(fe_compress1(c.r, threshold, impact, whitePoint), fe_compress1(c.g, threshold, impact, whitePoint), fe_compress1(c.b, threshold, impact, whitePoint));
  if (density > 0.0001) {
    float beforeY = max(0.0001, fe_luma(c));
    float afterY = max(0.0001, fe_luma(o));
    float lift = clamp(beforeY / afterY, 0.75, 1.35);
    o = vec3(afterY) + (o - vec3(afterY)) * (vec3(1.0) + density * (lift - 1.0) * vec3(0.72, 0.58, 0.66));
  }
  return o;
}

vec3 fe_expand(vec3 c) {
  float black = clamp(c_expandBlackPoint, -1.0, 1.0) * 0.055;
  float white = clamp(c_expandWhitePoint, -1.0, 1.0) * 0.16;
  return (c - vec3(black)) * (1.0 + white - black);
}

vec3 fe_printerLights(vec3 c) {
  float cy = clamp(c_printerCyan, -1.0, 1.0);
  float mg = clamp(c_printerMagenta, -1.0, 1.0);
  float ye = clamp(c_printerYellow, -1.0, 1.0);
  return c * vec3(
    exp2(-cy * 0.115 + mg * 0.018 + ye * 0.012),
    exp2(cy * 0.014 - mg * 0.110 + ye * 0.018),
    exp2(cy * 0.020 + mg * 0.016 - ye * 0.118));
}

vec3 fe_stock(vec3 c, float skin) {
  float density = clamp(c_density + st_density, -1.0, 2.0);
  vec3 p = c * vec3(exp2(-density * 0.085), exp2(-density * 0.070), exp2(-density * 0.090));
  p = fe_tempTint(p, c_temperature + st_warmth * 8.0, c_tint + st_greenBias * 10.0, skin);
  p.b *= 1.0 + st_blueBias;

  float neutral = fe_clamp01(c_neutralizeCurves);
  float contrast = clamp(c_contrast * (st_contrast + (1.0 - st_contrast) * neutral), 0.25, 2.8);
  float toe = clamp((st_toe + max(0.0, c_density) * 0.08) * (1.0 - neutral * 0.72), 0.0, 1.2);
  float shoulder = clamp((st_shoulder + c_highlightRolloff * 0.28) * (1.0 - neutral * 0.58), 0.0, 1.5);
  p = fe_curve(p, contrast, toe, shoulder);
  p = fe_sat(p, clamp(c_saturation * st_saturation, 0.0, 2.2));

  float interlayer = fe_clamp01(c_interlayer);
  if (interlayer > 0.0001) {
    float y = fe_luma(p);
    vec3 inhibit = max(vec3(0.0), p - vec3(y)) * interlayer;
    float k = 1.0 - skin * 0.35;
    p.r -= (inhibit.g * 0.025 + inhibit.b * 0.045) * k;
    p.g -= (inhibit.r * 0.026 + inhibit.b * 0.020) * k;
    p.b -= (inhibit.r * 0.048 + inhibit.g * 0.018) * k;
    p = fe_sat(p, 1.0 + interlayer * 0.08);
  }
  p = fe_subtractive(p, fe_clamp01(c_subtractiveColor + st_subtractive), skin);

  if (st_pastel > 0.0001) {
    float q = fe_clamp01(st_pastel);
    float y = fe_luma(p);
    vec3 pastel = vec3(
      y + (p.r - y) * (1.0 - q * 0.32) + q * 0.010,
      y + (p.g - y) * (1.0 - q * 0.26) + q * 0.008,
      y + (p.b - y) * (1.0 - q * 0.28) + q * 0.006);
    p = fe_mix(p, pastel, q);
  }
  if (st_monochrome > 0.0001) {
    float y = 0.30 * p.r + 0.59 * p.g + 0.11 * p.b;
    p = fe_mix(p, vec3(y), fe_clamp01(st_monochrome));
  }
  float bleach = fe_clamp01(c_bleachBypass + st_silver);
  if (bleach > 0.0001) {
    float silver = fe_clamp01(bleach);
    vec3 gray = fe_sat(p, 0.0);
    vec3 dense = fe_curve(p, 1.0 + silver * 0.22, silver * 0.12, silver * 0.12);
    p = fe_mix(dense, gray, silver * 0.42);
  }
  return p;
}

vec3 fe_print(vec3 c) {
  vec3 p = fe_curve(c, clamp(pr_contrast, 0.25, 2.8), pr_toe, pr_shoulder);
  float y = fe_luma(p);
  float shadow = 1.0 - fe_smooth(0.03, 0.28, y);
  float highlight = fe_smooth(0.30, 1.20, y);
  p.r += highlight * pr_warmHighlights * 0.55 - shadow * pr_coolShadows * 0.014;
  p.g += highlight * pr_warmHighlights * 0.12 + shadow * pr_coolShadows * 0.004;
  p.b -= highlight * pr_warmHighlights * 0.18 - shadow * pr_coolShadows * 0.036;
  float blackDensity = fe_clamp01(pr_blackDensity + max(0.0, c_density) * 0.05);
  p *= 1.0 - shadow * blackDensity * 0.10;
  p = fe_sat(p, pr_saturation);
  if (pr_silver > 0.0001) p = fe_mix(p, fe_sat(p, 0.0), pr_silver * 0.34);
  return p;
}

/** Correctly rounded floor(v / d) of the core (one exact Newton step). */
float fe_floorDiv(float v, float d) {
  float q = v / d;
  float p; float pe;
  fe_twoProd(q, d, p, pe);
  q = fe_add(q, fe_sub(fe_sub(v, p), pe) / d);
  return floor(q);
}
/** floor(n / d) for integer-valued n and small integer d, robust to division error. */
float fe_floorDivInt(float n, float d) { return floor((n + 0.5) / d); }

/** FilmEmulationCore::grainValue; fx/fy = floor(x|y / grain scale). */
float fe_grainValue(float x, float y, float fx, float fy, float channel) {
  float frame = float(u_frame);
  float n = fe_hash(fe_add(fx, channel * 19.0), fe_add(fy, fe_mul(frame, ${g(1.73)})), fe_add(11.0, fe_mul(channel, ${g(3.1)})));
  n = fe_add(n, fe_hash(fe_add(fe_mul(fx, ${g(2.1)}), fe_mul(frame, ${g(0.37)})), fe_add(fe_mul(fy, ${g(2.1)}), channel * 5.0), 23.0) * 0.5);
  n = n / 1.5;
  float centered = fe_sub(n * 2.0, 1.0);
  if (c_grainMode == 1) {
    float fine = fe_hash(fe_add(x, frame * 5.0), y, 91.0 + channel);
    centered = fe_add(fe_mul(centered, ${g(0.55)}), fe_mul(fe_sub(fine * 2.0, 1.0), ${g(0.45)}));
  } else if (c_grainMode == 2) {
    centered = centered > 0.0 ? fe_safePow(centered, 0.72) : -fe_safePow(-centered, 0.72);
  } else if (c_grainMode == 3) {
    float mono = fe_hash(fe_add(fx, fe_mul(frame, ${g(1.21)})), fy, 55.0);
    centered = fe_sub(mono * 2.0, 1.0);
  }
  return clamp(centered, -1.0, 1.0);
}

const vec2 FE_OPTICAL_OFFSETS[8] = vec2[8](
  vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0),
  vec2(-0.707, -0.707), vec2(0.707, -0.707), vec2(-0.707, 0.707), vec2(0.707, 0.707)
);

vec3 fe_optical(vec2 sp, vec3 center) {
  if (fe_haloAmount <= 0.0001 && fe_bloomAmount <= 0.0001) return vec3(0.0);
  float centerY = fe_luma(center);
  vec3 glow = vec3(0.0);
  float haloSum = 0.0;
  float bloomSum = 0.0;
  float red = 0.72 + c_halationRedShift * 0.78;
  float blue = 0.30 - c_halationRedShift * 0.18;
  for (int i = 0; i < 8; ++i) {
    vec3 s = fe_decode(fe_sample(sp + FE_OPTICAL_OFFSETS[i] * fe_opticalRadius).rgb);
    float sy = fe_luma(s);
    float highlight = fe_smooth(0.54, 2.4, sy);
    float edgeEnergy = fe_smooth(0.04, 0.48, sy - centerY) * fe_clamp01(c_halationLocal) + fe_smooth(0.82, 3.2, sy) * fe_clamp01(c_halationGlobal);
    float halo = highlight * edgeEnergy;
    float bloom = fe_smooth(max(0.05, c_bloomThreshold), 3.0, sy);
    glow += s * vec3(halo * red + bloom * 0.64, halo * 0.42 + bloom * 0.58, halo * blue + bloom * 0.52);
    haloSum += halo;
    bloomSum += bloom;
  }
  glow *= 1.0 / 8.0;
  float haloScale = fe_haloAmount * fe_clamp01(haloSum * (1.0 / 8.0) * 1.6);
  float bloomScale = fe_bloomAmount * fe_clamp01(bloomSum * (1.0 / 8.0) * 1.3);
  return glow * vec3(haloScale + bloomScale, haloScale * 0.70 + bloomScale, haloScale * 0.40 + bloomScale);
}

float fe_toneGrainMask(float value) {
  float shadowMask = 1.0 - fe_smooth(0.08, 0.34, value);
  float highMask = fe_smooth(0.48, 1.45, value);
  float midMask = fe_clamp01(1.0 - shadowMask * 0.85 - highMask * 0.65);
  return fe_grainProfileBias * (shadowMask * fe_clamp01(c_grainShadows) + midMask * fe_clamp01(c_grainMidtones) + highMask * fe_clamp01(c_grainHighlights));
}

/** sourceLooksLikeBlankAdjustment() of the OFX glue (7x7 grid, raw values). */
bool fe_blankAdjustment() {
  ivec2 size = ivec2(u_size);
  float maxRgb = 0.0;
  float alphaSum = 0.0;
  for (int gy = 0; gy < 7; ++gy) {
    for (int gx = 0; gx < 7; ++gx) {
      vec4 p = texelFetch(u_src, ivec2((size.x - 1) * gx / 6, (size.y - 1) * gy / 6), 0);
      maxRgb = max(maxRgb, max(p.r, max(p.g, p.b)));
      alphaSum += p.a;
    }
  }
  return alphaSum / 49.0 > 0.75 && maxRgb < 0.015;
}

void main() {
  ivec2 ip = ivec2(bw_pixel());
  if (c_adjustmentLayerGuard && fe_blankAdjustment()) {
    fragColor = vec4(0.0);
    return;
  }
  float x = float(ip.x);
  float y = float(ip.y);
  vec2 sp = vec2(x + fe_weave.x, y + fe_weave.y);
  vec4 dry = bw_fetch(u_src, ip);
  vec4 src = fe_sample(sp);
  vec3 scene = clamp(fe_decode(src.rgb), 0.0, 64.0);
  // Temporal reconstruction needs neighbouring frames: identity here.
  vec3 preTemporal = scene;
  float skin = fe_skinMask(scene) * fe_clamp01(c_skinProtect);
  scene *= fe_exposureGain;

  vec3 worked = scene;
  if (fe_colorStage) {
    worked = fe_developer(worked, skin);
    worked = fe_stock(worked, skin);
    worked = fe_compression(worked);
  }
  vec3 optics = fe_textureStage ? fe_optical(sp, scene) : vec3(0.0);
  worked += optics;
  if (fe_colorStage) {
    worked = fe_printerLights(worked);
    worked = fe_print(worked);
    worked = fe_expand(worked);
    float roll = fe_clamp01(c_highlightRolloff) * 1.35;
    if (roll > 0.0001) worked = worked / (vec3(1.0) + worked * roll * 0.22);
    float lift = c_blackLift * 0.035;
    if (abs(lift) > 0.0001) worked += vec3(lift * (1.0 - fe_smooth(0.03, 0.24, fe_luma(worked))));
  }

  float yScene = fe_luma(worked);
  float grainMask = fe_toneGrainMask(yScene) * (0.55 + 0.45 * fe_smooth(0.01, 0.12, yScene));
  bool needGrain = (fe_textureStage && fe_grainAmount > 0.0001) || c_viewMode == 1;
  float gfx = 0.0;
  float gfy = 0.0;
  if (needGrain) {
    gfx = fe_floorDiv(x, fe_grainScale);
    gfy = fe_floorDiv(y, fe_grainScale);
  }
  if (fe_textureStage && fe_grainAmount > 0.0001) {
    float resolutionBlur = 1.0 + (1.0 - fe_clamp01(c_filmResolution)) * 0.32;
    float base = fe_grainAmount * grainMask * 0.042 * resolutionBlur;
    float mono = fe_grainValue(x, y, gfx, gfy, 0.0);
    float gr = fe_grainValue(x, y, gfx, gfy, 1.0);
    float gg = fe_grainValue(x, y, gfx, gfy, 2.0);
    float gb = fe_grainValue(x, y, gfx, gfy, 3.0);
    float chroma = fe_clamp01(c_grainChroma);
    worked.r += base * (mono * (1.0 - chroma * 0.52) + gr * chroma * 0.52);
    worked.g += base * (mono * (1.0 - chroma * 0.38) + gg * chroma * 0.38);
    worked.b += base * (mono * (1.0 - chroma * 0.58) + gb * chroma * 0.58);
  }

  float frameSeed = float(u_frame);
  float dust = fe_clamp01(c_dust);
  if (fe_textureStage && dust > 0.0001) {
    float staticDust = fe_hash(fe_floorDivInt(x, 3.0), fe_floorDivInt(y, 3.0), 37.0);
    float movingDust = fe_hash(fe_floorDivInt(x, 6.0), frameSeed + fe_floorDivInt(y, 19.0), 81.0);
    float whiteSpeck = fe_smooth(0.9975 - dust * 0.006, 1.0, staticDust) * 0.16 * dust;
    float blackSpeck = fe_smooth(0.9970 - dust * 0.006, 1.0, movingDust) * 0.11 * dust;
    worked = worked * (1.0 - blackSpeck) + vec3(whiteSpeck);
  }
  float scratches = fe_clamp01(c_scratches);
  if (fe_textureStage && scratches > 0.0001) {
    float column = fe_hash(fe_floorDivInt(x, 2.0), fe_floorDivInt(frameSeed, 3.0), 301.0);
    float streak = fe_smooth(0.9980 - scratches * 0.006, 1.0, column);
    float broken = fe_hash(fe_floorDivInt(y, 11.0), frameSeed, 307.0);
    float line = streak * fe_smooth(0.18, 0.92, broken) * scratches * 0.18;
    worked += vec3(line, line * 0.92, line * 0.76);
  }

  if (c_viewMode == 1) {
    float gv = 0.5 + fe_grainValue(x, y, gfx, gfy, 0.0) * 0.5;
    fragColor = vec4(vec3(gv), dry.a);
    return;
  }
  if (c_viewMode == 2) {
    float oy = fe_clamp01(fe_luma(optics) * 5.0);
    fragColor = vec4(oy, oy * 0.35, oy * 0.12, dry.a);
    return;
  }
  if (c_viewMode == 3) {
    float dy = fe_clamp01(fe_luma(worked) / max(0.0001, fe_luma(scene) + 0.02));
    fragColor = vec4(vec3(dy), dry.a);
    return;
  }
  if (c_viewMode == 4) {
    vec3 d = abs(scene - preTemporal);
    float ty = fe_clamp01((d.r + d.g + d.b) * 2.4);
    fragColor = vec4(ty, ty * 0.72, 1.0 - ty, dry.a);
    return;
  }

  vec3 clamped = clamp(worked, 0.0, 64.0);
  vec3 encoded = vec3(fe_encode1(clamped.r), fe_encode1(clamped.g), fe_encode1(clamped.b));
  fragColor = vec4(fe_mix(dry.rgb, encoded, fe_clamp01(c_outputMix)), dry.a);
}
`;

export function filmEmulationUniforms(state: PreparedFilm): FxUniforms {
  const c = state.controls;
  const uniforms: FxUniforms = { fe_zeroBits: 0 };
  for (const field of FILM_STOCK_FIELDS) uniforms[`st_${field}`] = state.stock[field];
  for (const field of FILM_PRINT_FIELDS) uniforms[`pr_${field}`] = state.print[field];
  Object.assign(uniforms, {
    c_inputSpace: c.inputSpace,
    c_viewMode: c.viewMode,
    c_grainMode: c.grainMode,
    c_adjustmentLayerGuard: c.adjustmentLayerGuard,
    c_density: c.density,
    c_contrast: c.contrast,
    c_developerContrast: c.developerContrast,
    c_developerGamma: c.developerGamma,
    c_colorSeparation: c.colorSeparation,
    c_colorBoost: c.colorBoost,
    c_saturation: c.saturation,
    c_temperature: c.temperature,
    c_tint: c.tint,
    c_subtractiveColor: c.subtractiveColor,
    c_interlayer: c.interlayer,
    c_neutralizeCurves: c.neutralizeCurves,
    c_bleachBypass: c.bleachBypass,
    c_filmCompression: c.filmCompression,
    c_compressionWhitePoint: c.compressionWhitePoint,
    c_compressionRange: c.compressionRange,
    c_compressionColorDensity: c.compressionColorDensity,
    c_expandBlackPoint: c.expandBlackPoint,
    c_expandWhitePoint: c.expandWhitePoint,
    c_printerCyan: c.printerCyan,
    c_printerMagenta: c.printerMagenta,
    c_printerYellow: c.printerYellow,
    c_highlightRolloff: c.highlightRolloff,
    c_blackLift: c.blackLift,
    c_halationLocal: c.halationLocal,
    c_halationGlobal: c.halationGlobal,
    c_halationRedShift: c.halationRedShift,
    c_bloomThreshold: c.bloomThreshold,
    c_grainShadows: c.grainShadows,
    c_grainMidtones: c.grainMidtones,
    c_grainHighlights: c.grainHighlights,
    c_grainChroma: c.grainChroma,
    c_filmResolution: c.filmResolution,
    c_dust: c.dust,
    c_scratches: c.scratches,
    c_skinProtect: c.skinProtect,
    c_outputMix: c.outputMix,
    fe_weave: [state.weaveX, state.weaveY],
    fe_exposureGain: state.exposureGain,
    fe_grainAmount: state.grainAmount,
    fe_colorStage: state.colorStage,
    fe_textureStage: state.textureStage,
    fe_haloAmount: state.haloAmount,
    fe_bloomAmount: state.bloomAmount,
    fe_opticalRadius: state.opticalRadius,
    fe_grainScale: state.grainScale,
    fe_grainProfileBias: state.grainProfileBias,
  });
  return uniforms;
}
