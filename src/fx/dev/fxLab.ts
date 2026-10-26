/**
 * Dev-only page (fx-lab.html): checks the WebGL2 shaders against the CPU
 * reference (which itself is pinned to the original C++ core) and renders all
 * Optics Lab lens recipes over a chosen image.
 */
import casesText from '../effects/opticsLab/__fixtures__/cases.txt?raw';
import { renderOpticsLabCpu, type FloatImage } from '../effects/opticsLab/cpu.ts';
import { OPTICS_PRESET_NAMES, controlsFromParams, prepareOptics } from '../effects/opticsLab/model.ts';
import { createFxInstance } from '../registry.ts';
import { FxRenderer } from '../renderer.ts';
import { LENS_PHYSICS_PARITY } from '../effects/lensPhysics/parity.ts';
import { PHOTOREALIZER_PARITY } from '../effects/photorealizer/parity.ts';
import { DEBAND_PARITY } from '../effects/deband/parity.ts';
import { FAKE_DIAGNOSTIC_PARITY } from '../effects/fakeDiagnostic/parity.ts';
import { FILM_EMULATION_PARITY } from '../effects/filmEmulation/parity.ts';

const W = 40;
const H = 24;

function testImage(): FloatImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = x / (W - 1);
      data[i + 1] = y / (H - 1);
      data[i + 2] = 0.5 + 0.5 * Math.sin(x * 0.7 + y * 0.3);
      data[i + 3] = x / (W - 1);
      if ((x - 10) ** 2 + (y - 8) ** 2 < 6) data.fill(3, i, i + 3);
      if ((x - 30) ** 2 + (y - 16) ** 2 < 4) data.set([1.6, 1.4, 1.2], i);
    }
  }
  return { width: W, height: H, data };
}

type ParityRow = { name: string; maxError: number; meanError: number; ok: boolean };

type ParitySuite = {
  effectId: string;
  image: () => FloatImage;
  cases: Array<{ name: string; params: Record<string, number | boolean | string>; frameIndex: number }>;
  cpu: (image: FloatImage, params: Record<string, number | boolean | string>, frameIndex: number) => FloatImage;
};

const OPTICS_SUITE: ParitySuite = {
  effectId: 'buckswood-post-plugins.optics-lab',
  image: testImage,
  cases: casesText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...pairs] = line.split(/\s+/);
      const values: Record<string, number> = {};
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        values[key] = Number(value);
      }
      const { frameIndex = 0, ...params } = values;
      return { name, params, frameIndex };
    }),
  cpu: (image, params, frameIndex) =>
    renderOpticsLabCpu(image, prepareOptics({ width: image.width, height: image.height, frameIndex }, controlsFromParams(params))),
};

const SUITES: ParitySuite[] = [OPTICS_SUITE, LENS_PHYSICS_PARITY, PHOTOREALIZER_PARITY, DEBAND_PARITY, FAKE_DIAGNOSTIC_PARITY, FILM_EMULATION_PARITY];

function runParity(): ParityRow[] {
  const renderer = new FxRenderer();
  const rows: ParityRow[] = [];
  for (const suite of SUITES) {
    const image = suite.image();
    for (const { name, params, frameIndex } of suite.cases) {
      const label = `${suite.effectId.replace('buckswood-post-plugins.', '')} · ${name}`;
      try {
        const cpu = suite.cpu(image, params, frameIndex);
        // Raw descriptor params (no app overrides): parity is against the C++ core.
        renderer.render(image, [{ id: 'parity', effectId: suite.effectId, enabled: true, mix: 1, params }], { frameIndex });
        const gpu = renderer.readFloatPixels();
        if (!gpu) throw new Error('no float readback');
        let maxError = 0;
        let sum = 0;
        for (let i = 0; i < gpu.length; i += 1) {
          if (i % 4 === 3) continue;
          const error = Math.abs(gpu[i] - cpu.data[i]) / Math.max(1, Math.abs(cpu.data[i]));
          maxError = Math.max(maxError, error);
          sum += error;
        }
        const meanError = sum / ((gpu.length / 4) * 3);
        rows.push({ name: label, maxError, meanError, ok: maxError < 0.02 && meanError < 0.002 });
      } catch (error) {
        console.error(label, error);
        rows.push({ name: `${label} (${error instanceof Error ? error.message.slice(0, 120) : 'error'})`, maxError: Number.NaN, meanError: Number.NaN, ok: false });
      }
    }
  }
  renderer.dispose();
  return rows;
}

function showParity(rows: ParityRow[]) {
  const el = document.getElementById('parity')!;
  el.innerHTML = `<table><tr><th>Fall</th><th>max. Fehler</th><th>mittl. Fehler</th><th></th></tr>${rows
    .map((r) => `<tr><td>${r.name}</td><td>${r.maxError.toExponential(2)}</td><td>${r.meanError.toExponential(2)}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'OK' : 'ABWEICHUNG'}</td></tr>`)
    .join('')}</table>`;
}

async function renderGrid(source: HTMLImageElement | HTMLCanvasElement) {
  const grid = document.getElementById('grid')!;
  grid.innerHTML = '';
  const renderer = new FxRenderer();
  const started = performance.now();
  OPTICS_PRESET_NAMES.forEach((name, preset) => {
    renderer.render(source, [createFxInstance('buckswood-post-plugins.optics-lab', { preset, effectStrength: preset === 0 ? 0 : 0.85, grain: 0.3 })], { frameIndex: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = renderer.canvas.width;
    canvas.height = renderer.canvas.height;
    canvas.getContext('2d')!.drawImage(renderer.canvas as HTMLCanvasElement, 0, 0);
    const figure = document.createElement('figure');
    figure.append(canvas);
    const caption = document.createElement('figcaption');
    caption.textContent = `${preset}: ${name}${preset === 0 ? ' (Original)' : ''}`;
    figure.append(caption);
    grid.append(figure);
  });
  (window as unknown as Record<string, unknown>).__fxGridMs = performance.now() - started;
  renderer.dispose();
}

function demoImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 960, 540);
  gradient.addColorStop(0, '#1b2a3a');
  gradient.addColorStop(1, '#d9a066');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 960, 540);
  for (let i = 0; i < 14; i += 1) {
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath();
    ctx.arc(80 + i * 62, 120 + (i % 3) * 30, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#20252b';
  ctx.fillRect(380, 220, 200, 320);
  ctx.fillStyle = '#e8e2d0';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText('POST PLUGINS', 290, 470);
  return canvas;
}

const rows = runParity();
showParity(rows);
(window as unknown as Record<string, unknown>).__fxParity = rows;
void renderGrid(demoImage());

document.getElementById('file')!.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => void renderGrid(img);
  img.src = URL.createObjectURL(file);
});
