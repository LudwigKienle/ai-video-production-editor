/**
 * GLSL passes of the primary grade. Same math as cpu.ts (keep in sync).
 *
 *   grade   — white balance, offset, log wheels, lift/gamma/gain (+ lum mix),
 *             contrast/pivot, custom curves, saturation, hue, hue curves
 *   blurH   — horizontal gaussian of the graded image (copy when unused)
 *   blurV   — vertical gaussian
 *   compose — blur / sharpen, qualifier × window mask, key gain/offset,
 *             mix with the node input (u_orig)
 *   sizing  — pan / tilt / zoom / rotate / flip of the node output
 */
import { CURVE_LUT_SIZE, MAX_BLUR_TAPS, blurTaps, type PreparedGrade } from './model.ts';
import type { FxUniforms } from '../../types.ts';

const CURVE_FNS = /* glsl */ `
uniform sampler2D t_curves;

float pg_lut(int row, float x) {
  float c = clamp(x, 0.0, 1.0);
  float f = c * ${CURVE_LUT_SIZE - 1}.0;
  int i0 = int(floor(f));
  int i1 = min(i0 + 1, ${CURVE_LUT_SIZE - 1});
  float t = f - float(i0);
  float a = texelFetch(t_curves, ivec2(i0, row), 0).r;
  float b = texelFetch(t_curves, ivec2(i1, row), 0).r;
  return mix(a, b, t) + (x - c);
}

float pg_hueLut(int row, float h) {
  float f = fract(h) * ${CURVE_LUT_SIZE}.0;
  int i0 = int(floor(f));
  float t = f - float(i0);
  i0 = i0 - (i0 / ${CURVE_LUT_SIZE}) * ${CURVE_LUT_SIZE};
  int i1 = i0 + 1;
  if (i1 >= ${CURVE_LUT_SIZE}) i1 = 0;
  float a = texelFetch(t_curves, ivec2(i0, row), 0).r;
  float b = texelFetch(t_curves, ivec2(i1, row), 0).r;
  return mix(a, b, t);
}
`;

