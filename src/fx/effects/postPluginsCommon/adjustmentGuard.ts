/**
 * "Adjustment Layer Guard" shared by Buckswood Post Plugins Lens Physics and AI
 * Photorealizer (MIT, © Ludwig Kienle).
 *
 * Port of `sourceLooksLikeBlankAdjustment()` from the OFX glue
 * (BuckswoodLensPhysicsOFX.cpp / BuckswoodAIPhotorealizerOFX.cpp): a 9×9 grid
 * of source pixels is inspected; if every sample is (near) black and the mean
 * alpha is > 0.75, the source is treated as an empty Resolve adjustment clip
 * and the whole output becomes transparent black.
 *
 * This is OFX glue, not part of the C++ cores, so it is not covered by the
 * probe goldens; the effect tests pin it against this logic directly.
 */
import type { FloatImage } from '../opticsLab/cpu.ts';

export const BLANK_GRID = 9;

export function sourceLooksLikeBlankAdjustment(image: FloatImage): boolean {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return false;
  let maxRgb = 0;
  let alphaSum = 0;
  let samples = 0;
  for (let gy = 0; gy < BLANK_GRID; gy += 1) {
    // Integer division as in C++.
    const y = Math.trunc(((height - 1) * gy) / (BLANK_GRID - 1));
    for (let gx = 0; gx < BLANK_GRID; gx += 1) {
      const x = Math.trunc(((width - 1) * gx) / (BLANK_GRID - 1));
      const i = (y * width + x) * 4;
      maxRgb = Math.max(maxRgb, Math.max(data[i], Math.max(data[i + 1], data[i + 2])));
      alphaSum += data[i + 3];
      samples += 1;
      if (maxRgb > 0.015) return false;
    }
  }
  return samples > 0 && alphaSum / samples > 0.75 && maxRgb < 0.015;
}

/**
 * GLSL version. Every fragment evaluates the grid itself; normal footage
 * exits after the first non-black sample, so the cost is a single fetch.
 */
export const ADJUSTMENT_GUARD_GLSL = /* glsl */ `
bool bw_sourceLooksLikeBlankAdjustment(sampler2D tex) {
  ivec2 s = ivec2(u_size);
  if (s.x <= 0 || s.y <= 0) return false;
  float maxRgb = 0.0;
  float alphaSum = 0.0;
  for (int gy = 0; gy < 9; ++gy) {
    int y = ((s.y - 1) * gy) / 8;
    for (int gx = 0; gx < 9; ++gx) {
      int x = ((s.x - 1) * gx) / 8;
      vec4 p = texelFetch(tex, ivec2(x, y), 0);
      maxRgb = max(maxRgb, max(p.r, max(p.g, p.b)));
      alphaSum += p.a;
      if (maxRgb > 0.015) return false;
    }
  }
  return (alphaSum / 81.0) > 0.75 && maxRgb < 0.015;
}
`;
