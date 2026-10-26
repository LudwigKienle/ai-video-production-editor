import type { FxUniforms } from '../../types.ts';
import { ADJUSTMENT_GUARD_GLSL } from '../postPluginsCommon/adjustmentGuard.ts';
import { LENS_MODEL_FIELDS, type PreparedLensPhysics } from './model.ts';

/**
 * GLSL ES 3.00 port of `LensPhysicsCore::processPixel` / `applyRadialLens`
 * (LensPhysicsCore.h, v0.5). Statement order and constants follow the C++
 * core (the embedded Metal kernel in LensPhysicsMetal.mm is the same math).
 *
 * Sampling uses `lp_sample`, a copy of the OFX FloatSampler: bilinear with
 * truncating int conversion and *transparent black outside the frame* —
 * unlike the engine's clamped `bw_sample`. Kept on purpose for parity with
 * Resolve (it is what produces the black corners at strong distortion).
 */
export const LENS_PHYSICS_FRAGMENT = /* glsl */ `
${LENS_MODEL_FIELDS.map((field) => `uniform float m_${field};`).join('\n')}

uniform float c_bloomThreshold;
uniform float c_edgeHaloGuard;
uniform bool c_adjustmentLayerGuard;

uniform float s_rawOverdrive;
uniform float s_baseOverdrive;
uniform vec2 s_center;
uniform float s_aspect;

${ADJUSTMENT_GUARD_GLSL}

const vec2 BLOOM_OFFSETS[8] = vec2[8](
  vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.707, 0.707), vec2(-0.707, 0.707), vec2(0.707, -0.707), vec2(-0.707, -0.707)
);

vec4 lp_sample(float x, float y) {
  vec2 maxP = u_size - 1.0;
  if (!(x >= 0.0 && x <= maxP.x && y >= 0.0 && y <= maxP.y)) return vec4(0.0);
  ivec2 lim = ivec2(u_size) - 1;
  int x0 = int(x);
  int y0 = int(y);
  int x1 = min(lim.x, x0 + 1);
  int y1 = min(lim.y, y0 + 1);
  float tx = x - float(x0);
  float ty = y - float(y0);
  vec4 p00 = texelFetch(u_src, ivec2(x0, y0), 0);
  vec4 p10 = texelFetch(u_src, ivec2(x1, y0), 0);
  vec4 p01 = texelFetch(u_src, ivec2(x0, y1), 0);
  vec4 p11 = texelFetch(u_src, ivec2(x1, y1), 0);
  float u = 1.0 - tx;
  float v = 1.0 - ty;
  return (p00 * u + p10 * tx) * v + (p01 * u + p11 * tx) * ty;
}

float lp_luma(vec4 p) { return 0.2627 * p.r + 0.6780 * p.g + 0.0593 * p.b; }

float lp_smoothstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / max(0.0001, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float lp_safeDiv(float a, float b) { return b == 0.0 ? 0.0 : a / b; }

vec4 lp_mix(vec4 a, vec4 b, float t) {
  float u = 1.0 - t;
  return a * u + b * t;
}

vec4 applyRadialLens(float srcX, float srcY, float dirX, float dirY, float tangentX, float tangentY, float radius, float overdrive) {
  float edge = lp_smoothstep(0.16, 1.10, radius);

  vec4 center = lp_sample(srcX, srcY);
  vec4 l = lp_sample(srcX - 1.0, srcY);
  vec4 r = lp_sample(srcX + 1.0, srcY);
  vec4 u = lp_sample(srcX, srcY - 1.0);
  vec4 d = lp_sample(srcX, srcY + 1.0);
  float gradient = abs(lp_luma(r) - lp_luma(l)) + abs(lp_luma(d) - lp_luma(u));
  float centerY = lp_luma(center);
  float silhouetteRisk = lp_smoothstep(0.20, 0.72, gradient) * (1.0 - lp_smoothstep(0.12, 0.46, centerY));
  float silhouetteGuard = 1.0 - silhouetteRisk * (0.72 + bw_clamp01(c_edgeHaloGuard) * 0.22);
  float od = max(0.0, overdrive);
  float caPx = m_chromaticAberration * od * edge * edge * 4.2 * silhouetteGuard;
  vec4 red = lp_sample(srcX + dirX * caPx, srcY + dirY * caPx);
  vec4 blue = lp_sample(srcX - dirX * caPx, srcY - dirY * caPx);
  vec4 rgb = vec4(red.r, center.g, blue.b, center.a);

  float fringe = bw_clamp01(m_fringing * od * edge * gradient * 1.32 * silhouetteGuard);
  rgb.r += fringe * (0.08 + 0.05 * edge);
  rgb.g -= fringe * 0.035;
  rgb.b += fringe * (0.04 + 0.04 * edge);

  float threshold = max(0.35, c_bloomThreshold);
  float bloomStrength = bw_clamp01(m_bloom * od);
  if (bloomStrength > 0.0001) {
    vec3 bloom = vec3(0.0);
    float weightSum = 0.0;
    float radiusPx = 2.0 + bloomStrength * 8.0;
    for (int i = 0; i < 8; ++i) {
      vec4 p = lp_sample(srcX + BLOOM_OFFSETS[i].x * radiusPx, srcY + BLOOM_OFFSETS[i].y * radiusPx);
      float hot = bw_clamp01((lp_luma(p) - threshold) / max(0.001, 1.0 - threshold));
      float w = hot * hot;
      bloom += p.rgb * w;
      weightSum += w;
    }
    if (weightSum > 0.0001) {
      bloom *= 1.0 / weightSum;
      float hotCenter = bw_clamp01((lp_luma(center) - threshold) / max(0.001, 1.0 - threshold));
      float amount = bloomStrength * (0.18 + 0.42 * hotCenter) * silhouetteGuard;
      rgb.rgb += bloom * amount;
    }
  }

  float comaStrength = bw_clamp01(m_coma * od) * edge * edge * silhouetteGuard;
  if (comaStrength > 0.0001) {
    vec3 comet = vec3(0.0);
    float weightSum = 0.0;
    for (int i = 1; i <= 5; ++i) {
      float fi = float(i);
      float spread = fi * (1.2 + comaStrength * 4.0);
      float tx = tangentX * spread + dirX * spread * 0.55;
      float ty = tangentY * spread + dirY * spread * 0.55;
      vec4 p = lp_sample(srcX + tx, srcY + ty);
      float hot = bw_clamp01((lp_luma(p) - 0.58) / 0.42);
      float w = hot * (1.0 / fi);
      comet += p.rgb * w;
      weightSum += w;
    }
    if (weightSum > 0.0001) {
      comet *= 1.0 / weightSum;
      rgb.r += comet.r * comaStrength * 0.34;
      rgb.g += comet.g * comaStrength * 0.24;
      rgb.b += comet.b * comaStrength * 0.18;
    }
  }
  return rgb;
}

void main() {
  if (c_adjustmentLayerGuard && bw_sourceLooksLikeBlankAdjustment(u_src)) {
    fragColor = vec4(0.0);
    return;
  }
  ivec2 ip = ivec2(bw_pixel());
  float x = float(ip.x);
  float y = float(ip.y);
  vec4 dry = lp_sample(x, y);
  float baseOd = s_baseOverdrive;
  float cx = s_center.x;
  float cy = s_center.y;
  float nx = lp_safeDiv(x - cx, cx);
  float ny = lp_safeDiv(y - cy, cy);
  float ax = nx * s_aspect;
  float radius = sqrt(ax * ax + ny * ny);
  float edge = lp_smoothstep(0.18, 1.18, radius);

  float dirX = nx;
  float dirY = ny;
  float dirLen = sqrt(dirX * dirX + dirY * dirY);
  if (dirLen > 0.0001) {
    dirX /= dirLen;
    dirY /= dirLen;
  }
  float tangentX = -dirY;
  float tangentY = dirX;

  float dryY = lp_luma(dry);
  float dryLeftY = lp_luma(lp_sample(x - 1.0, y));
  float dryRightY = lp_luma(lp_sample(x + 1.0, y));
  float dryUpY = lp_luma(lp_sample(x, y - 1.0));
  float dryDownY = lp_luma(lp_sample(x, y + 1.0));
  float neighborMinY = min(min(dryLeftY, dryRightY), min(dryUpY, dryDownY));
  float neighborMaxY = max(max(dryLeftY, dryRightY), max(dryUpY, dryDownY));
  float localSpan = max(neighborMaxY, dryY) - min(neighborMinY, dryY);
  float crossGradient =
    abs(dryRightY - dryLeftY) +
    abs(dryDownY - dryUpY) +
    abs(dryY - dryLeftY) * 0.5 +
    abs(dryY - dryRightY) * 0.5 +
    abs(dryY - dryUpY) * 0.5 +
    abs(dryY - dryDownY) * 0.5;
  float edgeRisk = lp_smoothstep(0.035, 0.26, localSpan + crossGradient * 0.26);
  float darkSilhouette = (1.0 - lp_smoothstep(0.10, 0.44, dryY)) * lp_smoothstep(0.10, 0.42, neighborMaxY - dryY);
  float brightSilhouette = lp_smoothstep(0.54, 0.90, dryY) * lp_smoothstep(0.10, 0.42, dryY - neighborMinY);
  float contourRisk = lp_smoothstep(0.065, 0.34, neighborMaxY - neighborMinY);
  float silhouetteRisk = bw_clamp01(edgeRisk * (0.34 + 0.46 * max(darkSilhouette, brightSilhouette) + 0.20 * contourRisk));
  float overdrivePressure = lp_smoothstep(0.18, 0.85, bw_clamp01(s_rawOverdrive));
  float edgeGuard = bw_clamp01(c_edgeHaloGuard) * silhouetteRisk * (0.42 + 0.58 * overdrivePressure);
  float opticalOd = baseOd * (1.0 - edgeGuard * (0.62 + 0.24 * overdrivePressure));
  float od = baseOd;

  float swirlAngle = m_swirl * od * edge * edge * 0.22;
  float cosA = cos(swirlAngle);
  float sinA = sin(swirlAngle);
  float sx = nx * cosA - ny * sinA;
  float sy = nx * sinA + ny * cosA;

  float r2 = radius * radius;
  float radialScale = 1.0 + m_distortion * od * r2 + m_distortion * od * 0.35 * r2 * r2;
  float srcX = cx + sx * radialScale * cx;
  float srcY = cy + sy * radialScale * cy;

  vec4 rgb = applyRadialLens(srcX, srcY, dirX, dirY, tangentX, tangentY, radius, opticalOd);

  float vignette = bw_clamp01(m_vignette * od) * edge * edge;
  float vignetteGain = 1.0 - vignette * 0.46;
  rgb.rgb *= vignetteGain;

  float corner = bw_clamp01(m_cornerColor * od) * edge * edge;
  rgb.r += corner * (m_warmBias + 0.025);
  rgb.g += corner * 0.006;
  rgb.b += corner * (m_blueBias - 0.018);

  if (m_sharpener != 0.0) {
    vec4 c = lp_sample(srcX, srcY);
    vec4 b1 = lp_sample(srcX - 1.4, srcY);
    vec4 b2 = lp_sample(srcX + 1.4, srcY);
    vec4 b3 = lp_sample(srcX, srcY - 1.4);
    vec4 b4 = lp_sample(srcX, srcY + 1.4);
    vec3 blur = (b1.rgb + b2.rgb + b3.rgb + b4.rgb) * 0.25;
    float sharp = m_sharpener * od * 0.32 * (1.0 - edgeGuard * 0.86);
    rgb.rgb += (c.rgb - blur) * sharp;
  }

  if (edgeGuard > 0.0001) {
    float maxDelta = 0.055 + (1.0 - edgeGuard) * 0.24 + localSpan * 0.18;
    vec4 deltaClamped = vec4(dry.rgb + clamp(rgb.rgb - dry.rgb, -maxDelta, maxDelta), dry.a);
    float minAllowedY = bw_clamp01(min(neighborMinY, dryY) - (0.025 + localSpan * 0.10));
    float maxAllowedY = bw_clamp01(max(neighborMaxY, dryY) + (0.025 + localSpan * 0.10));
    float clampedY = lp_luma(deltaClamped);
    if (clampedY < minAllowedY || clampedY > maxAllowedY) {
      float correction = clamp(clampedY, minAllowedY, maxAllowedY) - clampedY;
      deltaClamped.rgb += correction;
    }
    rgb = lp_mix(rgb, deltaClamped, edgeGuard);
    rgb = lp_mix(rgb, dry, edgeGuard * 0.22);
  }

  fragColor = vec4(clamp(rgb.rgb, 0.0, 1.0), dry.a);
}
`;

export function lensPhysicsUniforms(state: PreparedLensPhysics): FxUniforms {
  const uniforms: FxUniforms = {};
  for (const field of LENS_MODEL_FIELDS) uniforms[`m_${field}`] = state.model[field];
  Object.assign(uniforms, {
    c_bloomThreshold: state.controls.bloomThreshold,
    c_edgeHaloGuard: state.controls.edgeHaloGuard,
    c_adjustmentLayerGuard: state.controls.adjustmentLayerGuard,
    s_rawOverdrive: state.rawOverdrive,
    s_baseOverdrive: state.baseOverdrive,
    s_center: [state.centerX, state.centerY],
    s_aspect: state.aspect,
  });
  return uniforms;
}