const GRADE_FRAGMENT = /* glsl */ `
uniform vec3 u_wb;
uniform vec3 u_offset;
uniform vec3 u_lift;
uniform vec3 u_gamma;
uniform vec3 u_gain;
uniform vec3 u_master; // liftY, gammaY, gainY
uniform float u_lumMix;
uniform bool u_logActive;
uniform vec3 u_logShadow;
uniform vec3 u_logMid;
uniform vec3 u_logHigh;
uniform vec2 u_logRange;
uniform float u_contrast;
uniform float u_pivot;
uniform float u_saturation;
uniform vec3 u_hue0;
uniform vec3 u_hue1;
uniform vec3 u_hue2;
uniform bool u_curvesActive;
uniform bool u_hueCurvesActive;
${CURVE_FNS}

float pg_lgg(float v, float L, float Gm, float G) {
  float o = L * (1.0 - v) + G * v;
  if (o > 0.0) o = pow(o, exp2(-2.0 * Gm));
  return o;
}

float pg_logWheel(float v, float s, float m, float h) {
  float ws = 1.0 - bw_smoothstep(u_logRange.x - 0.1, u_logRange.x + 0.1, v);
  float wh = bw_smoothstep(u_logRange.y - 0.1, u_logRange.y + 0.1, v);
  float wm = max(0.0, 1.0 - ws - wh);
  return v + 0.25 * (s * ws + m * wm + h * wh);
}

vec3 pg_rgb2hsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-6) {
    if (mx == c.r) h = (c.g - c.b) / d;
    else if (mx == c.g) h = 2.0 + (c.b - c.r) / d;
    else h = 4.0 + (c.r - c.g) / d;
    h = h / 6.0;
    if (h < 0.0) h += 1.0;
  }
  float s = mx > 1e-6 ? d / mx : 0.0;
  return vec3(h, s, mx);
}

vec3 pg_hsv2rgb(vec3 c) {
  float h = fract(c.x) * 6.0;
  float s = c.y;
  float v = c.z;
  float r = clamp(abs(h - 3.0) - 1.0, 0.0, 1.0);
  float g = clamp(2.0 - abs(h - 2.0), 0.0, 1.0);
  float b = clamp(2.0 - abs(h - 4.0), 0.0, 1.0);
  return v * mix(vec3(1.0), vec3(r, g, b), s);
}

void main() {
  vec2 p = bw_pixel();
  vec4 src = bw_fetch(u_src, ivec2(p));
  vec3 v = src.rgb * u_wb + u_offset;
  if (u_logActive) {
    v = vec3(
      pg_logWheel(v.r, u_logShadow.r, u_logMid.r, u_logHigh.r),
      pg_logWheel(v.g, u_logShadow.g, u_logMid.g, u_logHigh.g),
      pg_logWheel(v.b, u_logShadow.b, u_logMid.b, u_logHigh.b)
    );
  }
  vec3 ganged = vec3(
    pg_lgg(v.r, u_lift.r + u_master.x, u_gamma.r + u_master.y, u_gain.r * u_master.z),
    pg_lgg(v.g, u_lift.g + u_master.x, u_gamma.g + u_master.y, u_gain.g * u_master.z),
    pg_lgg(v.b, u_lift.b + u_master.x, u_gamma.b + u_master.y, u_gain.b * u_master.z)
  );
  vec3 split = vec3(
    pg_lgg(v.r, u_lift.r, u_gamma.r, u_gain.r),
    pg_lgg(v.g, u_lift.g, u_gamma.g, u_gain.g),
    pg_lgg(v.b, u_lift.b, u_gamma.b, u_gain.b)
  );
  float y = bw_luma709(split);
  split += pg_lgg(y, u_master.x, u_master.y, u_master.z) - y;
  v = mix(ganged, split, u_lumMix);
  v = (v - u_pivot) * u_contrast + u_pivot;
  if (u_curvesActive) {
    v = vec3(pg_lut(1, pg_lut(0, v.r)), pg_lut(2, pg_lut(0, v.g)), pg_lut(3, pg_lut(0, v.b)));
  }
  float l = bw_luma709(v);
  v = l + (v - l) * u_saturation;
  v = vec3(dot(u_hue0, v), dot(u_hue1, v), dot(u_hue2, v));
  if (u_hueCurvesActive) {
    vec3 hsv = pg_rgb2hsv(v);
    float shift = pg_hueLut(4, hsv.x) - 0.5;
    float satMul = pg_hueLut(5, hsv.x) * 2.0;
    float lumOff = pg_hueLut(6, hsv.x) - 0.5;
    float w = clamp(hsv.y, 0.0, 1.0);
    vec3 shifted = pg_hsv2rgb(vec3(hsv.x + shift, max(0.0, hsv.y * satMul), hsv.z));
    v = shifted + lumOff * w;
  }
  fragColor = vec4(bw_sanitize(v, src.rgb), src.a);
}
`;

const blurFragment = (axis: 'x' | 'y') => /* glsl */ `
uniform float u_sigma;
uniform int u_taps;
void main() {
  ivec2 p = ivec2(bw_pixel());
  vec4 c = bw_fetch(u_src, p);
  if (u_taps <= 0) { fragColor = c; return; }
  float inv = 1.0 / (2.0 * u_sigma * u_sigma);
  vec3 acc = c.rgb;
  float wsum = 1.0;
  for (int i = 1; i <= ${MAX_BLUR_TAPS}; i++) {
    if (i > u_taps) break;
    float w = exp(-float(i * i) * inv);
    ivec2 o = ivec2(${axis === 'x' ? 'i, 0' : '0, i'});
    acc += w * (bw_fetch(u_src, p + o).rgb + bw_fetch(u_src, p - o).rgb);
    wsum += 2.0 * w;
  }
  fragColor = vec4(acc / wsum, c.a);
}
`;

