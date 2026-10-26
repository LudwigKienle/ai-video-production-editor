import type { FxUniforms } from '../../types.ts';
import type { PreparedFake } from './model.ts';

/**
 * Pass 1 — adjustment-layer guard (OFX `sourceLooksLikeBlankAdjustment()`).
 *
 * The plugin inspects a 9x9 grid of the whole source frame before rendering
 * and outputs transparent black for an empty (near-black, opaque) adjustment
 * layer. That is a frame-global decision, so it runs as a reduction pass:
 * only texel (0, 0) evaluates the 81 grid samples, every other fragment exits
 * immediately; pass 2 reads the flag from texel (0, 0). Sampling positions
 * and thresholds are identical to the plugin, so this is exact (no
 * approximation).
 */
export const FAKE_GUARD_FRAGMENT = /* glsl */ `
uniform bool c_adjustmentLayerGuard;

void main() {
  ivec2 p = ivec2(bw_pixel());
  if (p.x != 0 || p.y != 0 || !c_adjustmentLayerGuard) {
    fragColor = vec4(0.0);
    return;
  }
  ivec2 size = ivec2(u_size);
  float maxRgb = 0.0;
  float alphaSum = 0.0;
  int samples = 0;
  bool content = false;
  for (int gy = 0; gy < 9; ++gy) {
    int y = (size.y - 1) * gy / 8;
    for (int gx = 0; gx < 9; ++gx) {
      int x = (size.x - 1) * gx / 8;
      vec4 c = texelFetch(u_orig, ivec2(x, y), 0);
      maxRgb = max(maxRgb, max(c.r, max(c.g, c.b)));
      alphaSum += c.a;
      samples += 1;
      if (maxRgb > 0.015) {
        content = true;
        break;
      }
    }
    if (content) {
      break;
    }
  }
  bool blank = !content && samples > 0 && alphaSum / float(samples) > 0.75 && maxRgb < 0.015;
  fragColor = vec4(blank ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}
`;

/**
 * Pass 2 — GLSL ES 3.00 port of `FakeDiagnosticCore::processPixel()` for the
 * single-frame path (no temporal context: temporal score and difference are 0,
 * temporal assist is skipped — identical to the plugin without neighbouring
 * frames). Reads the effect input from `u_orig` (u_src is the guard pass).
 * Sampling follows the OFX FloatSampler: nearest, transparent black outside.
 */
