/**
 * GPU-vs-CPU parity check of `avpe.primary-grade` (dev helper, browser only).
 * Run in a dev tab:
 *   const m = await import('/src/workspaces/color-pro/primaryGradeParity.ts');
 *   m.runPrimaryGradeParity()
 * Renders a synthetic float frame through the WebGL2 engine and compares the
 * unclamped result with the CPU reference (cpu.ts). Targets are RGBA16F, so
 * errors around 1e-3 are expected (half-float storage between passes).
 */
import './registerPrimaryGrade.ts';
import { FxRenderer } from '../../fx/renderer.ts';
import { renderPrimaryGradeCpu, type FloatImage } from '../../fx/effects/primaryGrade/cpu.ts';
import { createGradeNode } from './nodeStack.ts';
import type { FxParamValues } from '../../fx/types.ts';

export const PARITY_CASES: Array<{ name: string; params: FxParamValues }> = [
  { name: 'identity', params: {} },
  { name: 'lift-gamma-gain', params: { liftR: 0.05, liftB: -0.03, liftY: 0.02, gammaG: 0.2, gammaY: -0.1, gainR: 1.2, gainY: 0.9, offsetB: 0.04, lumMix: 0.4 } },
  { name: 'temp-contrast-sat-hue', params: { temperature: 30, tint: -20, contrast: 1.3, pivot: 0.4, saturation: 1.4, hue: 25 } },
  { name: 'log-wheels', params: { logShadowB: 0.3, logMidR: 0.2, logHighG: -0.25, logLowRange: 0.3, logHighRange: 0.6 } },
  { name: 'curves', params: { curveY: '0:0.05,0.3:0.22,0.7:0.8,1:0.95', curveR: '0:0,0.5:0.6,1:1', curveB: '0:0.1,1:0.9' } },
  { name: 'hue-curves', params: { hueHue: '0:0.5,0.33:0.65,0.66:0.5', hueSat: '0:0.8,0.5:0.3', hueLum: '0.6:0.7' } },
  { name: 'qualifier', params: { gainY: 1.5, qualEnabled: true, qualHue: 200, qualHueWidth: 40, qualHueSoft: 20, qualSatLow: 0.1, qualLumHigh: 0.9 } },
  { name: 'window-circle', params: { saturation: 0, winType: 1, winX: 0.4, winY: 0.55, winSizeX: 0.3, winSizeY: 0.2, winRotation: 30, winSoftness: 0.4 } },
  { name: 'window-rect-gradient', params: { liftY: 0.2, winType: 2, winSizeX: 0.25, winSizeY: 0.35, winSoftness: 0.2, winInvert: true } },
  { name: 'gradient-key', params: { gammaY: 0.5, winType: 3, winRotation: 15, winSoftness: 0.5, keyGain: 0.7, keyOffset: 0.1 } },
  { name: 'blur', params: { blurRadius: 6 } },
  { name: 'sharpen', params: { sharpen: 1.5 } },
  { name: 'sizing', params: { sizePan: 0.1, sizeTilt: -0.05, sizeZoom: 1.3, sizeRotate: 12, sizeFlipH: true } },
  { name: 'show-mask', params: { qualEnabled: true, qualHue: 30, showMask: true } },
];

export function parityImage(width = 96, height = 64): FloatImage {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = x / (width - 1);
      data[i + 1] = y / (height - 1);
      data[i + 2] = 0.5 + 0.5 * Math.sin(x * 0.21 + y * 0.13);
      data[i + 3] = 1;
      if ((x - 70) ** 2 + (y - 20) ** 2 < 40) data.set([1.4, 1.2, 1.1], i); // HDR highlight
    }
  }
  return { width, height, data };
}

export type ParityRow = { name: string; maxAbs: number; meanAbs: number; worstAt: [number, number, number] };

export function runPrimaryGradeParity(): { rows: ParityRow[]; maxAbs: number } {
  const image = parityImage();
  const renderer = new FxRenderer();
  const rows: ParityRow[] = [];
  try {
    for (const entry of PARITY_CASES) {
      const node = createGradeNode(entry.params, `parity-${entry.name}`);
      renderer.render(image, [node], { quality: 'full' });
      const gpu = renderer.readFloatPixels();
      if (!gpu) throw new Error('Float targets unavailable (EXT_color_buffer_float).');
      const cpu = renderPrimaryGradeCpu(image, node.params).data;
      let max = 0;
      let sum = 0;
      let worst: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < cpu.length; i += 1) {
        if (i % 4 === 3) continue;
        const d = Math.abs(gpu[i] - cpu[i]);
        sum += d;
        if (d > max) {
          max = d;
          const p = Math.floor(i / 4);
          worst = [p % image.width, Math.floor(p / image.width), i % 4];
        }
      }
      rows.push({ name: entry.name, maxAbs: Number(max.toExponential(2)), meanAbs: Number((sum / ((cpu.length / 4) * 3)).toExponential(2)), worstAt: worst });
    }
  } finally {
    renderer.dispose();
  }
  return { rows, maxAbs: Math.max(...rows.map((row) => row.maxAbs)) };
}
