/**
 * Bakes the colour part of a clip's grade nodes into a 3D .cube LUT (what
 * "Export .cube" did on the old Color page). Uses the CPU reference of the
 * primary grade, node by node with each node's mix. Windows, qualifiers,
 * blur and sizing are spatial or keyed and cannot live in a LUT; such nodes
 * are baked without their mask and reported in `masked`.
 */
import type { FxInstance } from '../../fx/types.ts';
import { resolveParams } from '../../fx/registry.ts';
import { PRIMARY_GRADE_ID } from '../../fx/effects/primaryGrade/index.ts';
import { gradePixel } from '../../fx/effects/primaryGrade/cpu.ts';
import { buildCurveTexture, curvesFromParams, prepareGrade } from '../../fx/effects/primaryGrade/model.ts';

type V3 = [number, number, number];


export type CubeExport = { text: string; size: number; nodes: number; masked: string[] };

export function bakeGradeToCube(stack: FxInstance[] | undefined, options: { size?: number; title?: string } = {}): CubeExport {
  const size = Math.max(2, Math.min(65, Math.round(options.size ?? 33)));
  const nodes = (stack ?? []).filter((node) => node.effectId === PRIMARY_GRADE_ID && node.enabled !== false);
  const masked: string[] = [];
  const prepared = nodes.map((node) => {
    const values = resolveParams(node);
    const spatial = Boolean(values.qualEnabled) || Number(values.winType ?? 0) !== 0 || Number(values.blurRadius ?? 0) > 0
      || Number(values.sharpen ?? 0) > 0 || Number(values.sizeZoom ?? 1) !== 1 || Number(values.sizePan ?? 0) !== 0
      || Number(values.sizeTilt ?? 0) !== 0 || Number(values.sizeRotate ?? 0) !== 0 || Boolean(values.sizeFlipH);
    if (spatial) masked.push(node.id);
    return { grade: prepareGrade(values, { width: 1, height: 1 }), tex: buildCurveTexture(curvesFromParams(values)), mix: node.mix ?? 1 };
  });
  const lines = [`TITLE "${(options.title ?? 'AVPE grade').replace(/"/g, "'")}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        let v: V3 = [r * step, g * step, b * step];
        for (const node of prepared) {
          const out = gradePixel(node.grade, node.tex, v);
          v = [0, 1, 2].map((c) => v[c] + (out[c] - v[c]) * node.mix) as V3;
        }
        lines.push(v.map((x) => Math.min(1, Math.max(0, x)).toFixed(6)).join(' '));
      }
    }
  }
  return { text: `${lines.join('\n')}\n`, size, nodes: prepared.length, masked };
}
