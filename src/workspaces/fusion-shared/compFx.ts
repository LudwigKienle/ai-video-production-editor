/**
 * GPU effects for Fusion-page fx nodes.
 *
 * - Registers a small separable Gaussian blur ("avpe.comp-blur") used by the
 *   Blur tool of the Fusion and Nuke views (own shader, premultiplied so
 *   transparent edges do not darken).
 * - Builds effect stacks for the Grade / Blur / FX tools: Grade uses the Color
 *   page primary grade when it is registered, otherwise the first available
 *   GPU effect.
 */
import { createFxInstance, getFxDefinition, listFxDefinitions, registerFx } from '../../fx/registry.ts';
import type { FxDefinition, FxStack } from '../../fx/types.ts';
import { BLUR_FX_ID, GRADE_FX_ID } from './nodeClass.ts';
import type { FxKind } from './toolCatalog.ts';

const BLUR_FRAGMENT = /* glsl */ `
uniform float u_radius;
uniform vec2 u_dir;
void main() {
  vec2 p = bw_pixel();
  float radius = max(0.0, u_radius);
  if (radius < 0.5) { fragColor = bw_fetch(u_src, ivec2(p)); return; }
  float sigma = max(0.5, radius * 0.5);
  float stepPx = max(1.0, radius / 24.0);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float offset = float(i) * stepPx;
    if (abs(offset) > radius) continue;
    float w = exp(-0.5 * (offset * offset) / (sigma * sigma));
    vec4 c = bw_sample_fast(u_src, p + u_dir * offset);
    acc += vec4(c.rgb * c.a, c.a) * w;
    wsum += w;
  }
  acc /= max(1e-6, wsum);
  fragColor = acc.a > 1e-5 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
}
`;

const radiusFor = (values: Record<string, unknown>, width: number) => {
  const size = Number(values.size);
  // Size is in pixels of a 1920-wide frame, so proxy previews look like the final render.
  return (Number.isFinite(size) ? Math.max(0, size) : 0) * (width / 1920);
};

export const COMP_BLUR_FX: FxDefinition = {
  id: BLUR_FX_ID,
  name: 'Weichzeichner',
  vendor: 'AVPE',
  version: '1.0',
  category: 'stylize',
  description: 'Gaußscher Weichzeichner (separierbar, vormultipliziert) für Fusion-Knoten.',
  params: [
    { id: 'size', label: 'Größe', type: 'float', default: 8, min: 0, max: 200, displayMax: 64, step: 0.1, unit: 'px', hint: 'Radius bezogen auf ein 1920 Pixel breites Bild.' },
    { id: 'aspect', label: 'Seitenverhältnis', type: 'float', default: 1, min: 0, max: 4, step: 0.01, hint: '>1 = stärker horizontal, <1 = stärker vertikal.' },
  ],
  passes: [
    {
      id: 'h',
      fragment: BLUR_FRAGMENT,
      uniforms: (values, frame) => ({ u_radius: radiusFor(values, frame.width) * Math.max(0, Number(values.aspect ?? 1) || 0), u_dir: [1, 0] }),
    },
    {
      id: 'v',
      fragment: BLUR_FRAGMENT,
      uniforms: (values, frame) => ({ u_radius: radiusFor(values, frame.width), u_dir: [0, 1] }),
    },
  ],
};

let registered = false;
/** Idempotent; called when the Fusion page mounts. */
export function ensureCompFx(): void {
  if (registered || getFxDefinition(BLUR_FX_ID)) {
    registered = true;
    return;
  }
  try {
    registerFx(COMP_BLUR_FX);
    registered = true;
  } catch (error) {
    console.warn('[fusion] blur effect not registered', error);
  }
}

/** GPU effects selectable in an FX node (WebGL-renderable only — native OFX needs the export host). */
export function selectableFx(): FxDefinition[] {
  return listFxDefinitions().filter((definition) => !definition.native && definition.category !== 'diagnostic');
}

export function fxStackFor(kind: FxKind): FxStack | null {
  ensureCompFx();
  try {
    if (kind === 'blur') return [createFxInstance(BLUR_FX_ID)];
    if (kind === 'grade') {
      if (getFxDefinition(GRADE_FX_ID)) return [createFxInstance(GRADE_FX_ID)];
      const fallback = selectableFx().find((definition) => definition.category === 'color') ?? selectableFx().find((definition) => definition.id !== BLUR_FX_ID);
      return fallback ? [createFxInstance(fallback.id)] : [];
    }
    const first = selectableFx().find((definition) => definition.id !== BLUR_FX_ID);
    return first ? [createFxInstance(first.id)] : [];
  } catch (error) {
    console.warn('[fusion] could not build fx stack', error);
    return [];
  }
}