export const FAKE_DIAGNOSTIC_FRAGMENT = /* glsl */ `
uniform sampler2D u_pass_guard;

uniform int c_viewMode;
uniform float c_sensitivity;
uniform float c_overlayStrength;
uniform float c_correctionStrength;
uniform float c_plasticWeight;
uniform float c_highlightWeight;
uniform float c_edgeWeight;
uniform float c_gradeWeight;
uniform float c_textureWeight;
uniform float c_temporalWeight;
uniform float c_microContrast;
uniform float c_edgeSoften;
uniform float c_highlightRolloff;
uniform float c_gamutGuard;
uniform float c_sensorTexture;

uniform float s_weightSum;
uniform int s_noiseSeedBase;
uniform int s_noiseSeedAlt;

vec4 F(ivec2 p) {
  ivec2 size = ivec2(u_size);
  if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) {
    return vec4(0.0);
  }
  return texelFetch(u_orig, p, 0);
}

float fd_clamp01(float v) { return min(1.0, max(0.0, v)); }
vec4 fd_clampPixel(vec4 p) { return min(vec4(1.0), max(vec4(0.0), p)); }
float fd_luma(vec4 p) { return p.r * 0.2126 + p.g * 0.7152 + p.b * 0.0722; }

float fd_smoothstep(float e0, float e1, float x) {
  if (e0 == e1) {
    return x < e0 ? 0.0 : 1.0;
  }
  float t = fd_clamp01((x - e0) / (e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}

vec4 fd_mix(vec4 a, vec4 b, float t) {
  return a + (b - a) * fd_clamp01(t);
}

float fd_hash01(int x, int y, int z) {
  uint n = uint(x) * 15731u + uint(y) * 789221u + uint(z) * 1376312589u;
  n = (n << 13u) ^ n;
  uint hashed = (n * (n * n * 15731u + 789221u) + 1376312589u) & 0x7fffffffu;
  return float(hashed) / 2147483647.0;
}

// Scores: plastic, highlight, edge, grade, texture (temporal = 0).
vec4 fd_categoryColor(float plastic, float highlight, float edge, float grade, float texture_) {
  float sum = max(0.001, plastic + highlight + edge + grade + texture_ + 0.0);
  vec3 color = vec3(0.0);
  color += vec3(1.0, 0.0, 0.85) * (plastic / sum);
  color += vec3(1.0, 0.82, 0.05) * (highlight / sum);
  color += vec3(0.0, 0.85, 1.0) * (edge / sum);
  color += vec3(1.0, 0.08, 0.02) * (grade / sum);
  color += vec3(0.12, 0.32, 1.0) * (texture_ / sum);
  return vec4(color, 1.0);
}

float fd_roll(float v, float roll) {
  const float knee = 0.72;
  if (v <= knee) {
    return v;
  }
  float compressed = knee + (1.0 - exp(-(v - knee) * 3.2)) * 0.28;
  return v + (compressed - v) * roll;
}

vec4 fd_applyAssist(ivec2 p, vec4 input_, vec4 blur, float overall, float edge, float grade, float highlight, float texture_) {
  vec4 detail = input_ - blur;
  float correction = fd_clamp01(c_correctionStrength) * overall;
  vec4 outp = input_ + detail * (c_microContrast * correction);
  outp = fd_mix(outp, blur, c_edgeSoften * correction * edge);
  float yv = fd_luma(outp);
  outp = fd_mix(outp, vec4(yv, yv, yv, outp.a), c_gamutGuard * correction * grade * 0.45);
  float roll = c_highlightRolloff * correction * highlight;
  if (roll > 0.0) {
    outp.r = fd_roll(outp.r, roll);
    outp.g = fd_roll(outp.g, roll);
    outp.b = fd_roll(outp.b, roll);
  }
  float noiseBase = fd_hash01(p.x, p.y, s_noiseSeedBase) - 0.5;
  float noiseAlt = fd_hash01(p.x + 17, p.y - 11, s_noiseSeedAlt) - 0.5;
  float textureAmount = c_sensorTexture * correction * (0.35 + 0.65 * texture_) * 0.045;
  outp.r += noiseBase * textureAmount;
  outp.g += (noiseBase * 0.55 + noiseAlt * 0.45) * textureAmount;
  outp.b += noiseAlt * textureAmount;
  outp.a = input_.a;
  return fd_clampPixel(outp);
}

void main() {
  if (texelFetch(u_pass_guard, ivec2(0, 0), 0).r > 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  ivec2 p = ivec2(bw_pixel());
  vec4 c = F(p);
  vec4 l = F(p + ivec2(-1, 0));
  vec4 r = F(p + ivec2(1, 0));
  vec4 u = F(p + ivec2(0, -1));
  vec4 d = F(p + ivec2(0, 1));
  float cy = fd_luma(c);
  float ly = fd_luma(l);
  float ry = fd_luma(r);
  float uy = fd_luma(u);
  float dy = fd_luma(d);
  float d1y = fd_luma(F(p + ivec2(-1, -1)));
  float d2y = fd_luma(F(p + ivec2(1, -1)));
  float d3y = fd_luma(F(p + ivec2(-1, 1)));
  float d4y = fd_luma(F(p + ivec2(1, 1)));

  float detail = (abs(cy - ly) + abs(cy - ry) + abs(cy - uy) + abs(cy - dy) +
    abs(cy - d1y) + abs(cy - d2y) + abs(cy - d3y) + abs(cy - d4y)) * 0.125;
  float gx = ry - ly;
  float gy = dy - uy;
  float gradient = sqrt(gx * gx + gy * gy);
  float maxChannel = max(c.r, max(c.g, c.b));
  float minChannel = min(c.r, min(c.g, c.b));
  float saturation = (maxChannel - minChannel) / max(0.001, maxChannel);
  float midtoneMask = fd_smoothstep(0.06, 0.28, cy) * (1.0 - fd_smoothstep(0.78, 0.98, cy));
  float brightMask = fd_smoothstep(0.74, 1.0, cy);
  float clipped = max(fd_smoothstep(0.965, 1.02, c.r), max(fd_smoothstep(0.965, 1.02, c.g), fd_smoothstep(0.965, 1.02, c.b)));
  float localClean = 1.0 - fd_smoothstep(0.012, 0.085, detail);

  float plastic = fd_clamp01(localClean * midtoneMask * (0.45 + 0.55 * fd_smoothstep(0.06, 0.55, saturation)));
  float highlight = fd_clamp01(brightMask * (0.35 + 0.65 * clipped));
  float edge = fd_clamp01(fd_smoothstep(0.10, 0.42, gradient) * (0.35 + 0.65 * localClean));
  float grade = fd_clamp01(max(fd_smoothstep(0.68, 1.0, saturation), fd_smoothstep(0.92, 1.06, maxChannel)));
  float texture_ = fd_clamp01(localClean * (1.0 - fd_smoothstep(0.12, 0.38, gradient)) * midtoneMask);
  float temporal = 0.0;
  float overall = fd_clamp01(c_sensitivity * (
    plastic * c_plasticWeight + highlight * c_highlightWeight + edge * c_edgeWeight +
    grade * c_gradeWeight + texture_ * c_textureWeight + temporal * c_temporalWeight) / s_weightSum);

  vec4 blur = ((((c + l) + r) + u) + d) * 0.2;
  vec4 category = fd_categoryColor(plastic, highlight, edge, grade, texture_);

  if (c_viewMode == 1) {
    fragColor = vec4(overall, overall, overall, c.a);
    return;
  }
  if (c_viewMode == 4) {
    float level = max(0.18, overall);
    fragColor = vec4(category.rgb * level, c.a);
    return;
  }
  if (c_viewMode == 5) {
    fragColor = vec4(temporal, temporal, temporal, c.a);
    return;
  }
  if (c_viewMode == 6) {
    float diff = 0.0;
    vec4 diffColor = vec4(0.0, fd_clamp01(diff * 4.0), fd_clamp01(1.0 - diff * 5.0), c.a);
    vec4 color = fd_mix(diffColor, vec4(0.0, 1.0, 0.22, c.a), temporal);
    fragColor = fd_clampPixel(fd_mix(c, color, c_overlayStrength * max(diff, temporal)));
    return;
  }
  if (c_viewMode == 2) {
    fragColor = fd_applyAssist(p, c, blur, overall, edge, grade, highlight, texture_);
    return;
  }
  vec4 base = c;
  if (c_viewMode == 3) {
    base = fd_applyAssist(p, c, blur, overall, edge, grade, highlight, texture_);
  }
  vec4 overlay = fd_mix(base, category, c_overlayStrength * overall);
  fragColor = fd_clampPixel(vec4(overlay.rgb, c.a));
}
`;

export function fakeGuardUniforms(state: PreparedFake): FxUniforms {
  return { c_adjustmentLayerGuard: state.controls.adjustmentLayerGuard };
}

export function fakeDiagnosticUniforms(state: PreparedFake): FxUniforms {
  const c = state.controls;
  return {
    c_viewMode: c.viewMode,
    c_sensitivity: c.sensitivity,
    c_overlayStrength: c.overlayStrength,
    c_correctionStrength: c.correctionStrength,
    c_plasticWeight: c.plasticWeight,
    c_highlightWeight: c.highlightWeight,
    c_edgeWeight: c.edgeWeight,
    c_gradeWeight: c.gradeWeight,
    c_textureWeight: c.textureWeight,
    c_temporalWeight: c.temporalWeight,
    c_microContrast: c.microContrast,
    c_edgeSoften: c.edgeSoften,
    c_highlightRolloff: c.highlightRolloff,
    c_gamutGuard: c.gamutGuard,
    c_sensorTexture: c.sensorTexture,
    s_weightSum: state.weightSum,
    s_noiseSeedBase: state.noiseSeedBase,
    s_noiseSeedAlt: state.noiseSeedAlt,
  };
}
