import { FX_GLSL_HASH } from '../../glsl.ts';
import type { FxUniforms } from '../../types.ts';
import { OPTICS_MODEL_FIELDS, type PreparedOptics } from './model.ts';

/**
 * GLSL port of `OpticsLabCore::processPixel` (v1.3.1, edge-fix). Statement
 * order and constants follow the C++ core so CPU, Metal and WebGL agree.
 */
export const OPTICS_LAB_FRAGMENT = /* glsl */ `
${FX_GLSL_HASH}
${OPTICS_MODEL_FIELDS.map((field) => `uniform float m_${field};`).join('\n')}
uniform int m_irisBlades;

uniform float c_outputMix;
uniform float c_edgeGuard;
uniform float c_bloomThreshold;
uniform float c_anamorphicSqueeze;
uniform float c_apertureInfluence;
uniform int c_depthSource;
uniform bool c_depthInvert;
uniform float c_depthNear;
uniform float c_depthFar;
uniform float c_depthGamma;
uniform float c_focusPlane;
uniform float c_focusOffset;
uniform float c_fStop;
uniform float c_dirtAmount;
uniform float c_dirtScale;
uniform float c_smudgeAmount;
uniform float c_smudgeScale;
uniform float c_grainSize;
uniform float c_grainSeed;

uniform vec2 s_center;
uniform float s_aspect;
uniform float s_amount;
uniform float s_apertureScale;
uniform float s_focalScale;
uniform float s_breathingScale;
uniform float s_anaCos;
uniform float s_anaSin;
uniform float s_isoGrainScale;
uniform int s_defocusSamples;
uniform int s_glowSamples;
uniform int s_comaSamples;
uniform int s_irisBlades;
uniform int s_maxStarSpokes;
uniform float s_irisRoundness;
uniform float s_irisRotation;
uniform float s_starUnevenness;
uniform float s_starGate;
uniform bool s_needsEdgeGuard;
uniform bool s_identityMapping;
uniform bool s_identityOutput;

uniform bool a_hasGlass;
uniform bool a_hasDirt;
uniform bool a_hasSmudge;
uniform sampler2D t_glass;
uniform sampler2D t_dirt;
uniform sampler2D t_smudge;

const float PI = 3.14159265358979323846;

const vec2 DEFOCUS_OFFSETS[12] = vec2[12](
  vec2(1.000, 0.000), vec2(-1.000, 0.000), vec2(0.000, 1.000), vec2(0.000, -1.000),
  vec2(0.707, 0.707), vec2(-0.707, 0.707), vec2(0.707, -0.707), vec2(-0.707, -0.707),
  vec2(0.383, 0.924), vec2(-0.383, 0.924), vec2(0.383, -0.924), vec2(-0.383, -0.924)
);
const vec2 GLOW_OFFSETS[8] = vec2[8](
  vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.707, 0.707), vec2(-0.707, 0.707), vec2(0.707, -0.707), vec2(-0.707, -0.707)
);

vec4 S(vec2 p) { return bw_sample(u_src, p); }
float L(vec4 p) { return bw_luma2020(p.rgb); }

float proceduralIris(float x, float y, int blades, float roundness, float rotation) {
  if (blades < 3) {
    return bw_clamp01(1.0 - bw_smoothstep(0.88, 1.02, sqrt(x * x + y * y)));
  }
  float sector = 2.0 * PI / float(blades);
  float theta = atan(y, x) - rotation;
  theta -= sector * floor(theta / sector + 0.5);
  float polygonRadius = cos(PI / float(blades)) / max(0.05, cos(theta));
  float boundary = polygonRadius * (1.0 - roundness) + roundness;
  float radius = sqrt(x * x + y * y);
  return bw_clamp01(1.0 - bw_smoothstep(boundary * 0.82, boundary, radius));
}

void main() {
  vec2 px = bw_pixel();
  float x = px.x;
  float y = px.y;
  vec4 dry = S(px);
  if (s_amount <= 0.000001 || c_outputMix <= 0.000001 || s_identityOutput) {
    fragColor = dry;
    return;
  }

  float cx = s_center.x;
  float cy = s_center.y;
  float nx = (x - cx) / max(1.0, cx);
  float ny = (y - cy) / max(1.0, cy);
  float ax = nx * s_aspect;
  float radius = sqrt(ax * ax + ny * ny);
  float edge = bw_smoothstep(0.12, 1.10, radius);
  float edge2 = edge * edge;

  float dirX = nx;
  float dirY = ny;
  float dirLength = sqrt(dirX * dirX + dirY * dirY);
  if (dirLength > 0.0001) {
    dirX /= dirLength;
    dirY /= dirLength;
  }
  float tangentX = -dirY;
  float tangentY = dirX;

  float dryY = L(dry);
  float guard = 0.0;
  if (s_needsEdgeGuard) {
    float localGradient =
      abs(L(S(vec2(x + 1.0, y))) - L(S(vec2(x - 1.0, y)))) +
      abs(L(S(vec2(x, y + 1.0))) - L(S(vec2(x, y - 1.0))));
    guard = c_edgeGuard * bw_smoothstep(0.045, 0.42, localGradient);
  }

  float swirlAngle = m_swirl * s_amount * edge2 * 0.24;
  float sx = nx;
  float sy = ny;
  if (abs(swirlAngle) > 0.000001) {
    float ca = cos(swirlAngle);
    float sa = sin(swirlAngle);
    sx = nx * ca - ny * sa;
    sy = nx * sa + ny * ca;
  }

  float r2 = radius * radius;
  float radial = 1.0 + m_distortion * s_amount * r2 + m_distortion * s_amount * 0.28 * r2 * r2;
  float mappingScale = radial * s_breathingScale;
  float fullSrcX = cx + sx * mappingScale * cx;
  float fullSrcY = cy + sy * mappingScale * cy;
  float srcX = x + (fullSrcX - x) * c_outputMix;
  float srcY = y + (fullSrcY - y) * c_outputMix;
  vec2 src = vec2(srcX, srcY);
  vec4 center = s_identityMapping ? dry : S(src);

  vec2 dir = vec2(dirX, dirY);
  vec2 tangent = vec2(tangentX, tangentY);

  float caPixels = m_lateralCA * s_amount * edge2 * (1.2 + 2.6 * s_focalScale) * (1.0 - guard * 0.82);
  vec3 result = center.rgb;
  if (caPixels > 0.0001) {
    result.r = S(src + dir * caPixels).r;
    result.b = S(src - dir * caPixels).b;
  }

  float curvatureBlur = m_fieldCurvature * s_amount * edge2 * (1.0 - guard * 0.78) * 4.0;
  float astigBlur = m_astigmatism * s_amount * edge2 * (1.0 - guard * 0.78) * 3.2;
  float sphericalBlur = m_spherical * s_amount * (0.30 + edge * 0.70) * (1.0 - guard * 0.72) * 2.8;
  if (curvatureBlur + astigBlur + sphericalBlur > 0.001) {
    float radialRadius = curvatureBlur + sphericalBlur;
    float tangentRadius = astigBlur + sphericalBlur * 0.72;
    vec3 opticalBlur = (center.rgb * 2.0 +
      S(src + dir * radialRadius).rgb + S(src - dir * radialRadius).rgb +
      S(src + tangent * tangentRadius).rgb + S(src - tangent * tangentRadius).rgb) / 6.0;
    float blurMix = bw_clamp01((curvatureBlur + astigBlur + sphericalBlur) * 0.22);
    result = mix(result, opticalBlur, blurMix);
  }

  float axialStrength = m_axialCA * s_amount * s_apertureScale * (1.0 - guard * 0.72);
  if (axialStrength > 0.0001) {
    float axialRadius = 1.0 + axialStrength * 5.0;
    vec3 blur = (S(src - vec2(axialRadius, 0.0)).rgb + S(src + vec2(axialRadius, 0.0)).rgb +
      S(src - vec2(0.0, axialRadius)).rgb + S(src + vec2(0.0, axialRadius)).rgb) * 0.25;
    result.r = result.r * (1.0 - axialStrength * 0.22) + blur.r * axialStrength * 0.22;
    result.b = result.b * (1.0 - axialStrength * 0.34) + blur.b * axialStrength * 0.34;
  }

  float comaStrength = m_coma * s_amount * edge2 * s_apertureScale * (1.0 - guard * 0.88);
  if (comaStrength > 0.0001) {
    vec3 comet = vec3(0.0);
    float weightSum = 0.0;
    for (int i = 1; i <= 4; ++i) {
      if (i > s_comaSamples) break;
      float fi = float(i);
      float spread = fi * (1.0 + comaStrength * 4.5);
      vec4 p = S(src + tangent * spread + dir * spread * 0.48);
      float hot = bw_smoothstep(c_bloomThreshold * 0.72, c_bloomThreshold + 0.75, L(p));
      float weight = hot / fi;
      comet += p.rgb * weight;
      weightSum += weight;
    }
    if (weightSum > 0.0001) {
      float amount = comaStrength * 0.34 / weightSum;
      result += comet * amount * vec3(1.0, 0.86, 0.72);
    }
  }

  float signedDepthError = c_focusOffset;
  if (c_depthSource == 1) {
    float depth = bw_clamp01((bw_clamp01(dry.a) - c_depthNear) / (c_depthFar - c_depthNear));
    if (c_depthInvert) depth = 1.0 - depth;
    depth = pow(max(0.000001, depth), c_depthGamma);
    signedDepthError = depth - c_focusPlane;
  }
  float depthError = abs(signedDepthError);
  float foregroundMirror = signedDepthError < 0.0 ? -1.0 : 1.0;
  float defocusStrength = m_defocus * s_amount * s_apertureScale * bw_clamp01(depthError) * (1.0 - guard * 0.55);
  if (defocusStrength > 0.0005) {
    float radiusPx = min(18.0, 0.75 + defocusStrength * 16.0);
    float squeeze = c_anamorphicSqueeze;
    float catEye = m_catEye * edge2;
    float horizontal = radiusPx * squeeze * (1.0 - catEye * 0.18);
    float vertical = radiusPx / squeeze * (1.0 - catEye * 0.52);
    vec3 blur = center.rgb * 2.0;
    float weightSum = 2.0;
    for (int i = 0; i < 12; ++i) {
      if (i >= s_defocusSamples) break;
      vec2 offset = DEFOCUS_OFFSETS[i];
      float ellipseX = offset.x * horizontal;
      float ellipseY = offset.y * vertical;
      float ox = ellipseX * s_anaCos - ellipseY * s_anaSin - dirX * catEye * radiusPx * 0.45 * foregroundMirror;
      float oy = ellipseX * s_anaSin + ellipseY * s_anaCos - dirY * catEye * radiusPx * 0.45 * foregroundMirror;
      vec4 p = S(src + vec2(ox, oy));
      float weight = 1.0;
      if (a_hasGlass) {
        float apertureWeight = bw_asset(t_glass, offset * 0.5 + 0.5);
        weight = 1.0 + (0.15 + apertureWeight * 1.70 - 1.0) * c_apertureInfluence;
      } else if (s_irisBlades >= 3) {
        float apertureWeight = proceduralIris(offset.x, offset.y, s_irisBlades, s_irisRoundness,
          s_irisRotation + (foregroundMirror < 0.0 ? PI : 0.0));
        weight = 1.0 + (0.15 + apertureWeight * 1.70 - 1.0) * c_apertureInfluence;
      }
      blur += p.rgb * weight;
      weightSum += weight;
    }
    blur *= 1.0 / weightSum;
    result = mix(result, blur, bw_clamp01(defocusStrength * 1.24));
  }

  float bloomStrength = m_bloom * s_amount;
  float diffusionStrength = m_diffusion * s_amount;
  float halationStrength = m_halation * s_amount;
  if (bloomStrength + diffusionStrength + halationStrength > 0.0001) {
    float radiusPx = 2.0 + diffusionStrength * 10.0 + bloomStrength * 6.0;
    vec3 glow = vec3(0.0);
    float hotWeight = 0.0;
    for (int i = 0; i < 8; ++i) {
      if (i >= s_glowSamples) break;
      vec4 p = S(src + GLOW_OFFSETS[i] * radiusPx);
      float hot = bw_smoothstep(c_bloomThreshold, c_bloomThreshold + 0.85, L(p));
      glow += p.rgb * hot;
      hotWeight += hot;
    }
    if (hotWeight > 0.0001) {
      glow *= 1.0 / hotWeight;
      result += glow * (bloomStrength * 0.34);
      result = mix(result, glow, bw_clamp01(diffusionStrength * 0.42));
      float halo = halationStrength * 0.23;
      result += glow * halo * vec3(1.0, 0.34, 0.10);
    }
  }

  float ghostStrength = m_flareGhosts * s_amount;
  if (ghostStrength > 0.0001) {
    float k = 0.42 + edge * 0.28;
    vec4 ghost = S(vec2(cx - (srcX - cx) * k, cy - (srcY - cy) * k));
    float hot = bw_smoothstep(c_bloomThreshold, c_bloomThreshold + 1.0, L(ghost));
    float amount = hot * ghostStrength * 0.22;
    result.r += ghost.r * amount * (1.05 + m_warmth);
    result.g += ghost.g * amount * 0.74;
    result.b += ghost.b * amount * (0.90 - m_warmth * 0.5);
  }

  float streakStrength = m_flareStreak * s_amount;
  if (streakStrength > 0.0001) {
    float streakRadius = 5.0 + streakStrength * 28.0;
    vec2 streak = vec2(s_anaCos, s_anaSin) * streakRadius;
    vec4 left = S(src - streak);
    vec4 right = S(src + streak);
    float hotLeft = bw_smoothstep(c_bloomThreshold, c_bloomThreshold + 0.9, L(left));
    float hotRight = bw_smoothstep(c_bloomThreshold, c_bloomThreshold + 0.9, L(right));
    float amount = streakStrength * 0.15;
    result += (left.rgb * hotLeft + right.rgb * hotRight) * amount * vec3(0.30, 0.55, 1.0);
  }

  float physicalStarGate = bw_smoothstep(8.0, 22.0, c_fStop);
  float starResponse = (1.0 - s_starGate) + s_starGate * physicalStarGate;
  float starStrength = m_starburst * s_amount * starResponse;
  if (starStrength > 0.0001) {
    float starRadius = 4.0 + starStrength * 18.0;
    vec3 star = vec3(0.0);
    int spokeCount = 4;
    if (s_irisBlades >= 3) {
      spokeCount = (s_irisBlades % 2 == 0) ? s_irisBlades : s_irisBlades * 2;
      spokeCount = min(spokeCount, s_maxStarSpokes);
    }
    for (int spoke = 0; spoke < 32; ++spoke) {
      if (spoke >= spokeCount) break;
      float normalized = float(spoke) / float(max(1, spokeCount));
      float angle = s_irisRotation + normalized * 6.28318530717958647692;
      float uneven = 1.0 + s_starUnevenness * sin(float(spoke * 17 + 3)) * 0.28;
      star += S(src + vec2(cos(angle), sin(angle)) * starRadius * uneven).rgb;
    }
    float hot = bw_smoothstep(c_bloomThreshold * 4.0, c_bloomThreshold * 4.0 + 2.0, bw_luma2020(star));
    float amount = starStrength * hot * 0.22 / float(max(1, spokeCount));
    result += star * amount;
  }

  float sensorStrength = m_debayer * s_amount;
  float chromaStrength = m_chromaSmear * s_amount;
  if (sensorStrength + chromaStrength > 0.0001) {
    float sensorRadius = 1.0 + 1.8 * sensorStrength;
    vec4 a = S(src - vec2(sensorRadius, 0.0));
    vec4 b = S(src + vec2(sensorRadius, 0.0));
    vec3 chromaBlur = vec3((a.r + b.r) * 0.5, center.g, (a.b + b.b) * 0.5);
    result.r = result.r * (1.0 - sensorStrength * 0.30) + chromaBlur.r * sensorStrength * 0.30;
    result.b = result.b * (1.0 - sensorStrength * 0.36) + chromaBlur.b * sensorStrength * 0.36;
    float yValue = bw_luma2020(result);
    float smearMix = bw_clamp01(chromaStrength * 0.32);
    float chromaY = bw_luma2020(chromaBlur);
    result.r = result.r * (1.0 - smearMix) + (yValue + (chromaBlur.r - chromaY) * 0.72) * smearMix;
    result.b = result.b * (1.0 - smearMix) + (yValue + (chromaBlur.b - chromaY) * 0.72) * smearMix;
  }

  float vignette = m_vignette * s_amount * edge2;
  result *= max(0.0, 1.0 - vignette * 0.58);

  if (a_hasDirt && c_dirtAmount > 0.0001) {
    vec2 uv = mod((vec2(x, y) + 0.5) / u_size * c_dirtScale, 1.0);
    float dirt = bw_clamp01(bw_asset(t_dirt, uv));
    float hot = bw_smoothstep(c_bloomThreshold * 0.72, c_bloomThreshold + 0.90, dryY);
    float dirtMask = dirt * c_dirtAmount * s_amount;
    result *= 1.0 - dirtMask * (0.10 + hot * 0.24);
    result += dirtMask * hot * vec3(0.030 * (1.0 + m_warmth), 0.018, 0.010);
  }

  if (a_hasSmudge && c_smudgeAmount > 0.0001) {
    vec2 uv = mod((vec2(x, y) + 0.5) / u_size * c_smudgeScale, 1.0);
    float smudge = bw_clamp01(bw_asset(t_smudge, uv));
    float hot = bw_smoothstep(c_bloomThreshold * 0.68, c_bloomThreshold + 0.82, dryY);
    float smudgeMask = smudge * c_smudgeAmount * s_amount;
    result *= 1.0 - smudgeMask * (0.07 + hot * 0.18);
    result += smudgeMask * hot * vec3(0.024 * (1.0 + m_warmth * 0.5), 0.019, 0.016);
  }

  float grainStrength = m_grain * s_amount * s_isoGrainScale;
  if (grainStrength > 0.0001) {
    int grainX = int(x / c_grainSize);
    int grainY = int(y / c_grainSize);
    float mono = bw_hashNoise(grainX, grainY, u_frame, c_grainSeed);
    float animated = bw_hashNoise(grainX + 13, grainY - 7, u_frame, c_grainSeed + 17.0);
    float noise = mono * 0.72 + animated * 0.28;
    float grainMask = 0.38 + 0.62 * (1.0 - bw_smoothstep(0.18, 1.20, max(0.0, dryY)));
    float amount = grainStrength * grainMask * 0.055;
    result += noise * amount * vec3(1.03, 1.0, 1.08);
  }

  // Geometry is mixed in coordinate space above; mixing against the unwarped
  // dry pixel would create translucent double edges (v1.3.1 edge fix).
  result = mix(center.rgb, result, c_outputMix);
  fragColor = vec4(bw_sanitize(result, dry.rgb), dry.a);
}
`;

