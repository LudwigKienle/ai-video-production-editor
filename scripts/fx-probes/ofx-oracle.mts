/**
 * Oracle check: renders the parity cases through the REAL installed OFX
 * plugins (native/ofx-host) and compares them with the app's CPU reference
 * ports. Run: node scripts/fx-probes/ofx-oracle.mts
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { LENS_PHYSICS_PARITY } from '../../src/fx/effects/lensPhysics/parity.ts';
import { PHOTOREALIZER_PARITY } from '../../src/fx/effects/photorealizer/parity.ts';
import { DEBAND_PARITY } from '../../src/fx/effects/deband/parity.ts';
import { FAKE_DIAGNOSTIC_PARITY } from '../../src/fx/effects/fakeDiagnostic/parity.ts';
import { FILM_EMULATION_PARITY } from '../../src/fx/effects/filmEmulation/parity.ts';
import { renderOpticsLabCpu } from '../../src/fx/effects/opticsLab/cpu.ts';
import { controlsFromParams, prepareOptics } from '../../src/fx/effects/opticsLab/model.ts';
import { getFxDefinition } from '../../src/fx/registry.ts';

const require = createRequire(import.meta.url);
const { OfxHostClient } = require('../../electron/ofx/ofxHostClient.js');

type Img = { width: number; height: number; data: Float32Array };

const opticsImage = (): Img => {
  const W = 40, H = 24, data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    data[i] = x / (W - 1); data[i + 1] = y / (H - 1);
    data[i + 2] = 0.5 + 0.5 * Math.sin(Math.fround(Math.fround(x * 0.7) + Math.fround(y * 0.3)));
    data[i + 3] = x / (W - 1);
    if ((x - 10) ** 2 + (y - 8) ** 2 < 6) data.fill(3, i, i + 3);
    if ((x - 30) ** 2 + (y - 16) ** 2 < 4) data.set([1.6, 1.4, 1.2], i);
  }
  return { width: W, height: H, data };
};
const opticsCases = readFileSync(new URL('../../src/fx/effects/opticsLab/__fixtures__/cases.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, ...pairs] = line.split(/\s+/);
    const v: Record<string, number> = {};
    for (const p of pairs) { const [k, val] = p.split('='); v[k] = Number(val); }
    const { frameIndex = 0, ...params } = v;
    return { name, params, frameIndex };
  });
const OPTICS = {
  effectId: 'buckswood-post-plugins.optics-lab', image: opticsImage, cases: opticsCases,
  cpu: (img: Img, params: Record<string, number>, frameIndex: number) => renderOpticsLabCpu(img, prepareOptics({ width: img.width, height: img.height, frameIndex }, controlsFromParams(params))),
};

const flip = (img: Img): Float32Array => {
  const row = img.width * 4, out = new Float32Array(img.data.length);
  for (let y = 0; y < img.height; y += 1) out.set(img.data.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row);
  return out;
};

const client = new OfxHostClient({});
const suites = [OPTICS, LENS_PHYSICS_PARITY, PHOTOREALIZER_PARITY, DEBAND_PARITY, FAKE_DIAGNOSTIC_PARITY, FILM_EMULATION_PARITY] as any[];
const summary: string[] = [];
try {
  for (const suite of suites) {
    const pluginId = getFxDefinition(suite.effectId)?.ofxIdentifier;
    const img: Img = suite.image();
    let worst = 0, worstCase = '';
    let means: number[] = [];
    for (const c of suite.cases) {
      const res = await client.renderFrame({ pluginId, instanceId: `oracle-${suite.effectId}`, resetParams: true, params: c.params, time: c.frameIndex, width: img.width, height: img.height, format: 'rgba32f', pixels: flip(img) });
      const out = new Float32Array(res.pixels.buffer, res.pixels.byteOffset, res.pixels.byteLength / 4);
      const host = flip({ width: img.width, height: img.height, data: out });
      const cpu = suite.cpu(img, c.params, c.frameIndex).data;
      let max = 0, sum = 0;
      for (let i = 0; i < cpu.length; i += 1) { if (i % 4 === 3) continue; const e = Math.abs(host[i] - cpu[i]) / Math.max(1, Math.abs(cpu[i])); max = Math.max(max, e); sum += e; }
      means.push(sum / (cpu.length * 0.75));
      if (max > worst) { worst = max; worstCase = c.name; }
    }
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    summary.push(`${suite.effectId.padEnd(28)} cases=${String(suite.cases.length).padStart(2)}  worst=${worst.toExponential(2)} (${worstCase})  mean=${mean.toExponential(2)}`);
  }
} finally {
  await client.dispose?.();
}
console.log(summary.join('\n'));
