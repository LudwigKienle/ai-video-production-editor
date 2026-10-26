import { FX_GLSL_HASH } from '../../glsl.ts';
import type { FxUniforms } from '../../types.ts';
import type { PreparedDeband } from './model.ts';

/**
 * GLSL ES 3.00 port of `DebandCore::analyzePixel()` + `processPixel()`
 * (Buckswood Post Plugins Deband v1.0). Statement order and constants follow the C++ core
 * so CPU, OFX and WebGL agree. Sampling is integer + clamp-to-edge like the
 * OFX `ImageSampler`. The multi-scale search is a fixed 3 scales x 4
 * directions loop; the radii are uniforms, not loop bounds.
 *
 * Note: RGBA16F render targets round the result to half precision (~5e-4 at
 * mid grey), which can swallow part of the sub-code-value dither. The 8-bit
 * display path and RGBA32F readbacks are unaffected by the math itself.
 */
export const DEBAND_FRAGMENT = /* glsl */ `
${FX_GLSL_HASH}
uniform int c_workingSpace;
uniform float c_strength;
uniform float c_detection;
uniform float c_edgeProtection;
uniform float c_textureProtection;
uniform float c_chromaRepair;
uniform float c_dither;
uniform int c_ditherMotion;
uniform float c_seed;
uniform int c_viewMode;
uniform float c_outputMix;

uniform int s_radiusSmall;
uniform int s_radiusMedium;
uniform int s_radiusLarge;
uniform float s_threshold;
uniform float s_noiseFloor;
uniform float s_codeStep;

const ivec2 DB_DIRECTIONS[4] = ivec2[4](ivec2(1, 0), ivec2(0, 1), ivec2(1, 1), ivec2(1, -1));

float db_smoothstep(float e0, float e1, float v) {
  float t = clamp((v - e0) / max(0.0000001, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Accurate log1p (GLSL has none): log(u) * x / (u - 1) cancels the rounding of 1 + x.
float db_log1p(float x) {
  float u = 1.0 + x;
  return u == 1.0 ? x : log(u) * (x / (u - 1.0));
}

float db_linearLuma(vec4 p) {
  return 0.2627 * p.r + 0.6780 * p.g + 0.0593 * p.b;
}

float db_perceptualLuma(vec4 p) {
  float value = db_linearLuma(p);
  if (c_workingSpace != 3) {
    return value;
  }
  float sgn = value < 0.0 ? -1.0 : 1.0;
  return sgn * db_log1p(abs(value) * 16.0) / db_log1p(16.0);
}

vec4 db_mix(vec4 a, vec4 b, float amount) {
  float t = clamp(amount, 0.0, 1.0);
  return a * (1.0 - t) + b * t;
}

vec4 db_sanitize(vec4 p, vec4 fallback) {
  return vec4(bw_sanitize(p.rgb, fallback.rgb), fallback.a);
}

vec4 S(ivec2 p) { return bw_fetch(u_src, p); }

float db_blueNoise(int x, int y, int frame, float seed) {
  float center = bw_hashNoise(x, y, frame, seed);
  float neighborhood = 0.25 * (
    bw_hashNoise(x - 1, y, frame, seed) +
    bw_hashNoise(x + 1, y, frame, seed) +
    bw_hashNoise(x, y - 1, frame, seed) +
    bw_hashNoise(x, y + 1, frame, seed));
  return clamp((center - neighborhood) * 0.70, -1.0, 1.0);
}

vec4 db_heatMap(float value, float alpha) {
  float v = clamp(value, 0.0, 1.0);
  return vec4(
    db_smoothstep(0.20, 0.75, v),
    db_smoothstep(0.02, 0.45, v) * (1.0 - db_smoothstep(0.75, 1.0, v)),
    0.08 * (1.0 - v),
    alpha);
}

// Returns repaired pixel; writes bandingMask and protectedDetail.
vec4 db_analyze(ivec2 p, vec4 dry, out float bandingMask, out float protectedDetail) {
  bandingMask = 0.0;
  protectedDetail = 0.0;
  if (c_strength <= 0.000001) {
    return dry;
  }

  float centerY = db_perceptualLuma(dry);
  float leftY = db_perceptualLuma(S(p + ivec2(-1, 0)));
  float rightY = db_perceptualLuma(S(p + ivec2(1, 0)));
  float upY = db_perceptualLuma(S(p + ivec2(0, -1)));
  float downY = db_perceptualLuma(S(p + ivec2(0, 1)));

  float gradientX = abs(rightY - leftY) * 0.5;
  float gradientY = abs(downY - upY) * 0.5;
  float edgeMagnitude = sqrt(gradientX * gradientX + gradientY * gradientY);
  float localRoughness = 0.25 * (
    abs(leftY - centerY) + abs(rightY - centerY) + abs(upY - centerY) + abs(downY - centerY));

  float threshold = s_threshold;
  float noiseFloor = s_noiseFloor;
  vec4 candidate = vec4(0.0);
  float candidateWeight = 0.0;
  float contourEvidence = 0.0;
  float farSpan = 0.0;
  for (int scale = 0; scale < 3; ++scale) {
    int radius = scale == 0 ? s_radiusSmall : (scale == 1 ? s_radiusMedium : s_radiusLarge);
    float scaleWeight = scale == 0 ? 0.75 : (scale == 1 ? 1.0 : 0.85);
    for (int d = 0; d < 4; ++d) {
      ivec2 offset = DB_DIRECTIONS[d] * radius;
      vec4 negative = S(p - offset);
      vec4 positive = S(p + offset);
      float negativeY = db_perceptualLuma(negative);
      float positiveY = db_perceptualLuma(positive);
      float pairRange = max(abs(negativeY - centerY), abs(positiveY - centerY));
      float pairSpan = abs(positiveY - negativeY);
      float residual = abs(0.5 * (negativeY + positiveY) - centerY);
      float rangeWeight = 1.0 - db_smoothstep(threshold * 1.4, threshold * 4.5, pairRange);
      float residualWeight = 0.20 + 0.80 * db_smoothstep(noiseFloor * 0.20, threshold * 0.85, residual);
      float weight = scaleWeight * rangeWeight * residualWeight;
      if (weight > 0.000001) {
        candidate += 0.5 * (negative + positive) * weight;
        candidateWeight += weight;
      }
      float transition = db_smoothstep(noiseFloor * 0.35, threshold * 1.8, pairSpan);
      float terrace = db_smoothstep(noiseFloor * 0.20, threshold * 0.80, residual);
      contourEvidence = max(contourEvidence, transition * (0.30 + 0.70 * terrace) * rangeWeight);
      farSpan = max(farSpan, pairSpan * rangeWeight);
    }
  }

  if (candidateWeight <= 0.000001) {
    protectedDetail = 1.0;
    return dry;
  }
  candidate *= 1.0 / candidateWeight;
  candidate.a = dry.a;

  float reconstructionResidual = abs(db_perceptualLuma(candidate) - centerY);
  float residualScore = db_smoothstep(noiseFloor * 0.15, threshold * 0.70, reconstructionResidual);
  float strongTransitionGuard = 1.0 - db_smoothstep(threshold * 1.4, threshold * 4.0, reconstructionResidual);

  float edgeStart = threshold * (2.50 - 1.70 * c_edgeProtection);
  float edgeGuard = 1.0 - db_smoothstep(edgeStart, edgeStart * 3.5, edgeMagnitude);
  float textureStart = threshold * (1.55 - 1.20 * c_textureProtection);
  float textureGuard = 1.0 - db_smoothstep(textureStart, textureStart * 3.25, localRoughness);
  float intentionalFlatGuard = db_smoothstep(noiseFloor * 0.30, threshold * 0.90, farSpan);

  float detectorGain = 0.45 + 1.55 * c_detection;
  bandingMask = clamp(
    detectorGain * (0.55 * residualScore + 0.45 * contourEvidence) *
    strongTransitionGuard * edgeGuard * textureGuard * intentionalFlatGuard, 0.0, 1.0);
  protectedDetail = clamp(1.0 - edgeGuard * textureGuard, 0.0, 1.0);

  float lumaDelta = db_linearLuma(candidate) - db_linearLuma(dry);
  vec4 lumaOnly = vec4(dry.rgb + lumaDelta, dry.a);
  vec4 repaired = db_mix(lumaOnly, candidate, c_chromaRepair);
  repaired = db_mix(dry, repaired, c_strength * bandingMask);

  float ditherMask = clamp(
    intentionalFlatGuard * edgeGuard * textureGuard * (0.20 + 0.80 * max(bandingMask, contourEvidence)), 0.0, 1.0);
  if (c_dither > 0.000001 && ditherMask > 0.000001) {
    int noiseFrame = c_ditherMotion == 1 ? u_frame : 0;
    float delta = db_blueNoise(p.x, p.y, noiseFrame, c_seed) * s_codeStep * c_dither * ditherMask;
    repaired.rgb += delta;
  }
  repaired.a = dry.a;
  return db_sanitize(repaired, dry);
}

void main() {
  ivec2 p = ivec2(bw_pixel());
  vec4 dry = S(p);
  float bandingMask;
  float protectedDetail;
  vec4 repaired = db_analyze(p, dry, bandingMask, protectedDetail);
  vec4 result;
  if (c_viewMode == 1) {
    result = db_heatMap(bandingMask, dry.a);
  } else if (c_viewMode == 2) {
    result = vec4(0.05 + 0.10 * protectedDetail, 0.15 + 0.70 * protectedDetail, 0.20 + 0.80 * protectedDetail, dry.a);
  } else if (c_viewMode == 3) {
    result = vec4(0.5 + (repaired.rgb - dry.rgb) * 12.0, dry.a);
  } else {
    result = db_mix(dry, repaired, c_outputMix);
  }
  fragColor = db_sanitize(result, dry);
}
`;

export function debandUniforms(state: PreparedDeband): FxUniforms {
  const c = state.controls;
  return {
    c_workingSpace: c.workingSpace,
    c_strength: c.strength,
    c_detection: c.detection,
    c_edgeProtection: c.edgeProtection,
    c_textureProtection: c.textureProtection,
    c_chromaRepair: c.chromaRepair,
    c_dither: c.dither,
    c_ditherMotion: c.ditherMotion,
    c_seed: c.seed,
    c_viewMode: c.viewMode,
    c_outputMix: c.outputMix,
    s_radiusSmall: state.radiusSmall,
    s_radiusMedium: state.radiusMedium,
    s_radiusLarge: state.radiusLarge,
    s_threshold: state.threshold,
    s_noiseFloor: state.noiseFloor,
    s_codeStep: state.codeStep,
  };
}