const COMPOSE_FRAGMENT = /* glsl */ `
uniform sampler2D u_pass_grade;
uniform int u_blurMode;
uniform float u_sharpen;
uniform bool u_qualEnabled;
uniform vec3 u_qualHue;  // centre deg, half width deg, softness deg
uniform vec3 u_qualSat;  // low, high, soft
uniform vec3 u_qualLum;  // low, high, soft
uniform vec3 u_qualUse;
uniform bool u_qualInvert;
uniform int u_winType;
uniform vec2 u_winCenter;
uniform vec2 u_winSize;
uniform float u_winRotation;
uniform float u_winSoftness;
uniform bool u_winInvert;
uniform float u_keyGain;
uniform float u_keyOffset;
uniform bool u_keyInvert;
uniform bool u_showMask;

float pg_range(float v, float lo, float hi, float soft) {
  return bw_smoothstep(lo - soft, lo, v) * (1.0 - bw_smoothstep(hi, hi + soft, v));
}

float pg_qualifier(vec3 c) {
  vec3 q = clamp(c, 0.0, 1.0);
  float mx = max(q.r, max(q.g, q.b));
  float mn = min(q.r, min(q.g, q.b));
  float l = 0.5 * (mx + mn);
  float d = mx - mn;
  float s = d > 1e-6 ? d / max(1e-6, 1.0 - abs(2.0 * l - 1.0)) : 0.0;
  s = clamp(s, 0.0, 1.0);
  float h = 0.0;
  if (d > 1e-6) {
    if (mx == q.r) h = (q.g - q.b) / d;
    else if (mx == q.g) h = 2.0 + (q.b - q.r) / d;
    else h = 4.0 + (q.r - q.g) / d;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  float dist = abs(h - u_qualHue.x);
  dist = mod(dist, 360.0);
  dist = min(dist, 360.0 - dist);
  float mh = 1.0 - bw_smoothstep(u_qualHue.y, u_qualHue.y + u_qualHue.z, dist);
  float ms = pg_range(s, u_qualSat.x, u_qualSat.y, u_qualSat.z);
  float ml = pg_range(l, u_qualLum.x, u_qualLum.y, u_qualLum.z);
  float m = mix(1.0, mh, u_qualUse.x) * mix(1.0, ms, u_qualUse.y) * mix(1.0, ml, u_qualUse.z);
  return u_qualInvert ? 1.0 - m : m;
}

float pg_window(vec2 p) {
  float u = (p.x + 0.5) / u_size.x;
  float vTop = 1.0 - (p.y + 0.5) / u_size.y;
  float dx = (u - u_winCenter.x) * (u_size.x / u_size.y);
  float dy = vTop - u_winCenter.y;
  float cr = cos(u_winRotation);
  float sr = sin(u_winRotation);
  float x = dx * cr + dy * sr;
  float y = -dx * sr + dy * cr;
  float m;
  if (u_winType == 3) {
    float sw = max(0.0005, u_winSoftness * 0.5);
    m = 1.0 - bw_smoothstep(-sw, sw, y);
  } else {
    float d = u_winType == 1
      ? length(vec2(x / u_winSize.x, y / u_winSize.y))
      : max(abs(x) / u_winSize.x, abs(y) / u_winSize.y);
    float s = u_winSoftness * 0.5;
    m = 1.0 - bw_smoothstep(1.0 - s, 1.0 + s, d);
  }
  return u_winInvert ? 1.0 - m : m;
}

void main() {
  vec2 p = bw_pixel();
  ivec2 ip = ivec2(p);
  vec4 orig = bw_fetch(u_orig, ip);
  vec3 g = bw_fetch(u_pass_grade, ip).rgb;
  vec3 b = bw_fetch(u_src, ip).rgb;
  vec3 c = u_blurMode == 1 ? b : (u_blurMode == 2 ? g + (g - b) * u_sharpen : g);
  float m = 1.0;
  if (u_qualEnabled) m *= pg_qualifier(orig.rgb);
  if (u_winType > 0) m *= pg_window(p);
  m = clamp(m * u_keyGain + u_keyOffset, 0.0, 1.0);
  if (u_keyInvert) m = 1.0 - m;
  if (u_showMask) { fragColor = vec4(vec3(m), orig.a); return; }
  fragColor = vec4(mix(orig.rgb, c, m), orig.a);
}
`;