export function opticsLabUniforms(state: PreparedOptics): FxUniforms {
  const uniforms: FxUniforms = {};
  for (const field of OPTICS_MODEL_FIELDS) {
    uniforms[`m_${field}`] = state.model[field];
  }
  const c = state.controls;
  Object.assign(uniforms, {
    m_irisBlades: state.model.irisBlades,
    c_outputMix: c.outputMix,
    c_edgeGuard: c.edgeGuard,
    c_bloomThreshold: c.bloomThreshold,
    c_anamorphicSqueeze: c.anamorphicSqueeze,
    c_apertureInfluence: c.apertureInfluence,
    c_depthSource: c.depthSource,
    c_depthInvert: c.depthInvert,
    c_depthNear: c.depthNear,
    c_depthFar: c.depthFar,
    c_depthGamma: c.depthGamma,
    c_focusPlane: c.focusPlane,
    c_focusOffset: c.focusOffset,
    c_fStop: c.fStop,
    c_dirtAmount: c.dirtAmount,
    c_dirtScale: c.dirtScale,
    c_smudgeAmount: c.smudgeAmount,
    c_smudgeScale: c.smudgeScale,
    c_grainSize: c.grainSize,
    c_grainSeed: c.grainSeed,
    s_center: [state.centerX, state.centerY],
    s_aspect: state.aspect,
    s_amount: state.amount,
    s_apertureScale: state.apertureScale,
    s_focalScale: state.focalScale,
    s_breathingScale: state.breathingScale,
    s_anaCos: state.anamorphicCos,
    s_anaSin: state.anamorphicSin,
    s_isoGrainScale: state.isoGrainScale,
    s_defocusSamples: state.defocusSamples,
    s_glowSamples: state.glowSamples,
    s_comaSamples: state.comaSamples,
    s_irisBlades: state.irisBlades,
    s_maxStarSpokes: state.maxStarSpokes,
    s_irisRoundness: state.irisRoundness,
    s_irisRotation: state.irisRotation,
    s_starUnevenness: state.starUnevenness,
    s_starGate: state.starGate,
    s_needsEdgeGuard: state.needsEdgeGuard,
    s_identityMapping: state.identityMapping,
    s_identityOutput: state.identityOutput,
    a_hasGlass: state.glassAsset > 0,
    a_hasDirt: state.dirtAsset > 0,
    a_hasSmudge: state.smudgeAsset > 0,
  });
  return uniforms;
}