const SIZING_FRAGMENT = /* glsl */ `
uniform bool u_sizingActive;
uniform vec2 u_pan;
uniform float u_zoom;
uniform float u_rotate;
uniform vec2 u_flip;
void main() {
  vec2 p = bw_pixel();
  if (!u_sizingActive) { fragColor = bw_fetch(u_src, ivec2(p)); return; }
  vec2 c = (u_size - 1.0) * 0.5;
  vec2 d = p - c - u_pan * u_size;
  float cr = cos(u_rotate);
  float sr = sin(u_rotate);
  vec2 q = vec2(d.x * cr + d.y * sr, -d.x * sr + d.y * cr) / u_zoom;
  if (u_flip.x > 0.5) q.x = -q.x;
  if (u_flip.y > 0.5) q.y = -q.y;
  q += c;
  if (q.x < -0.5 || q.y < -0.5 || q.x > u_size.x - 0.5 || q.y > u_size.y - 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  fragColor = bw_sample(u_src, q);
}
`;

export const PRIMARY_GRADE_FRAGMENTS = {
  grade: GRADE_FRAGMENT,
  blurH: blurFragment('x'),
  blurV: blurFragment('y'),
  compose: COMPOSE_FRAGMENT,
  sizing: SIZING_FRAGMENT,
};

export function gradeUniforms(s: PreparedGrade): FxUniforms {
  return {
    u_wb: s.wb,
    u_offset: s.offset,
    u_lift: s.lift,
    u_gamma: s.gamma,
    u_gain: s.gain,
    u_master: [s.liftY, s.gammaY, s.gainY],
    u_lumMix: s.lumMix,
    u_logActive: s.logActive,
    u_logShadow: s.logShadow,
    u_logMid: s.logMid,
    u_logHigh: s.logHigh,
    u_logRange: [s.logLow, s.logHighRange],
    u_contrast: s.contrast,
    u_pivot: s.pivot,
    u_saturation: s.saturation,
    u_hue0: s.hueRows[0],
    u_hue1: s.hueRows[1],
    u_hue2: s.hueRows[2],
    u_curvesActive: s.curvesActive,
    u_hueCurvesActive: s.hueCurvesActive,
  };
}

export function blurUniforms(s: PreparedGrade): FxUniforms {
  return { u_sigma: Math.max(1e-3, s.blurSigma), u_taps: s.blurMode === 0 ? 0 : blurTaps(s.blurSigma) };
}

export function composeUniforms(s: PreparedGrade): FxUniforms {
  return {
    u_blurMode: s.blurMode,
    u_sharpen: s.sharpen,
    u_qualEnabled: s.qualEnabled,
    u_qualHue: [s.qualHue, s.qualHueWidth, s.qualHueSoft],
    u_qualSat: [s.qualSatLow, s.qualSatHigh, s.qualSatSoft],
    u_qualLum: [s.qualLumLow, s.qualLumHigh, s.qualLumSoft],
    u_qualUse: s.qualUse,
    u_qualInvert: s.qualInvert,
    u_winType: s.winType,
    u_winCenter: s.winCenter,
    u_winSize: s.winSize,
    u_winRotation: s.winRotation,
    u_winSoftness: s.winSoftness,
    u_winInvert: s.winInvert,
    u_keyGain: s.keyGain,
    u_keyOffset: s.keyOffset,
    u_keyInvert: s.keyInvert,
    u_showMask: s.showMask,
  };
}

export function sizingUniforms(s: PreparedGrade): FxUniforms {
  return { u_sizingActive: s.sizingActive, u_pan: s.sizePan, u_zoom: s.sizeZoom, u_rotate: s.sizeRotate, u_flip: s.sizeFlip };
}
